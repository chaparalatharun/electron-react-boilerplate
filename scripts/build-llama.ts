// scripts/build-llama.ts
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Define paths - can be passed as command line args
const appPath = process.argv[2] || process.cwd();
const libPath = path.join(appPath, 'assets', 'llama', 'lib');
const binPath = path.join(appPath, 'assets', 'llama', 'bin');
const logDir = path.join(appPath, 'logs');
const buildLogPath = path.join(logDir, 'llama-build.log');

// Ensure directories exist
ensureDirectoriesExist();

console.log('Starting llama.cpp build process...');
console.log(`Libraries will be placed in: ${libPath}`);
console.log(`Binaries will be placed in: ${binPath}`);

// Start the build process
buildLibrary()
  .then(success => {
    if (success) {
      console.log('Library build completed successfully!');
      process.exit(0);
    } else {
      console.error('Library build failed.');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error(`Build error: ${error}`);
    process.exit(1);
  });

function ensureDirectoriesExist(): void {
  // Create lib directory if it doesn't exist
  if (!fs.existsSync(libPath)) {
    fs.mkdirSync(libPath, { recursive: true });
    console.log(`Created lib directory at: ${libPath}`);
  }
  
  // Create bin directory if it doesn't exist
  if (!fs.existsSync(binPath)) {
    fs.mkdirSync(binPath, { recursive: true });
    console.log(`Created bin directory at: ${binPath}`);
  }
  
  // Create log directory if it doesn't exist
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
    console.log(`Created log directory at: ${logDir}`);
  }
}

function logToFile(message: string): void {
  try {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    fs.appendFileSync(buildLogPath, logMessage);
  } catch (error) {
    console.error(`Failed to write to log file: ${error}`);
  }
}

async function buildLibrary(): Promise<boolean> {
  // Check if library and binary already exist
  const libName = process.platform === 'win32' 
    ? 'llama.dll' 
    : process.platform === 'darwin' 
      ? 'libllama.dylib' 
      : 'libllama.so';
  
  const binaryName = process.platform === 'win32' 
    ? 'llama-cli.exe' 
    : 'llama-cli';
  
  const libExists = fs.existsSync(path.join(libPath, libName));
  const binaryExists = fs.existsSync(path.join(binPath, binaryName));
  
  if (libExists && binaryExists) {
    console.log(`Library ${libName} and binary ${binaryName} already exist.`);
    console.log(`If you want to rebuild, please delete them first.`);
    return true;
  }
  
  console.log('Starting to build llama.cpp library');
  logToFile('Starting to build llama.cpp library');
  
  const tempDir = path.join(os.tmpdir(), 'llama-build-' + Date.now());
  let success = false;
  
  try {
    // Create temp directory for building
    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`Created temp build directory: ${tempDir}`);
    
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
        console.log(data.toString());
      });
      
      gitProcess.stderr.on('data', (data) => {
        output += data.toString();
        console.error(data.toString());
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
        console.log(`CMake: ${text}`);
      });
      
      cmakeProcess.stderr.on('data', (data) => {
        const text = data.toString();
        output += text;
        console.error(`CMake error: ${text}`);
      });
      
      cmakeProcess.on('close', (code) => {
        if (code === 0) {
          logToFile('CMake configuration successful');
          resolve();
        } else {
          logToFile(`CMake configuration failed with code ${code}: ${output}`);
          reject(new Error(`CMake configuration failed with code ${code}`));
        }
      });
      
      cmakeProcess.on('error', (error) => {
        logToFile(`CMake process error: ${error.message}`);
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
        console.log(`Build: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);
      });
      
      buildProcess.stderr.on('data', (data) => {
        const text = data.toString();
        output += text;
        console.error(`Build error: ${text}`);
      });
      
      buildProcess.on('close', (code) => {
        if (code === 0) {
          logToFile('Build successful');
          resolve();
        } else {
          logToFile(`Build failed with code ${code}: ${output}`);
          reject(new Error(`Build failed with code ${code}`));
        }
      });
      
      buildProcess.on('error', (error) => {
        logToFile(`Build process error: ${error.message}`);
        reject(error);
      });
    });
    
    // Find the built library and binary
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
          } else if (file === binaryName || file === binaryName + '.exe') {
            binaryFiles.push(fullPath);
          }
        }
      } catch (error) {
        logToFile(`Error searching directory ${dir}: ${error}`);
      }
    };
    
    findFiles(buildDir);
    
    // Check if we need to copy the library
    if (!libExists) {
      if (libraryFiles.length === 0) {
        throw new Error(`Could not find built library file ${libName}`);
      }
      
      // Use the first found library file
      const builtLibPath = libraryFiles[0];
      logToFile(`Found built library at: ${builtLibPath}`);
      
      // Copy library to our lib directory
      const targetLibPath = path.join(libPath, libName);
      fs.copyFileSync(builtLibPath, targetLibPath);
      logToFile(`Copied library to: ${targetLibPath}`);
    }
    
    // Check if we need to copy the binary
    if (!binaryExists) {
      if (binaryFiles.length === 0) {
        logToFile(`WARNING: Could not find built binary ${binaryName}. Looking in other locations...`);
        
        // Try looking directly in the build directory
        const possibleBinaryLocations = [
          path.join(buildDir, binaryName),
          path.join(buildDir, 'bin', binaryName),
          path.join(buildDir, 'Release', binaryName),
          path.join(buildDir, 'Debug', binaryName)
        ];
        
        for (const location of possibleBinaryLocations) {
          if (fs.existsSync(location)) {
            binaryFiles.push(location);
            break;
          }
          
          // Check for .exe extension on Windows
          if (process.platform === 'win32' && fs.existsSync(location + '.exe')) {
            binaryFiles.push(location + '.exe');
            break;
          }
        }
      }
      
      if (binaryFiles.length === 0) {
        logToFile(`ERROR: Could not find the ${binaryName} binary.`);
      } else {
        // Use the first found binary
        const builtBinaryPath = binaryFiles[0];
        logToFile(`Found built binary at: ${builtBinaryPath}`);
        
        // Copy and make executable
        const targetBinaryPath = path.join(binPath, binaryName);
        fs.copyFileSync(builtBinaryPath, targetBinaryPath);
        fs.chmodSync(targetBinaryPath, 0o755); // Make executable
        logToFile(`Copied binary to: ${targetBinaryPath}`);
      }
    }
    
    success = true;
    logToFile('Library build and installation complete!');
    
  } catch (error) {
    console.error(`Error building library: ${error}`);
    logToFile(`Error building library: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // Clean up temp directory (optional)
    try {
      console.log(`Build files preserved at: ${tempDir} for inspection if needed.`);
      console.log('You can delete this directory manually once you verify the build.');
    } catch (error) {
      console.error(`Error cleaning up temp directory: ${error}`);
    }
  }
  
  return success;
}