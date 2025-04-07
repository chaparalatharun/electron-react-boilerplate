// scripts/benchmark.ts
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Define types for our results
interface BenchmarkError {
  model: string;
  path: string;
  error: string;
}

interface BenchmarkPromptResult {
  prompt: string;
  response?: string;
  timeSeconds?: number;
  setupTimeSeconds?: number;
  generationTimeSeconds?: number;
  tokenCount?: number;
  tokensPerSecond?: number;
  generationTokensPerSecond?: number;
  error?: string;
}

interface BenchmarkAggregate {
  totalTokens: number;
  totalTime: number;
  totalSetupTime: number;
  totalGenerationTime: number;
  averageTokensPerSec: number;
  averageGenerationTokensPerSec: number;
}

interface BenchmarkSuccess {
  model: string;
  path: string;
  fileSize: number;
  prompts: BenchmarkPromptResult[];
  aggregate: BenchmarkAggregate;
}

// Union type for all possible result types
type BenchmarkResult = BenchmarkSuccess | BenchmarkError;

// Command line arguments
const args = process.argv.slice(2);
let modelDir = '';
let deleteAfterBenchmark = false;

// Parse command line arguments
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--models-dir' && i + 1 < args.length) {
    modelDir = args[i + 1];
    i++;
  } else if (args[i] === '--delete-after') {
    deleteAfterBenchmark = true;
  }
}

// Define test prompts
const PROMPTS = [
  // Prompt 1: Logic Puzzle (Reasoning)
  "Two friends, Lily and Ray, make statements about who finished a puzzle first. Lily says: 'I was faster than Ray.' Ray says: 'Lily is lying.' Assume exactly one of them is telling the truth. Who actually finished the puzzle first?",
  
  // Prompt 2: News Summary (Summarization)
  "Summarize in 1-2 sentences: A local community in Green Valley organized a neighborhood event to plant 500 trees in the town park. Volunteers of all ages participated, aiming to improve air quality and beautify the area. According to the city council, the event was a success and will become an annual tradition.",
  
  // Prompt 3: Creative Micro-Story (Creativity)
  "Write a very short story (3-5 sentences) about an inventor who creates a device that transforms ordinary rain into something extraordinary. Make the story imaginative but coherent, and give it a clear resolution.",
  
  // Prompt 4: Quick Facts Check (Factual Accuracy)
  "Answer these factual questions directly and separately: 1. What is the capital city of Italy? 2. In which year did World War I begin? 3. Name one gas that makes up most of Earth's atmosphere.",
  
  // Prompt 5: Mixed Task (Reasoning + Summarization + Creativity)
  "A local bakery and a local gym are debating how to promote healthier lifestyles. The bakery claims offering whole-grain breads and low-sugar pastries is sufficient, while the gym argues that regular exercise classes matter more. Summarize each side's main point in one sentence each, then propose a creative, two-sentence compromise."
];

// Determine app path and default model directory
const appPath = process.cwd();
if (!modelDir) {
  modelDir = path.join(appPath, 'assets', 'llama', 'models');
}

// Paths for library, binary, and logs
const libPath = path.join(appPath, 'assets', 'llama', 'lib');
const llamaBinaryPath = path.join(appPath, 'assets', 'llama', 'bin', 
                                  process.platform === 'win32' ? 'llama-cli.exe' : 'llama-cli');
const logDir = path.join(appPath, 'logs');
const logFilePath = path.join(logDir, 'llama-benchmark.log');

// Ensure directories exist
ensureDirectoriesExist();

// Start the benchmarking process
console.log('Starting benchmark process...');
console.log(`Models directory: ${modelDir}`);

benchmarkAllModels()
  .then(results => {
    console.log('Benchmark completed successfully!');
  })
  .catch(error => {
    console.error(`Benchmark failed: ${error}`);
    process.exit(1);
  });

/**
 * Ensure all required directories exist
 */
function ensureDirectoriesExist(): void {
  // Create log directory if it doesn't exist
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
    console.log(`Created log directory at: ${logDir}`);
  }
}

/**
 * Log error to the log file
 */
function logError(message: string): void {
  try {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ERROR: ${message}\n`;
    
    fs.appendFileSync(logFilePath, logMessage);
  } catch (error) {
    console.error(`Failed to write to log file: ${error}`);
  }
}

/**
 * Log info to the log file
 */
function logInfo(message: string): void {
  try {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] INFO: ${message}\n`;
    
    fs.appendFileSync(logFilePath, logMessage);
  } catch (error) {
    console.error(`Failed to write to log file: ${error}`);
  }
}

/**
 * Return the list of available models
 */
function getAvailableModels(): string[] {
  try {
    if (!fs.existsSync(modelDir)) {
      return [];
    }
    
    const files = fs.readdirSync(modelDir);
    return files
      .filter(file => file.toLowerCase().endsWith('.gguf'))
      .map(file => path.join(modelDir, file));
  } catch (error) {
    console.error(`Error listing model files: ${error}`);
    return [];
  }
}

/**
 * Estimate token count from text
 */
function estimateTokenCount(text: string): number {
  // A simple approximation: count words and punctuation as tokens
  const tokenPattern = /\w+|[^\w\s]/g;
  const matches = text.match(tokenPattern);
  return matches ? matches.length : 0;
}

/**
 * Run one prompt for a model
 */
async function runOnePrompt(modelPath: string, prompt: string): Promise<{
  timeSeconds: number;
  tokenCount: number;
  response: string;
  setupTimeSeconds: number;
  generationTimeSeconds: number;
}> {
  const env = { ...process.env };
  
  // Set dynamic library paths based on platform
  if (process.platform === 'darwin') {
    // macOS
    env.DYLD_LIBRARY_PATH = [libPath, env.DYLD_LIBRARY_PATH].filter(Boolean).join(':');
    env.DYLD_FALLBACK_LIBRARY_PATH = libPath;
  } else if (process.platform === 'linux') {
    // Linux
    env.LD_LIBRARY_PATH = [libPath, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  } else if (process.platform === 'win32') {
    // Windows
    env.PATH = [libPath, env.PATH].filter(Boolean).join(path.delimiter);
  }
  
  // Run in the binary directory to make sure relative paths work
  const cwd = path.dirname(llamaBinaryPath);
  
  // Timing variables
  const processStartTime = Date.now();
  let firstTokenTime: number | null = null;
  let lastTokenTime: number | null = null;
  let modelOutput = '';
  
  // Get the version of llama-cli to check what parameters it supports
  let advancedFlags: string[] = [];
  try {
    const versionOutput = execSync(`"${llamaBinaryPath}" -h`, { env, cwd }).toString();
    
    // Add parameters that might be specific to certain versions
    if (versionOutput.includes('--no-display-prompt')) {
      advancedFlags.push('--no-display-prompt');
    }
    
    if (versionOutput.includes('--no-mmap')) {
      advancedFlags.push('--no-mmap');
    }
    
    // Disable interactive mode if possible
    if (versionOutput.includes('--no-interactive')) {
      advancedFlags.push('--no-interactive');
    }
    
    // Disable conversation mode if possible
    if (versionOutput.includes('--no-cnv')) {
      advancedFlags.push('--no-cnv');
    } else if (versionOutput.includes('-no-cnv')) {
      advancedFlags.push('-no-cnv');
    }
  } catch (error) {
    console.warn("Couldn't detect advanced flags. Using defaults.");
  }
  
  // Set up command line arguments
  const args = [
    '-m', modelPath,
    '-p', prompt,
    '--temp', '0.7',
    '--seed', '42',
    '--ctx-size', '2048',
    '--batch-size', '512',
    '--threads', Math.max(1, os.cpus().length - 1).toString(),
    '--n-predict', '300',
    '-v' // Verbose output for timing information
  ];
  
  // Add advanced flags
  args.push(...advancedFlags);
  
  console.log(`Running model with prompt: "${prompt.substring(0, 50)}..."`);
  
  return new Promise<{
    timeSeconds: number;
    tokenCount: number;
    response: string;
    setupTimeSeconds: number;
    generationTimeSeconds: number;
  }>((resolve, reject) => {
    const child = spawn(llamaBinaryPath, args, { 
      env, 
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'] // Make sure we can write to stdin
    });
    
    // Handle possible interactive mode by closing stdin immediately
    if (child.stdin) {
      child.stdin.end();
    }
    
    // Set a timeout to detect if the process is stuck
    const timeoutId = setTimeout(() => {
      console.log("Process appears to be stuck, attempting to exit...");
      if (child.stdin) {
        child.stdin.write('q\n');
        setTimeout(() => {
          if (!child.killed) {
            console.log("Still running, attempting to kill process...");
            child.kill('SIGINT');
          }
        }, 1000);
      }
    }, 20000); // 20 second timeout
    
    // Track if we've started receiving tokens
    let tokenOutputStarted = false;
    
    // Collect output
    child.stdout.on('data', (data) => {
      const now = Date.now();
      const text = data.toString();
      
      // If this is the first token, record the time
      if (!tokenOutputStarted && text.trim().length > 0) {
        tokenOutputStarted = true;
        firstTokenTime = now;
        console.log(`First token received at ${(firstTokenTime - processStartTime) / 1000}s`);
      }
      
      // Update last token time whenever we get output
      if (text.trim().length > 0) {
        lastTokenTime = now;
      }
      
      // Clear the timeout
      clearTimeout(timeoutId);
      
      // Collect the output
      modelOutput += text;
    });
    
    // Handle errors and logs in stderr
    child.stderr.on('data', (data) => {
      const err = data.toString();
      
      // Log stderr output for debugging (but don't flood the console)
      if (err.includes('error') || err.includes('Error')) {
        console.error(`Model stderr: ${err}`);
      }
      
      // Clear timeout if we're getting any feedback
      clearTimeout(timeoutId);
    });
    
    // Handle process completion
    child.on('close', (code) => {
      // Clear the timeout
      clearTimeout(timeoutId);
      
      const processEndTime = Date.now();
      
      // Calculate timing metrics
      const totalTimeSeconds = (processEndTime - processStartTime) / 1000;
      
      const setupTimeSeconds = firstTokenTime 
        ? (firstTokenTime - processStartTime) / 1000 
        : totalTimeSeconds; // If we never got a first token, setup took whole time
      
      const generationTimeSeconds = (firstTokenTime && lastTokenTime) 
        ? (lastTokenTime - firstTokenTime) / 1000 
        : 0; // If we never got a first token, generation time is 0
      
      // Estimate token count
      const tokenCount = estimateTokenCount(modelOutput);
      
      if (code !== 0) {
        console.error(`Model process exited with code ${code}`);
      }
      
      console.log(`Model process finished in ${totalTimeSeconds.toFixed(2)}s`);
      console.log(`Setup time: ${setupTimeSeconds.toFixed(2)}s`);
      console.log(`Generation time: ${generationTimeSeconds.toFixed(2)}s`);
      console.log(`Estimated tokens: ${tokenCount}`);
      
      // Ensure we have some output
      if (modelOutput.length > 0) {
        console.log(`Output sample: ${modelOutput.substring(0, 100)}...`);
        resolve({
          timeSeconds: totalTimeSeconds,
          setupTimeSeconds: setupTimeSeconds,
          generationTimeSeconds: generationTimeSeconds,
          tokenCount: tokenCount,
          response: modelOutput
        });
      } else {
        reject(new Error(`Model process exited with code ${code} without producing output`));
      }
    });
    
    // Handle process errors
    child.on('error', (error) => {
      // Clear the timeout
      clearTimeout(timeoutId);
      
      console.error(`Failed to start model process: ${error.message}`);
      reject(error);
    });
  });
}

/**
 * Benchmark a single model with all prompts
 */
async function benchmarkModel(modelPath: string): Promise<any> {
  const modelName = path.basename(modelPath);
  const modelNameWithoutExt = path.basename(modelPath, '.gguf');
  console.log(`\n\n===== Testing model: ${modelNameWithoutExt} =====\n`);
  logInfo(`Testing model: ${modelNameWithoutExt}`);
  
  const results: any[] = [];
  let totalTokens = 0;
  let totalTime = 0;
  let totalSetupTime = 0;
  let totalGenerationTime = 0;
  
  // Run each prompt for this model
  for (let i = 0; i < PROMPTS.length; i++) {
    const prompt = PROMPTS[i];
    console.log(`\n--- Running prompt ${i + 1}/${PROMPTS.length} ---`);
    
    try {
      const result = await runOnePrompt(modelPath, prompt);
      
      // Update totals
      totalTokens += result.tokenCount;
      totalTime += result.timeSeconds;
      totalSetupTime += result.setupTimeSeconds;
      totalGenerationTime += result.generationTimeSeconds;
      
      // Calculate tokens per second based on generation time only
      const generationTPS = result.generationTimeSeconds > 0 
        ? result.tokenCount / result.generationTimeSeconds 
        : 0;
      
      // Store result for this prompt
      results.push({
        prompt,
        response: result.response.substring(0, 500), // Limit size of stored response
        timeSeconds: result.timeSeconds,
        setupTimeSeconds: result.setupTimeSeconds,
        generationTimeSeconds: result.generationTimeSeconds,
        tokenCount: result.tokenCount,
        tokensPerSecond: result.tokenCount / result.timeSeconds, // Total TPS
        generationTokensPerSecond: generationTPS // Generation-only TPS
      });
      
      // Wait a bit between prompts
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error(`Error running prompt: ${error}`);
      logError(`Error running prompt for ${modelNameWithoutExt}: ${error}`);
      
      // Record the error but continue with other prompts
      results.push({
        prompt,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  // Calculate averages
  const avgTPS = totalTokens > 0 && totalTime > 0
    ? totalTokens / totalTime
    : 0;
    
  const avgGenerationTPS = totalTokens > 0 && totalGenerationTime > 0
    ? totalTokens / totalGenerationTime
    : 0;
  
  // Print summary for this model
  console.log(`\n=== Summary for ${modelNameWithoutExt} ===`);
  console.log(`Total tokens: ${totalTokens}`);
  console.log(`Total time:   ${totalTime.toFixed(2)} s`);
  console.log(`Setup time:   ${totalSetupTime.toFixed(2)} s`);
  console.log(`Generation time: ${totalGenerationTime.toFixed(2)} s`);
  console.log(`Avg t/s (total):      ${avgTPS.toFixed(2)}`);
  console.log(`Avg t/s (generation): ${avgGenerationTPS.toFixed(2)}`);
  
  // Return the full results object
  const benchmarkResult: BenchmarkSuccess = {
    model: modelNameWithoutExt,
    path: modelPath,
    fileSize: fs.statSync(modelPath).size,
    prompts: results,
    aggregate: {
      totalTokens,
      totalTime,
      totalSetupTime,
      totalGenerationTime,
      averageTokensPerSec: avgTPS,
      averageGenerationTokensPerSec: avgGenerationTPS
    }
  };
  
  return benchmarkResult;
}

/**
 * Benchmark all models in the models directory
 */
async function benchmarkAllModels(): Promise<any[]> {
  console.log('Starting benchmark of all models...');
  logInfo('Starting benchmark of all models');
  
  // Check if the library exists
  const libName = process.platform === 'win32' 
    ? 'llama.dll' 
    : process.platform === 'darwin' 
      ? 'libllama.dylib' 
      : 'libllama.so';
      
  const libFullPath = path.join(libPath, libName);
  
  if (!fs.existsSync(libFullPath)) {
    const errorMsg = `Required library ${libName} not found at ${libFullPath}. Please run build-llama script.`;
    console.error(errorMsg);
    logError(errorMsg);
    return [{ error: errorMsg }];
  }
  
  if (!fs.existsSync(llamaBinaryPath)) {
    const errorMsg = `Required binary not found at ${llamaBinaryPath}. Please run build-llama script.`;
    console.error(errorMsg);
    logError(errorMsg);
    return [{ error: errorMsg }];
  }
  
  // Get all model files
  const modelPaths = getAvailableModels();
  
  if (modelPaths.length === 0) {
    const errorMsg = 'No model files found in the models directory. Please add at least one .gguf file.';
    console.error(errorMsg);
    logError(errorMsg);
    return [{ error: errorMsg }];
  }
  
  console.log(`Found ${modelPaths.length} models for benchmarking:`);
  modelPaths.forEach(modelPath => console.log(`- ${path.basename(modelPath)}`));
  
  // Create results file
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const resultsFile = path.join(logDir, `llama-benchmark-${timestamp}.jsonl`);
  const writeStream = fs.createWriteStream(resultsFile, { flags: 'a' });
  
  console.log(`\nWill write benchmark results to ${resultsFile}`);
  
  const results: BenchmarkResult[] = [];
  
  // Test each model in sequence
  for (const modelPath of modelPaths) {
    try {
      console.log(`\n\n===== Starting benchmark for: ${path.basename(modelPath)} =====\n`);
      
      // Test the model with all prompts
      const modelResult = await benchmarkModel(modelPath);
      
      // Save results to file immediately after each model
      writeStream.write(JSON.stringify(modelResult) + '\n');
      console.log(`Results written for ${path.basename(modelPath)}`);
      
      // Store in results array
      results.push(modelResult);
      
      // Delete model file to free up space if requested
      if (deleteAfterBenchmark && fs.existsSync(modelPath)) {
        fs.unlinkSync(modelPath);
        console.log(`🗑️ Deleted ${modelPath} after benchmark`);
      }
      
      // Wait between models to let system resources settle
      console.log('Waiting 5 seconds before next model...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
    } catch (error) {
      console.error(`Error benchmarking ${path.basename(modelPath)}:`, error);
      logError(`Error benchmarking ${path.basename(modelPath)}: ${error}`);
      
      // Record the error
      const errorResult: BenchmarkError = {
        model: path.basename(modelPath, '.gguf'),
        path: modelPath,
        error: error instanceof Error ? error.message : String(error)
      };
      
      // Save error result to file
      writeStream.write(JSON.stringify(errorResult) + '\n');
      
      // Store in results array
      results.push(errorResult);
      
      // Delete model file if requested
      if (deleteAfterBenchmark && fs.existsSync(modelPath)) {
        fs.unlinkSync(modelPath);
        console.log(`🗑️ Deleted ${modelPath} after failed benchmark`);
      }
    }
  }
  
  writeStream.end();
  console.log(`\n✅ All benchmarks completed. Results saved to ${resultsFile}`);
  
  // Print a summary of all models
  console.log(`\n==================================================`);
  console.log(`BENCHMARK RESULTS SUMMARY:`);
  console.log(`==================================================`);
  console.log(`Model | Size | Total Time | Setup Time | Gen Time | Tokens | Total t/s | Gen t/s`);
  console.log(`--------------------------------------------------`);
  
  for (const result of results) {
    try {
      if ('error' in result) {
        // It's a BenchmarkError
        console.log(`${result.model}: ERROR - ${result.error}`);
      } else {
        // It's a BenchmarkSuccess
        const { aggregate, fileSize, model } = result;
        
        // Calculate size in MB
        const sizeInMB = (fileSize / (1024 * 1024)).toFixed(1);
        
        // Format the metrics
        const totalTime = aggregate.totalTime.toFixed(1);
        const setupTime = aggregate.totalSetupTime.toFixed(1);
        const genTime = aggregate.totalGenerationTime.toFixed(1);
        const tokens = aggregate.totalTokens;
        const totalTPS = aggregate.averageTokensPerSec.toFixed(2);
        const genTPS = aggregate.averageGenerationTokensPerSec.toFixed(2);
        
        console.log(
          `${model} | ` +
          `${sizeInMB}MB | ` +
          `${totalTime}s | ` +
          `${setupTime}s | ` +
          `${genTime}s | ` +
          `${tokens} | ` +
          `${totalTPS} | ` +
          `${genTPS}`
        );
      }
    } catch (err) {
      console.error(`Error printing summary for a result:`, err);
    }
  }
  console.log(`==================================================\n`);
  
  return results;
}