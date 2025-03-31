// scripts/bundle-model.ts
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { pipeline } from 'stream/promises';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Parse command line arguments
const args = process.argv.slice(2);
let modelSource = '';
let outputDir = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--model' && i + 1 < args.length) {
    modelSource = args[i + 1];
    i++;
  } else if (args[i] === '--output' && i + 1 < args.length) {
    outputDir = args[i + 1];
    i++;
  }
}

if (!modelSource) {
  console.error('Please specify a model source with --model');
  console.log('Usage: ts-node bundle-model.ts --model <source> [--output <dir>]');
  console.log('  <source> can be:');
  console.log('    - A Hugging Face model name (e.g., "TheBloke/Llama-2-7B-Chat-GGUF")');
  console.log('    - A direct URL to a GGUF file (e.g., "https://huggingface.co/TheBloke/Llama-2-7B-Chat-GGUF/resolve/main/llama-2-7b-chat.Q4_0.gguf")');
  console.log('    - A local file path to a GGUF file');
  process.exit(1);
}

// Determine app path
const appPath = process.cwd();

// Default output directory if not specified
if (!outputDir) {
  outputDir = path.join(appPath, 'assets', 'llama', 'models');
}

// Ensure the output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`Created output directory at: ${outputDir}`);
}

console.log(`Model will be stored in: ${outputDir}`);

// Determine the type of source
async function bundleModel() {
  try {
    // Check if source is a URL
    if (modelSource.startsWith('http://') || modelSource.startsWith('https://')) {
      console.log(`Treating source as a direct download URL: ${modelSource}`);
      await downloadModelFromUrl(modelSource);
    }
    // Check if source is a local file
    else if (fs.existsSync(modelSource)) {
      console.log(`Treating source as a local file: ${modelSource}`);
      await copyLocalModel(modelSource);
    }
    // Assume it's a Hugging Face model name
    else {
      console.log(`Treating source as a Hugging Face model name: ${modelSource}`);
      await downloadFromHuggingFace(modelSource);
    }
    
    console.log('Model bundling completed successfully!');
  } catch (error) {
    console.error(`Error bundling model: ${error}`);
    process.exit(1);
  }
}

// Download model from a direct URL
async function downloadModelFromUrl(url: string) {
  const fileName = url.split('/').pop() || 'model.gguf';
  const outputPath = path.join(outputDir, fileName);
  
  console.log(`Downloading model from ${url} to ${outputPath}`);
  
  // Create a write stream for the output file
  const fileStream = fs.createWriteStream(outputPath);
  
  // Determine whether to use http or https based on the URL
  const client = url.startsWith('https') ? https : http;
  
  // Get token from environment variable
  const token = process.env.HUGGINGFACE_TOKEN;
  
  return new Promise<void>((resolve, reject) => {
    // Prepare request options with authorization if token exists
    const options: http.RequestOptions = {};
    if (token) {
      options.headers = {
        'Authorization': `Bearer ${token}`
      };
      console.log('Using Hugging Face authentication token');
    } else {
      console.warn('No Hugging Face token found in environment variables. Some models may not be accessible.');
    }
    
    const request = client.get(url, options, (response) => {
      // Check if the request was successful
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download, status code: ${response.statusCode}`));
        return;
      }
      
      // Get the total size of the file from headers
      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedSize = 0;
      
      // Update the progress bar on data chunks
      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        if (totalSize > 0) {
          const percentage = ((downloadedSize / totalSize) * 100).toFixed(2);
          process.stdout.write(`Progress: ${percentage}% (${(downloadedSize / 1024 / 1024).toFixed(2)} MB / ${(totalSize / 1024 / 1024).toFixed(2)} MB)\r`);
        } else {
          process.stdout.write(`Downloaded: ${(downloadedSize / 1024 / 1024).toFixed(2)} MB\r`);
        }
      });
      
      // Pipe the response to the file
      response.pipe(fileStream);
      
      // Handle errors during the download
      response.on('error', (error) => {
        fileStream.close();
        fs.unlinkSync(outputPath); // Remove the partially downloaded file
        reject(error);
      });
      
      // Finish the download
      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`\nDownload completed: ${outputPath}`);
        resolve();
      });
      
      // Handle errors during file writing
      fileStream.on('error', (error) => {
        fileStream.close();
        fs.unlinkSync(outputPath); // Remove the partially downloaded file
        reject(error);
      });
    });
    
    // Handle errors in the request
    request.on('error', (error) => {
      fileStream.close();
      fs.unlinkSync(outputPath); // Remove the partially downloaded file
      reject(error);
    });
    
    // Set a timeout for the request
    request.setTimeout(60000, () => {
      request.destroy();
      fileStream.close();
      fs.unlinkSync(outputPath); // Remove the partially downloaded file
      reject(new Error('Download timed out'));
    });
  });
}

// Copy a local model file to the models directory
async function copyLocalModel(filePath: string) {
  const fileName = path.basename(filePath);
  const outputPath = path.join(outputDir, fileName);
  
  // Check if the file is already in the correct location
  if (path.resolve(filePath) === path.resolve(outputPath)) {
    console.log(`File is already in the target location: ${outputPath}`);
    return;
  }
  
  console.log(`Copying ${filePath} to ${outputPath}`);
  
  try {
    // Check if it's a GGUF file
    if (!fileName.toLowerCase().endsWith('.gguf')) {
      console.warn('Warning: The file does not have a .gguf extension. It may not be compatible with llama.cpp.');
    }
    
    // Copy the file
    fs.copyFileSync(filePath, outputPath);
    console.log(`File copied successfully to ${outputPath}`);
  } catch (error) {
    console.error(`Error copying file: ${error}`);
    throw error;
  }
}

// Download a model from Hugging Face
async function downloadFromHuggingFace(modelName: string) {
  console.log(`Attempting to download model from Hugging Face: ${modelName}`);
  
  // Try to find GGUF files in the repository
  const ggufFiles = await findGGUFFilesInHuggingFace(modelName);
  
  if (ggufFiles.length === 0) {
    console.error(`No GGUF files found in the Hugging Face repository: ${modelName}`);
    throw new Error('No GGUF files found');
  }
  
  // Sort files by name to prioritize certain quantization formats
  // For example, Q4_K_M is typically a good balance between size and quality
  ggufFiles.sort((a, b) => {
    // Prioritize models with certain quantizations
    const preferred = ['Q4_K_M', 'Q5_K_M', 'Q4_0', 'Q5_0'];
    for (const pref of preferred) {
      if (a.includes(pref) && !b.includes(pref)) return -1;
      if (!a.includes(pref) && b.includes(pref)) return 1;
    }
    return a.localeCompare(b);
  });
  
  console.log('Found the following GGUF files:');
  ggufFiles.forEach((file, index) => {
    console.log(`${index + 1}. ${file}`);
  });
  
  // Default to the first file in the sorted list
  const selectedFile = ggufFiles[0];
  console.log(`Selected model: ${selectedFile}`);
  
  // Construct the download URL
  const downloadUrl = `https://huggingface.co/${modelName}/resolve/main/${selectedFile}`;
  
  // Now download the file
  await downloadModelFromUrl(downloadUrl);
}

// Helper function to find GGUF files in a Hugging Face repository
async function findGGUFFilesInHuggingFace(modelName: string): Promise<string[]> {
  console.log(`Querying Hugging Face repository contents for ${modelName}...`);
  
  try {
    // Get token from environment variable
    const token = process.env.HUGGINGFACE_TOKEN;
    
    // Prepare fetch options with authorization if token exists
    const options: RequestInit = {};
    if (token) {
      options.headers = {
        'Authorization': `Bearer ${token}`
      };
    }
    
    // Use the Hugging Face API to list files in the repository
    const response = await fetch(`https://huggingface.co/api/models/${modelName}/tree/main`, options);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch repository contents: ${response.statusText}`);
    }
    
    const repoContents = await response.json();
    
    // Filter for GGUF files
    const ggufFiles = repoContents
      .filter((item: any) => item.type === 'file' && item.path.toLowerCase().endsWith('.gguf'))
      .map((item: any) => item.path);
    
    return ggufFiles;
  } catch (error) {
    console.error(`Error fetching repository contents: ${error}`);
    return [];
  }
}

// Start the bundling process
bundleModel();