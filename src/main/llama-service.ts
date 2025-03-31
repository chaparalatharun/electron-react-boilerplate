import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { EventEmitter } from 'events';
import { app } from 'electron';

// Interface for model options
export interface ModelOptions {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  seed?: number;
  contextSize?: number;
  streaming?: boolean;
}

// Interface for model information
export interface ModelInfo {
  name: string;
  path: string;
  size: number;
  formattedSize: string;
  lastModified: Date;
  isValid: boolean;
  modelType: string;
  quantization: string;
}

// Default model options
const DEFAULT_OPTIONS: ModelOptions = {
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 500,
  seed: 42,
  contextSize: 2048,
  streaming: false
};

export class LlamaService extends EventEmitter {
  private llamaBinaryPath: string;
  private libPath: string;
  private modelsDir: string;
  private logFilePath: string;
  private isLibraryReady: boolean = false;
  private activeModel: string | null = null;
  private activeProcesses: Map<string, any> = new Map();
  
  constructor() {
    super(); // Initialize EventEmitter
    
    // Determine if we're in development or production mode
    const isDev = process.env.NODE_ENV === 'development';
    const appPath = app.getAppPath();
    
    // Set up directory paths based on environment
    if (isDev) {
      // Development paths
      this.llamaBinaryPath = path.join(appPath, 'assets', 'llama', 'bin', 'llama-cli');
      this.libPath = path.join(appPath, 'assets', 'llama', 'lib');
      this.modelsDir = path.join(appPath, 'assets', 'llama', 'models');
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
      
    this.logFilePath = path.join(logDir, 'llama-service.log');
    
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
    // Check if library exists
    this.checkLibraryExists();
  }

  /**
   * Check if required library exists
   */
  private checkLibraryExists(): void {
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
    
    console.log(`Library ${libName} not found. Please run the build-llama script to generate it.`);
    this.logError(`Required library ${libName} not found. Run 'npm run build-llama' to create it.`);
  }

  /**
   * Ensure library is ready
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
    
    // Library is missing
    console.error(`Required library ${libName} not found.`);
    this.logError(`Required library ${libName} not found. Run 'npm run build-llama' to create it.`);
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
   * Check model files and return detailed information about them
   * @returns Promise that resolves with detailed model information
   */
  public async checkModels(): Promise<ModelInfo[]> {
    try {
      // Get all model files
      const modelPaths = this.getAvailableModels();
      
      if (modelPaths.length === 0) {
        console.log('No model files found in the models directory.');
        return [];
      }
      
      console.log(`Found ${modelPaths.length} models:`);
      
      const modelInfo: ModelInfo[] = [];
      
      // Check each model file
      for (const modelPath of modelPaths) {
        const fileName = path.basename(modelPath);
        const stats = fs.statSync(modelPath);
        
        // Get file size in a human-readable format
        const sizeInMB = stats.size / (1024 * 1024);
        const formattedSize = sizeInMB < 1000 
          ? `${sizeInMB.toFixed(2)} MB` 
          : `${(sizeInMB / 1024).toFixed(2)} GB`;
        
        console.log(`- ${fileName} (${formattedSize})`);
        
        // Try to validate the model by checking its header
        let isValid = true;
        let modelType = "Unknown";
        let quantization = "Unknown";
        
        try {
          // Read the first few bytes to check if it's a valid GGUF file
          const header = Buffer.alloc(16);
          const fd = fs.openSync(modelPath, 'r');
          fs.readSync(fd, header, 0, 16, 0);
          fs.closeSync(fd);
          
          // GGUF files start with "GGUF" in ASCII
          if (header.toString('ascii', 0, 4) === 'GGUF') {
            modelType = "GGUF";
            
            // Try to determine quantization from filename
            if (fileName.includes('Q4_0')) quantization = "Q4_0";
            else if (fileName.includes('Q4_K_M')) quantization = "Q4_K_M";
            else if (fileName.includes('Q5_0')) quantization = "Q5_0";
            else if (fileName.includes('Q5_K_M')) quantization = "Q5_K_M";
            else if (fileName.includes('Q8_0')) quantization = "Q8_0";
            else quantization = "Unknown";
          } else {
            isValid = false;
          }
        } catch (error) {
          console.error(`Error validating model ${fileName}: ${error}`);
          isValid = false;
        }
        
        modelInfo.push({
          name: fileName,
          path: modelPath,
          size: stats.size,
          formattedSize,
          lastModified: stats.mtime,
          isValid,
          modelType,
          quantization
        });
      }
      
      return modelInfo;
    } catch (error) {
      console.error(`Error checking models: ${error}`);
      this.logError(`Error checking models: ${error}`);
      return [];
    }
  }

  /**
   * Load a specific model
   * @param modelPath Path to the model file
   * @returns Promise that resolves when the model is loaded
   */
  public async loadModel(modelPath: string): Promise<boolean> {
    // Make sure library is ready
    const libraryReady = await this.ensureLibraryIsReady();
    if (!libraryReady) {
      const errorMsg = 'Cannot load model because required library could not be found.';
      console.error(errorMsg);
      this.logError(errorMsg);
      return false;
    }

    // If a path is given, use it directly
    let fullModelPath = modelPath;
    
    // If just a name is given, look in the models directory
    if (!path.isAbsolute(modelPath) && !modelPath.includes('/') && !modelPath.includes('\\')) {
      const availableModels = this.getAvailableModels();
      const matchingModels = availableModels.filter(m => path.basename(m).includes(modelPath));
      
      if (matchingModels.length === 0) {
        console.error(`No model matching '${modelPath}' found in ${this.modelsDir}`);
        return false;
      }
      
      fullModelPath = matchingModels[0];
    }
    
    // Check if the model file exists
    if (!fs.existsSync(fullModelPath)) {
      console.error(`Model file not found: ${fullModelPath}`);
      return false;
    }
    
    console.log(`Loading model: ${path.basename(fullModelPath)}`);
    this.activeModel = fullModelPath;
    return true;
  }

  /**
   * Get the environment variables needed for llama process
   */
  private getProcessEnvironment(): NodeJS.ProcessEnv {
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
    
    return env;
  }

  /**
   * Query a model with a prompt
   * @param prompt The prompt to send to the model
   * @param options Options for the model
   * @returns Promise that resolves with the model's response
   */
  public async queryModel(prompt: string, options: ModelOptions = {}): Promise<string> {
    if (!this.activeModel) {
      throw new Error('No model loaded. Please call loadModel() first.');
    }
    
    const modelPath = this.activeModel;
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
    
    // Make sure library is ready
    const libraryReady = await this.ensureLibraryIsReady();
    if (!libraryReady) {
      throw new Error('Required library not found. Run npm run build-llama to create it.');
    }
    
    console.log(`Querying model with prompt: "${prompt}"`);
    this.logInfo(`Querying model: ${path.basename(modelPath)}`);
    
    // Set up environment variables
    const env = this.getProcessEnvironment();
    
    // Run in the binary directory to make sure relative paths work
    const cwd = path.dirname(this.llamaBinaryPath);
    
    try {
      // Get the version of llama-cli to check what parameters it supports
      const versionOutput = execSync(`"${this.llamaBinaryPath}" -h`, { env, cwd }).toString();
      
      // Build command line arguments
      const args = [
        '-m', modelPath,
        '-p', prompt,
        '--temp', mergedOptions.temperature!.toString(),
        '--seed', mergedOptions.seed!.toString(),
        '--ctx-size', mergedOptions.contextSize!.toString(),
        '--n-predict', mergedOptions.maxTokens!.toString(),
        '--threads', Math.max(1, os.cpus().length - 1).toString()
      ];
      
      // Add parameters that might be specific to certain versions
      if (versionOutput.includes('--top-p')) {
        args.push('--top-p', mergedOptions.topP!.toString());
      }
      
      if (versionOutput.includes('--no-display-prompt')) {
        args.push('--no-display-prompt');
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
      
      if (mergedOptions.streaming) {
        return this.streamingQuery(args, env, cwd);
      } else {
        return this.standardQuery(args, env, cwd);
      }
    } catch (error) {
      console.error(`Error querying model: ${error}`);
      this.logError(`Error querying model: ${error}`);
      throw error;
    }
  }

  /**
   * Standard non-streaming query to the model
   */
  private async standardQuery(args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      // Start the child process
      const child = spawn(this.llamaBinaryPath, args, { 
        env, 
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      // Generate a unique ID for this process
      const processId = `query_${Date.now()}`;
      this.activeProcesses.set(processId, child);
      
      let modelOutput = '';
      
      // Handle possible interactive mode by closing stdin immediately
      if (child.stdin) {
        child.stdin.end();
      }
      
      // Collect output
      child.stdout.on('data', (data) => {
        const text = data.toString();
        modelOutput += text;
      });
      
      // Handle errors
      child.stderr.on('data', (data) => {
        const err = data.toString();
        console.error(`Model stderr: ${err}`);
      });
      
      // Handle process completion
      child.on('close', (code) => {
        this.activeProcesses.delete(processId);
        
        if (code === 0) {
          resolve(modelOutput);
        } else {
          reject(new Error(`Model process exited with code ${code}`));
        }
      });
      
      // Handle process errors
      child.on('error', (error) => {
        this.activeProcesses.delete(processId);
        reject(error);
      });
    });
  }

  /**
   * Streaming query that returns an EventEmitter
   */
  private streamingQuery(args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      try {
        // Start the child process
        const child = spawn(this.llamaBinaryPath, args, { 
          env, 
          cwd,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        
        // Generate a unique ID for this process
        const processId = `stream_${Date.now()}`;
        this.activeProcesses.set(processId, { process: child });
        
        let fullOutput = '';
        
        // Handle possible interactive mode by closing stdin immediately
        if (child.stdin) {
          child.stdin.end();
        }
        
        // Collect and emit output
        child.stdout.on('data', (data) => {
          try {
            const text = data.toString();
            fullOutput += text;
            // Emit from the LlamaService instance directly
            this.emit('data', text);
          } catch (error) {
            console.error('Error processing stdout data:', error);
          }
        });
        
        // Handle errors
        child.stderr.on('data', (data) => {
          try {
            const err = data.toString();
            console.error(`Model stderr: ${err}`);
            // Don't treat stderr as an error unless it's clearly an error message
            // Many LLMs output debug info to stderr
            if (err.toLowerCase().includes('error') || 
                err.toLowerCase().includes('exception') || 
                err.toLowerCase().includes('fatal')) {
              this.emit('error', err);
            }
          } catch (error) {
            console.error('Error processing stderr data:', error);
          }
        });
        
        // Handle process completion
        child.on('close', (code) => {
          try {
            this.activeProcesses.delete(processId);
            
            if (code === 0 || code === null) {
              // Emit from the LlamaService instance directly
              this.emit('end', fullOutput);
              resolve(fullOutput);
            } else {
              const error = new Error(`Model process exited with code ${code}`);
              // Emit from the LlamaService instance directly
              this.emit('error', error);
              reject(error);
            }
          } catch (error) {
            console.error('Error in process close handler:', error);
            reject(error);
          }
        });
        
        // Handle process errors
        child.on('error', (error) => {
          try {
            this.activeProcesses.delete(processId);
            // Emit from the LlamaService instance directly
            this.emit('error', error);
            reject(error);
          } catch (innerError) {
            console.error('Error in process error handler:', innerError);
            reject(innerError);
          }
        });
      } catch (error) {
        console.error('Error setting up streaming query:', error);
        reject(error);
      }
    });
  }

  /**
   * Stop all active model processes
   */
  public stopAllProcesses(): void {
    for (const [id, processData] of this.activeProcesses) {
      try {
        if ('process' in processData) {
          processData.process.kill('SIGINT');
        } else {
          processData.kill('SIGINT');
        }
        console.log(`Stopped process ${id}`);
      } catch (error) {
        console.error(`Error stopping process ${id}: ${error}`);
      }
    }
    
    this.activeProcesses.clear();
  }
}

// Create a singleton instance
export const llamaService = new LlamaService();