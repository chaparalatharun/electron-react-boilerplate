// scripts/bundle-model.ts
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

// Load environment variables from .env file
dotenv.config();

// Default model config
const DEFAULT_MODEL_REPO = 'TheBloke/deepseek-llm-7B-chat-GGUF';
const DEFAULT_MODEL_FILE = 'deepseek-llm-7b-chat.Q4_K_M.gguf';

// Parse CLI args
const args = process.argv.slice(2);
let modelSource = '';
let outputDir = '';
let modelFile = DEFAULT_MODEL_FILE;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--model' && i + 1 < args.length) {
    modelSource = args[++i];
  } else if (args[i] === '--output' && i + 1 < args.length) {
    outputDir = args[++i];
  } else if (args[i] === '--file' && i + 1 < args.length) {
    modelFile = args[++i];
  }
}

const appPath = process.cwd();
const finalOutputDir = outputDir || path.join(appPath, 'assets', 'llama', 'models');
if (!fs.existsSync(finalOutputDir)) {
  fs.mkdirSync(finalOutputDir, { recursive: true });
  console.log(`Created output directory: ${finalOutputDir}`);
}

const targetModelFile = path.join(finalOutputDir, modelFile);

async function bundleModel() {
  try {
    if (modelSource.startsWith('http://') || modelSource.startsWith('https://')) {
      console.log('Downloading from URL...');
      await downloadModel(modelSource, targetModelFile);
    } else if (modelSource && fs.existsSync(modelSource)) {
      console.log('Copying local model...');
      await copyLocalModel(modelSource, targetModelFile);
    } else {
      const repo = modelSource || DEFAULT_MODEL_REPO;
      const exists = await checkModelInRepo(repo, modelFile);
      if (!exists) {
        const available = await listRepoFiles(repo);
        console.error(`Model file not found in repo. Available files:`);
        available.forEach(f => console.log(` - ${f}`));
        process.exit(1);
      }
      const url = `https://huggingface.co/${repo}/resolve/main/${modelFile}`;
      console.log(`Downloading from Hugging Face: ${url}`);
      await downloadModel(url, targetModelFile);
    }
    console.log('✅ Model ready:', targetModelFile);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

async function downloadModel(url: string, destPath: string): Promise<void> {
  if (fs.existsSync(destPath)) {
    console.log(`File already exists: ${destPath}`);
    return;
  }

  const token = process.env.HUGGINGFACE_TOKEN;
  const options: http.RequestOptions = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;

    const makeRequest = (currentUrl: string) => {
      client.get(currentUrl, options, (response) => {
        if (response.statusCode === 302 && response.headers.location) {
          makeRequest(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          return reject(new Error(`Failed to download: ${response.statusCode}`));
        }

        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        let downloaded = 0;
        const fileStream = fs.createWriteStream(destPath);

        response.on('data', (chunk) => {
          downloaded += chunk.length;
          if (totalSize > 0) {
            const percent = ((downloaded / totalSize) * 100).toFixed(2);
            process.stdout.write(`Progress: ${percent}%\r`);
          }
        });

        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          console.log(`\nDownloaded to: ${destPath}`);
          resolve();
        });

        response.on('error', (err) => {
          fs.unlink(destPath, () => reject(err));
        });

        fileStream.on('error', (err) => {
          fs.unlink(destPath, () => reject(err));
        });
      }).on('error', (err) => reject(err));
    };

    makeRequest(url);
  });
}

async function copyLocalModel(src: string, dest: string) {
  if (path.resolve(src) === path.resolve(dest)) {
    console.log('Source and destination are the same. Skipping copy.');
    return;
  }
  fs.copyFileSync(src, dest);
  console.log(`Copied local model to: ${dest}`);
}

async function checkModelInRepo(repo: string, file: string): Promise<boolean> {
  const token = process.env.HUGGINGFACE_TOKEN;
  const options: any = { method: 'HEAD', headers: {} };
  if (token) options.headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`https://huggingface.co/${repo}/resolve/main/${file}`, options);
  return response.ok;
}

async function listRepoFiles(repo: string): Promise<string[]> {
  const token = process.env.HUGGINGFACE_TOKEN;
  const options: any = { headers: {} };
  if (token) options.headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`https://huggingface.co/api/models/${repo}/tree/main`, options);
  if (!response.ok) throw new Error(`Failed to list files: ${response.statusText}`);

  const data = await response.json();
  return data.filter((f: any) => f.type === 'file' && f.path.endsWith('.gguf')).map((f: any) => f.path);
}

bundleModel();