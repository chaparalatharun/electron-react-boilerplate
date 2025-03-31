/* eslint global-require: off, no-console: off, promise/always-return: off */
/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import path from 'path';
import { app, BrowserWindow, shell, ipcMain } from 'electron';
import fs from 'fs';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './util';
import { llamaService } from './llama-service'; // Import the service


process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in main process:', error);
  
  // Log to file
  try {
    const logDir = app.getPath('userData');
    const logFile = path.join(logDir, 'uncaught-exceptions.log');
    
    // Ensure log directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Log the error with timestamp
    const timestamp = new Date().toISOString();
    fs.appendFileSync(
      logFile, 
      `[${timestamp}] Uncaught exception: ${error.message}\n${error.stack}\n\n`
    );
  } catch (logError) {
    console.error('Error logging uncaught exception:', logError);
  }
});

class AppUpdater {
  constructor() {
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    autoUpdater.checkForUpdatesAndNotify();
  }
}

let mainWindow: BrowserWindow | null = null;

// Set up IPC handlers for LlamaService
function setupLlamaIpcHandlers() {
  // Check if models are available
  ipcMain.handle('llama:has-models', async () => {
    return llamaService.hasModels();
  });

  // Get list of available models
  ipcMain.handle('llama:get-models', async () => {
    return llamaService.getAvailableModels();
  });

  // Get detailed model information
  ipcMain.handle('llama:check-models', async () => {
    return llamaService.checkModels();
  });

  // Load a model
  ipcMain.handle('llama:load-model', async (_, modelPath) => {
    try {
      const success = await llamaService.loadModel(modelPath);
      return { success };
    } catch (error) {
      console.error('Error loading model:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  });

  // Query a model with a prompt
  ipcMain.handle('llama:query-model', async (_, { prompt, options }) => {
    try {
      const response = await llamaService.queryModel(prompt, options);
      return { success: true, response };
    } catch (error) {
      console.error('Error querying model:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  });

  // Handle streaming queries
  // Handle streaming queries
ipcMain.on('llama:stream-query', async (event, { prompt, options }) => {
  try {
    // Create a unique ID for this query
    const queryId = Date.now().toString();
    
    // Set up the streaming options
    const streamingOptions = { 
      ...options, 
      streaming: true,
      // Use conservative settings for streaming
      contextSize: Math.min(options.contextSize || 2048, 512),
      maxTokens: Math.min(options.maxTokens || 500, 100),
      batchSize: 64
    };
    
    // Set up event listeners before making the query
    const dataHandler = (chunk: string) => {
      try {
        event.reply('llama:stream-data', { queryId, chunk });
      } catch (error) {
        console.error('Error in data handler:', error);
      }
    };
    
    const errorHandler = (error: Error | string) => {
      try {
        const errorMessage = error instanceof Error ? error.message : String(error);
        event.reply('llama:stream-error', { queryId, error: errorMessage });
        cleanup();
      } catch (innerError) {
        console.error('Error in error handler:', innerError);
      }
    };
    
    const endHandler = (fullResponse: string) => {
      try {
        event.reply('llama:stream-end', { queryId, fullResponse });
        cleanup();
      } catch (innerError) {
        console.error('Error in end handler:', innerError);
      }
    };
    
    // Clean up function to remove listeners
    const cleanup = () => {
      try {
        llamaService.removeListener('data', dataHandler);
        llamaService.removeListener('error', errorHandler);
        llamaService.removeListener('end', endHandler);
      } catch (error) {
        console.error('Error cleaning up listeners:', error);
      }
    };
    
    // Add listeners to the emitter
    llamaService.on('data', dataHandler);
    llamaService.on('error', errorHandler);
    llamaService.on('end', endHandler);
    
    // Notify that streaming is starting
    event.reply('llama:stream-start', { queryId });
    
    // Start the streaming query
    try {
      llamaService.queryModel(prompt, streamingOptions)
        .catch((error) => {
          console.error('Error in streaming query:', error);
          errorHandler(error);
        });
    } catch (error) {
      console.error('Error starting streaming query:', error);
      errorHandler(error);
    }
    
  } catch (error) {
    console.error('Global error in stream handler:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    event.reply('llama:stream-error', { error: errorMessage });
  }
});

  // Stop all active model processes
  ipcMain.handle('llama:stop-processes', async () => {
    try {
      llamaService.stopAllProcesses();
      return { success: true };
    } catch (error) {
      console.error('Error stopping processes:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  });
}

ipcMain.on('ipc-example', async (event, arg) => {
  const msgTemplate = (pingPong: string) => `IPC test: ${pingPong}`;
  console.log(msgTemplate(arg));
  event.reply('ipc-example', msgTemplate('pong'));
});

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  require('electron-debug').default();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];
  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload,
    )
    .catch(console.log);
};

const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    icon: getAssetPath('icon.png'),
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
  });

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });

  // Set up IPC handlers
  setupLlamaIpcHandlers();

  new AppUpdater();
};

app.on('window-all-closed', () => {
  // Stop all active model processes when closing the app
  llamaService.stopAllProcesses();
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app
  .whenReady()
  .then(() => {
    createWindow();
    app.on('activate', () => {
      if (mainWindow === null) createWindow();
    });
  })
  .catch(console.log);