// scripts/benchmark.ts
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Command line arguments
const args = process.argv.slice(2);
let prompt = '';
let modelDir = '';

// Parse command line arguments
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--prompt' && i + 1 < args.length) {
    prompt = args[i + 1];
    i++;
  } else if (args[i] === '--models-dir' && i + 1 < args.length) {
    modelDir = args[i + 1];
    i++;
  }
}

// Default prompt if not provided
if (!prompt) {
  prompt = "Explain the theory of relativity in simple terms.";
  console.log(`No prompt provided, using default: "${prompt}"`);
}

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
console.log(`Prompt: "${prompt}"`);

benchmarkAllModels(prompt)
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
 * Check if any models exist in the models directory
 */
function hasModels(): boolean {
  try {
    if (!fs.existsSync(modelDir)) {
      return false;
    }
    
    const files = fs.readdirSync(modelDir);
    const modelFiles = files.filter(file => file.toLowerCase().endsWith('.gguf'));
    
    return modelFiles.length > 0;
  } catch (error) {
    console.error(`Error checking for model files: ${error}`);
    return false;
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
 * Benchmark all models in the models directory
 */
async function benchmarkAllModels(prompt: string): Promise<any[]> {
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
  
  const results: {
    model: string;
    timeSeconds?: number;
    outputLength?: number;
    tokenCount?: number;
    tokensPerSecond?: number;
    output?: string;
    error?: string;
  }[] = [];
  
  // Test each model
  for (const modelPath of modelPaths) {
    const modelName = path.basename(modelPath);
    const modelNameWithoutExt = path.basename(modelPath, '.gguf');
    console.log(`\n\n===== Testing model: ${modelNameWithoutExt} =====\n`);
    logInfo(`Testing model: ${modelNameWithoutExt}`);
    
    try {
      const startTime = Date.now();
      let modelOutput = '';
      let tokenCount = 0;
      
      // Set up environment variables
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
      
      // Run the model with the prompt
      console.log(`Running model with prompt: "${prompt}"`);
      
      // Get the version of llama-cli to check what parameters it supports
      try {
        const versionOutput = execSync(`"${llamaBinaryPath}" -h`, { env, cwd }).toString();
        console.log("Checking llama-cli version and available parameters...");
        
        // Modified command line arguments - removed unsupported flags
        const args = [
          '-m', modelPath,
          '-p', prompt,
          '--temp', '0.7',
          '--seed', '42',
          '--ctx-size', '2048',
          '--batch-size', '512',
          '--threads', Math.max(1, os.cpus().length - 1).toString(),
          '--n-predict', '500'
        ];
        
        // Add parameters that might be specific to certain versions
        if (versionOutput.includes('--no-display-prompt')) {
          args.push('--no-display-prompt');
        }
        
        if (versionOutput.includes('--no-mmap')) {
          args.push('--no-mmap');
        }
        
        // Disable interactive mode if possible
        if (versionOutput.includes('--no-interactive')) {
          args.push('--no-interactive');
        }
        
        // Disable conversation mode if possible
        if (versionOutput.includes('--no-cnv')) {
          args.push('--no-cnv');
        } else if (versionOutput.includes('-no-cnv')) {
          args.push('-no-cnv');
        }
        
        // Start the child process
        const child = spawn(llamaBinaryPath, args, { 
          env, 
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'] // Make sure we can write to stdin
        });
        
        // Handle possible interactive mode by closing stdin immediately
        if (child.stdin) {
          child.stdin.end();
        }
        
        const outputPromise = new Promise<string>((resolve, reject) => {
          // Set a timeout to detect if the process is stuck in interactive mode
          const timeoutId = setTimeout(() => {
            console.log("Process appears to be stuck in interactive mode, attempting to exit...");
            if (child.stdin) {
              // Try to exit by sending 'q' and Enter
              child.stdin.write('q\n');
              setTimeout(() => {
                // If still running, try to kill
                if (!child.killed) {
                  console.log("Still running, attempting to kill process...");
                  child.kill('SIGINT');
                }
              }, 1000);
            }
          }, 10000); // 10 second timeout

          // Track if we're in a prompt or response section
          let inPromptSection = true;
          let responseStarted = false;
          
          // Collect output
          child.stdout.on('data', (data) => {
            const text = data.toString();
            console.log(`Model stdout: ${text}`);
            
            // If we see output, clear the timeout
            clearTimeout(timeoutId);
            
            // Always collect the stdout output
            modelOutput += text;
            
            // Count tokens for metrics
            const words = text.split(/\s+/).filter(Boolean);
            tokenCount += words.length;
          });
          
          // Handle errors
          child.stderr.on('data', (data) => {
            const err = data.toString();
            // Log all stderr output for debugging
            console.error(`Model stderr: ${err}`);
            
            // Clear timeout if we're getting any feedback
            clearTimeout(timeoutId);
          });
          
          // Handle process completion
          child.on('close', (code) => {
            // Clear the timeout
            clearTimeout(timeoutId);
            
            const endTime = Date.now();
            const elapsedSecs = (endTime - startTime) / 1000;
            
            console.log(`Model process finished with code ${code}`);
            console.log(`Time taken: ${elapsedSecs.toFixed(2)} seconds`);
            console.log(`Output length: ${modelOutput.length} characters`);
            
            // Ensure we have some output to show
            if (modelOutput.length > 0) {
              console.log(`Output sample: ${modelOutput.substring(0, 200)}...`);
              resolve(modelOutput);
            } else {
              reject(new Error(`Model process exited with code ${code}`));
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
        
        try {
          // Wait for the model to finish
          const output = await outputPromise;
          const endTime = Date.now();
          const elapsedSecs = (endTime - startTime) / 1000;
          const tokensPerSec = tokenCount / elapsedSecs;
          
          const result = {
            model: modelNameWithoutExt,
            timeSeconds: elapsedSecs,
            outputLength: output.length,
            tokenCount: tokenCount,
            tokensPerSecond: tokensPerSec,
            output: output.substring(0, 500) + (output.length > 500 ? '...' : '') // Truncate long outputs
          };
          
          results.push(result);
          console.log(`Benchmark successful for ${modelNameWithoutExt}`);
          logInfo(`Benchmark successful for ${modelNameWithoutExt}: ${tokensPerSec.toFixed(2)} tokens/sec`);
        } catch (error) {
          console.error(`Error during model execution: ${error}`);
          logError(`Error benchmarking ${modelNameWithoutExt}: ${error}`);
          
          results.push({
            model: modelNameWithoutExt,
            error: error instanceof Error ? error.message : String(error)
          });
        }
        
      } catch (versionError) {
        console.error(`Error checking llama-cli version: ${versionError}`);
        logError(`Error checking llama-cli version: ${versionError}`);
        
        // Fallback to basic parameters if we can't check version
        const args = [
          '-m', modelPath,
          '-p', prompt,
          '--temp', '0.7',
          '--seed', '42',
          '--n-predict', '100'
        ];
        
        const child = spawn(llamaBinaryPath, args, { env, cwd });
        
        let fallbackOutput = '';
        
        child.stdout.on('data', (data) => {
          const text = data.toString();
          fallbackOutput += text;
        });
        
        child.stderr.on('data', (data) => {
          console.error(`Fallback model stderr: ${data.toString()}`);
        });
        
        // Wait for the process to complete
        await new Promise<void>((resolve) => {
          child.on('close', (code) => {
            console.log(`Fallback model process exited with code ${code}`);
            
            results.push({
              model: modelNameWithoutExt,
              output: fallbackOutput,
              error: code !== 0 ? `Process exited with code ${code}` : undefined
            });
            
            resolve();
          });
        });
      }
      
      // Wait a bit between models to let system resources settle
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error(`Error setting up model ${modelNameWithoutExt}: ${error}`);
      logError(`Error setting up model ${modelNameWithoutExt}: ${error}`);
      
      results.push({
        model: modelNameWithoutExt,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  // Save benchmark results to file
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const benchmarkPath = path.join(logDir, `llama-benchmark-${timestamp}.json`);
  
  try {
    fs.writeFileSync(benchmarkPath, JSON.stringify(results, null, 2));
    console.log(`\nBenchmark results saved to ${benchmarkPath}`);
    logInfo(`Benchmark results saved to ${benchmarkPath}`);
  } catch (error) {
    console.error(`Error writing benchmark results: ${error}`);
    logError(`Error writing benchmark results: ${error}`);
  }
  
  // Print a summary
  console.log(`\n==================================================`);
  console.log(`BENCHMARK RESULTS SUMMARY:`);
  console.log(`==================================================`);
  for (const result of results) {
    if ('error' in result && result.error) {
      console.log(`${result.model}: ERROR - ${result.error}`);
    } else if ('output' in result && result.output) {
      console.log(`${result.model}: ${(result.tokensPerSecond ?? 0).toFixed(2)} tokens/sec, ${result.outputLength} chars`);
    } else {
      console.log(`${result.model}: No output generated`);
    }
  }
  console.log(`==================================================\n`);
  
  return formatResults(results);
}

/**
 * Format the benchmark results to a more structured format
 */
function formatResults(rawResults: any[]): any[] {
  return rawResults.map(result => {
    if ('error' in result && result.error) {
      // If there was an error, keep the same structure
      return {
        model: result.model,
        error: result.error
      };
    } else {
      // Format successful results to match the expected metrics structure
      return {
        model: result.model,
        output: result.output,
        metrics: {
          tokensPerSec: result.tokensPerSecond,
          setupTime: result.timeSeconds - (result.tokenCount / result.tokensPerSecond), // Estimate setup time
          generationTime: result.tokenCount / result.tokensPerSecond, // Estimate generation time
          totalTime: result.timeSeconds,
          outputLength: result.outputLength,
          tokenCount: result.tokenCount
        }
      };
    }
  });
}