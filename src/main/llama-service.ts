import { app } from 'electron';
import { spawn, execSync, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

export class LlamaService {
  private llamaBinaryPath: string;
  private libPath: string;
  private modelsDir: string;
  private logFilePath: string;
  private isLibraryReady: boolean = false;
  private isBuildingLibrary: boolean = false;
  private buildLogPath: string;
  
  constructor() {
    // Determine if we're in development or production mode
    const isDev = process.env.NODE_ENV === 'development';
    const appPath = app.getAppPath();
    
    // Set up directory paths based on environment
    if (isDev) {
      // Development paths
      this.llamaBinaryPath = path.join(appPath, 'src', 'main', 'llama', 'bin', 'llama-cli');
      this.libPath = path.join(appPath, 'src', 'main', 'llama', 'lib');
      this.modelsDir = path.join(appPath, 'src', 'main', 'llama', 'models');
    } else {
      // Production paths - usually in the resources directory
      this.llamaBinaryPath = path.join(process.resourcesPath, 'llama', 'bin', 'llama-cli');
      this.libPath = path.join(process.resourcesPath, 'llama', 'lib');
      this.modelsDir = path.join(process.resourcesPath, 'llama', 'models');
    }
    
    // Add .exe extension on Windows
    if (process.platform === 'win32') {
      this.llamaBinaryPath += '.exe';
    }
    
    // Log files in the project or user data directory
    const logDir = isDev 
      ? path.join(appPath, 'logs')
      : path.join(app.getPath('userData'), 'logs');
      
    this.logFilePath = path.join(logDir, 'llama-benchmark.log');
    this.buildLogPath = path.join(logDir, 'llama-build.log');
    
    // Ensure all the necessary directories exist
    this.ensureDirectoriesExist();
    
    // Initialize - check for library and build if needed
    this.initialize();
  }
  
  /**
   * Make sure all required directories exist
   */
  private ensureDirectoriesExist(): void {
    console.log('Ensuring all directories exist...');
    
    // Create lib directory if it doesn't exist
    if (!fs.existsSync(this.libPath)) {
      try {
        fs.mkdirSync(this.libPath, { recursive: true });
        console.log(`Created lib directory at: ${this.libPath}`);
      } catch (error) {
        console.error(`Error creating lib directory: ${error}`);
      }
    }
    
    // Create models directory if it doesn't exist
    if (!fs.existsSync(this.modelsDir)) {
      try {
        fs.mkdirSync(this.modelsDir, { recursive: true });
        console.log(`Created models directory at: ${this.modelsDir}`);
      } catch (error) {
        console.error(`Error creating models directory: ${error}`);
      }
    }
    
    // Ensure the binary directory exists
    const binDir = path.dirname(this.llamaBinaryPath);
    if (!fs.existsSync(binDir)) {
      try {
        fs.mkdirSync(binDir, { recursive: true });
        console.log(`Created bin directory at: ${binDir}`);
      } catch (error) {
        console.error(`Error creating bin directory: ${error}`);
      }
    }
    
    // Make sure log directory exists
    const logDir = path.dirname(this.logFilePath);
    if (!fs.existsSync(logDir)) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
        console.log(`Created log directory at: ${logDir}`);
      } catch (error) {
        console.error(`Error creating log directory: ${error}`);
      }
    }
  }

  /**
   * Initialize service and check for required components
   */
  private initialize(): void {
    // Check if library exists and build if needed
    this.checkLibraryAndBuildIfNeeded();
  }

  /**
   * Check if required library exists, and build it if needed
   */
  private checkLibraryAndBuildIfNeeded(): void {
    const libName = process.platform === 'win32' 
      ? 'llama.dll' 
      : process.platform === 'darwin' 
        ? 'libllama.dylib' 
        : 'libllama.so';
        
    const libFullPath = path.join(this.libPath, libName);
    
    if (fs.existsSync(libFullPath)) {
      console.log(`Library ${libName} found at: ${libFullPath}`);
      this.isLibraryReady = true;
      return;
    }
    
    // Check if the library might be next to the binary
    const libNearBinary = path.join(path.dirname(this.llamaBinaryPath), libName);
    
    if (fs.existsSync(libNearBinary)) {
      try {
        // Copy from binary location to lib directory
        fs.copyFileSync(libNearBinary, libFullPath);
        console.log(`Copied ${libName} from binary directory to lib directory`);
        this.isLibraryReady = true;
        return;
      } catch (error) {
        console.error(`Error copying library: ${error}`);
      }
    }
    
    console.log(`Library ${libName} not found. Will build or download when needed.`);
  }

  /**
   * Build llama.cpp from source to get the library
   * Returns a promise that resolves when build is complete
   */
  private async buildLibrary(): Promise<boolean> {
    if (this.isBuildingLibrary) {
      console.log('Library build already in progress');
      return false;
    }
    
    this.isBuildingLibrary = true;
    console.log('Starting library build process...');
    this.logInfo('Starting to build llama.cpp library');
    
    const tempDir = path.join(os.tmpdir(), 'llama-build-' + Date.now());
    let success = false;
    
    try {
      // Create temp directory for building
      fs.mkdirSync(tempDir, { recursive: true });
      console.log(`Created temp build directory: ${tempDir}`);
      
      // Log build steps
      const logToFile = (message: string) => {
        fs.appendFileSync(this.buildLogPath, `${new Date().toISOString()}: ${message}\n`);
        console.log(message);
      };
      
      logToFile('Cloning llama.cpp repository...');
      
      // Clone repository
      await new Promise<void>((resolve, reject) => {
        const gitProcess = spawn('git', [
          'clone',
          'https://github.com/ggerganov/llama.cpp.git',
          tempDir,
          '--depth=1'  // Shallow clone to speed up
        ]);
        
        let output = '';
        
        gitProcess.stdout.on('data', (data) => {
          output += data.toString();
        });
        
        gitProcess.stderr.on('data', (data) => {
          output += data.toString();
        });
        
        gitProcess.on('close', (code) => {
          if (code === 0) {
            logToFile('Successfully cloned repository');
            resolve();
          } else {
            logToFile(`Git clone failed with code ${code}: ${output}`);
            reject(new Error(`Git clone failed with code ${code}`));
          }
        });
        
        gitProcess.on('error', (error) => {
          logToFile(`Git process error: ${error.message}`);
          reject(error);
        });
      });
      
      // Create build directory
      const buildDir = path.join(tempDir, 'build');
      fs.mkdirSync(buildDir, { recursive: true });
      
      logToFile('Configuring with CMake...');
      
      // Run CMake
      await new Promise<void>((resolve, reject) => {
        const cmakeProcess = spawn('cmake', [
          '..',
          '-DBUILD_SHARED_LIBS=ON',  // Ensure we build a shared library
          '-DLLAMA_METAL=ON'         // Enable Metal support for macOS
        ], {
          cwd: buildDir
        });
        
        let output = '';
        
        cmakeProcess.stdout.on('data', (data) => {
          const text = data.toString();
          output += text;
          // Print CMake output in real-time for debugging
          console.log(`CMake stdout: ${text}`);
          logToFile(`CMake stdout: ${text}`);
        });
        
        cmakeProcess.stderr.on('data', (data) => {
          const text = data.toString();
          output += text;
          // Print CMake errors in real-time for debugging
          console.error(`CMake stderr: ${text}`);
          logToFile(`CMake stderr: ${text}`);
        });
        
        cmakeProcess.on('close', (code) => {
          if (code === 0) {
            logToFile('CMake configuration successful');
            console.log('CMake configuration successful');
            resolve();
          } else {
            logToFile(`CMake configuration failed with code ${code}: ${output}`);
            console.error(`CMake configuration failed with code ${code}: ${output}`);
            reject(new Error(`CMake configuration failed with code ${code}`));
          }
        });
        
        cmakeProcess.on('error', (error) => {
          logToFile(`CMake process error: ${error.message}`);
          console.error(`CMake process error: ${error.message}`);
          reject(error);
        });
      });
      
      logToFile('Building library with CMake...');
      
      // Build with CMake
      await new Promise<void>((resolve, reject) => {
        const buildProcess = spawn('cmake', [
          '--build',
          '.',
          '--config',
          'Release',
          '--verbose'  // Add verbose flag to get more build information
        ], {
          cwd: buildDir
        });
        
        let output = '';
        
        buildProcess.stdout.on('data', (data) => {
          const text = data.toString();
          output += text;
          // Print build output in real-time for debugging
          console.log(`Build stdout: ${text}`);
          logToFile(`Build stdout: ${text}`);
        });
        
        buildProcess.stderr.on('data', (data) => {
          const text = data.toString();
          output += text;
          // Print build errors in real-time for debugging
          console.error(`Build stderr: ${text}`);
          logToFile(`Build stderr: ${text}`);
        });
        
        buildProcess.on('close', (code) => {
          if (code === 0) {
            logToFile('Build successful');
            console.log('Build successful');
            resolve();
          } else {
            logToFile(`Build failed with code ${code}: ${output}`);
            console.error(`Build failed with code ${code}: ${output}`);
            reject(new Error(`Build failed with code ${code}`));
          }
        });
        
        buildProcess.on('error', (error) => {
          logToFile(`Build process error: ${error.message}`);
          console.error(`Build process error: ${error.message}`);
          reject(error);
        });
      });
      
      // Find the built library and binary
      const libName = process.platform === 'win32' 
        ? 'llama.dll' 
        : process.platform === 'darwin' 
          ? 'libllama.dylib' 
          : 'libllama.so';
      
      const binaryName = process.platform === 'win32' 
        ? 'llama-cli.exe' 
        : 'llama-cli';
          
      // Look for the library and binary files in the build directory
      const libraryFiles: string[] = [];
      const binaryFiles: string[] = [];
      
      const findFiles = (dir: string) => {
        try {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
              findFiles(fullPath);
            } else if (file === libName) {
              libraryFiles.push(fullPath);
            } else if (file === binaryName) {
              binaryFiles.push(fullPath);
            }
          }
        } catch (error) {
          logToFile(`Error searching directory ${dir}: ${error}`);
        }
      };
      
      findFiles(buildDir);
      
      if (libraryFiles.length === 0) {
        throw new Error(`Could not find built library file ${libName}`);
      }
      
      // Use the first found library file
      const builtLibPath = libraryFiles[0];
      logToFile(`Found built library at: ${builtLibPath}`);
      
      // Copy library to our lib directory
      const targetLibPath = path.join(this.libPath, libName);
      fs.copyFileSync(builtLibPath, targetLibPath);
      logToFile(`Copied library to: ${targetLibPath}`);
      
      // Copy the binary if found
      if (binaryFiles.length === 0) {
        logToFile(`WARNING: Could not find built binary ${binaryName}. The benchmarks may not work.`);
      } else {
        // Use the first found binary
        const builtBinaryPath = binaryFiles[0];
        logToFile(`Found built binary at: ${builtBinaryPath}`);
        
        // Copy and make executable
        fs.copyFileSync(builtBinaryPath, this.llamaBinaryPath);
        fs.chmodSync(this.llamaBinaryPath, 0o755); // Make executable
        logToFile(`Copied binary to: ${this.llamaBinaryPath}`);
      }
      
      success = true;
      this.isLibraryReady = true;
      logToFile('Library build and installation complete!');
      
    } catch (error) {
      console.error(`Error building library: ${error}`);
      this.logError(`Error building library: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.isBuildingLibrary = false;
      
      // Clean up temp directory (optional)
      try {
        // Commented out to preserve build files for debugging if needed
        // fs.rmSync(tempDir, { recursive: true, force: true });
        // console.log(`Removed temp build directory: ${tempDir}`);
      } catch (error) {
        console.error(`Error cleaning up temp directory: ${error}`);
      }
    }
    
    return success;
  }

  /**
   * Download pre-built library (alternative to building from source)
   * This is a fallback if building fails
   */
  private async downloadPrebuiltLibrary(): Promise<boolean> {
    // Not implemented yet - would require hosting prebuilt libraries somewhere
    console.log('Downloading prebuilt library not implemented yet');
    return false;
  }

  /**
   * Ensure library is ready - build or download if needed
   * Returns a promise that resolves when library is ready
   */
  public async ensureLibraryIsReady(): Promise<boolean> {
    const libName = process.platform === 'win32' 
      ? 'llama.dll' 
      : process.platform === 'darwin' 
        ? 'libllama.dylib' 
        : 'libllama.so';
        
    const libFullPath = path.join(this.libPath, libName);
    
    // If library already exists, we're good
    if (fs.existsSync(libFullPath)) {
      this.isLibraryReady = true;
      return true;
    }
    
    // If already building, wait for it to complete
    if (this.isBuildingLibrary) {
      console.log('Library build already in progress, waiting...');
      
      // Wait for build to complete
      while (this.isBuildingLibrary) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Check if it succeeded
      if (fs.existsSync(libFullPath)) {
        this.isLibraryReady = true;
        return true;
      }
      
      return false;
    }
    
    // Try to build
    console.log('Library not found, attempting to build...');
    const buildSuccess = await this.buildLibrary();
    
    if (buildSuccess) {
      return true;
    }
    
    // If build failed, try downloading prebuilt
    console.log('Build failed, attempting to download prebuilt library...');
    const downloadSuccess = await this.downloadPrebuiltLibrary();
    
    if (downloadSuccess) {
      return true;
    }
    
    // If all else fails
    console.error('Could not obtain library by building or downloading');
    this.logError('Failed to build or download required library. Please install manually.');
    return false;
  }

  /**
   * Log error to the log file
   */
  private logError(message: string): void {
    try {
      const timestamp = new Date().toISOString();
      const logMessage = `[${timestamp}] ERROR: ${message}\n`;
      
      fs.appendFileSync(this.logFilePath, logMessage);
    } catch (error) {
      console.error(`Failed to write to log file: ${error}`);
    }
  }

  /**
   * Log info to the log file
   */
  private logInfo(message: string): void {
    try {
      const timestamp = new Date().toISOString();
      const logMessage = `[${timestamp}] INFO: ${message}\n`;
      
      fs.appendFileSync(this.logFilePath, logMessage);
    } catch (error) {
      console.error(`Failed to write to log file: ${error}`);
    }
  }

  /**
   * Check if any models exist in the models directory
   */
  public hasModels(): boolean {
    try {
      if (!fs.existsSync(this.modelsDir)) {
        return false;
      }
      
      const files = fs.readdirSync(this.modelsDir);
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
  public getAvailableModels(): string[] {
    try {
      if (!fs.existsSync(this.modelsDir)) {
        return [];
      }
      
      const files = fs.readdirSync(this.modelsDir);
      return files
        .filter(file => file.toLowerCase().endsWith('.gguf'))
        .map(file => path.join(this.modelsDir, file));
    } catch (error) {
      console.error(`Error listing model files: ${error}`);
      return [];
    }
  }

  /**
   * Benchmark all models in the models directory
   */
  public async benchmarkAllModels(prompt: string): Promise<any[]> {
    console.log('Starting benchmark of all models...');
    this.logInfo('Starting benchmark of all models');
    
    // Make sure library is ready
    const libraryReady = await this.ensureLibraryIsReady();
    if (!libraryReady) {
      const errorMsg = 'Cannot run benchmarks because required library could not be built or downloaded.';
      console.error(errorMsg);
      this.logError(errorMsg);
      return [{ error: errorMsg }];
    }
    
    // Get all model files
    const modelPaths = this.getAvailableModels();
    
    if (modelPaths.length === 0) {
      const errorMsg = 'No model files found in the models directory. Please add at least one .gguf file.';
      console.error(errorMsg);
      this.logError(errorMsg);
      return [{ error: errorMsg }];
    }
    
    console.log(`Found ${modelPaths.length} models for benchmarking:`);
    modelPaths.forEach(modelPath => console.log(`- ${path.basename(modelPath)}`));
    
    const results = [];
    
    // Test each model
    for (const modelPath of modelPaths) {
      const modelName = path.basename(modelPath);
      const modelNameWithoutExt = path.basename(modelPath, '.gguf');
      console.log(`\n\n===== Testing model: ${modelNameWithoutExt} =====\n`);
      this.logInfo(`Testing model: ${modelNameWithoutExt}`);
      
      try {
        const startTime = Date.now();
        let modelOutput = '';
        let tokenCount = 0;
        
        // Set up environment variables
        const env = { ...process.env };
        
        // Set dynamic library paths based on platform
        if (process.platform === 'darwin') {
          // macOS
          env.DYLD_LIBRARY_PATH = [this.libPath, env.DYLD_LIBRARY_PATH].filter(Boolean).join(':');
          env.DYLD_FALLBACK_LIBRARY_PATH = this.libPath;
        } else if (process.platform === 'linux') {
          // Linux
          env.LD_LIBRARY_PATH = [this.libPath, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
        } else if (process.platform === 'win32') {
          // Windows
          env.PATH = [this.libPath, env.PATH].filter(Boolean).join(path.delimiter);
        }
        
        // Run in the binary directory to make sure relative paths work
        const cwd = path.dirname(this.llamaBinaryPath);
        
        // Run the model with the prompt
        console.log(`Running model with prompt: "${prompt}"`);
        
        // Get the version of llama-cli to check what parameters it supports
        try {
          const versionOutput = execSync(`"${this.llamaBinaryPath}" -h`, { env, cwd }).toString();
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
          const child = spawn(this.llamaBinaryPath, args, { 
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
            this.logInfo(`Benchmark successful for ${modelNameWithoutExt}: ${tokensPerSec.toFixed(2)} tokens/sec`);
          } catch (error) {
            console.error(`Error during model execution: ${error}`);
            this.logError(`Error benchmarking ${modelNameWithoutExt}: ${error}`);
            
            results.push({
              model: modelNameWithoutExt,
              error: error instanceof Error ? error.message : String(error)
            });
          }
          
        } catch (versionError) {
          console.error(`Error checking llama-cli version: ${versionError}`);
          this.logError(`Error checking llama-cli version: ${versionError}`);
          
          // Fallback to basic parameters if we can't check version
          const args = [
            '-m', modelPath,
            '-p', prompt,
            '--temp', '0.7',
            '--seed', '42',
            '--n-predict', '100'
          ];
          
          const child = spawn(this.llamaBinaryPath, args, { env, cwd });
          
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
        this.logError(`Error setting up model ${modelNameWithoutExt}: ${error}`);
        
        results.push({
          model: modelNameWithoutExt,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    // Save benchmark results to file
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const benchmarkPath = path.join(path.dirname(this.logFilePath), `llama-benchmark-${timestamp}.json`);
    
    try {
      fs.writeFileSync(benchmarkPath, JSON.stringify(results, null, 2));
      console.log(`\nBenchmark results saved to ${benchmarkPath}`);
      this.logInfo(`Benchmark results saved to ${benchmarkPath}`);
    } catch (error) {
      console.error(`Error writing benchmark results: ${error}`);
      this.logError(`Error writing benchmark results: ${error}`);
    }
    
    // Print a summary
    console.log(`\n==================================================`);
    console.log(`BENCHMARK RESULTS SUMMARY:`);
    console.log(`==================================================`);
    for (const result of results) {
      if ('error' in result && result.error) {
        console.log(`${result.model}: ERROR - ${result.error}`);
      } else if ('output' in result && result.output) {
        console.log(`${result.model}: ${result.tokensPerSecond.toFixed(2)} tokens/sec, ${result.outputLength} chars`);
      } else {
        console.log(`${result.model}: No output generated`);
      }
    }
    console.log(`==================================================\n`);
    
    return results;
  }
}

// Create a singleton instance
export const llamaService = new LlamaService();

/**
 * Benchmark all available models with a given prompt
 * @param prompt The prompt to test with
 * @returns Promise that resolves with benchmark results
 */
export async function benchmarkAllModels(prompt: string): Promise<any[]> {
  const rawResults = await llamaService.benchmarkAllModels(prompt);
  
  // Transform the results to match the expected structure in the main function
  const formattedResults = rawResults.map(result => {
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
  
  return formattedResults;
}