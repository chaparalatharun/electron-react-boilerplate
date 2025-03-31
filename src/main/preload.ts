// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

export type Channels = 'ipc-example';

// Define types for the llama API
export interface ModelOptions {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  seed?: number;
  contextSize?: number;
  streaming?: boolean;
}

export interface StreamResponse {
  queryId: string;
  chunk?: string;
  fullResponse?: string;
  error?: string;
}

const electronHandler = {
  ipcRenderer: {
    sendMessage(channel: Channels, ...args: unknown[]) {
      ipcRenderer.send(channel, ...args);
    },
    on(channel: Channels, func: (...args: unknown[]) => void) {
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...args);
      ipcRenderer.on(channel, subscription);
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once(channel: Channels, func: (...args: unknown[]) => void) {
      ipcRenderer.once(channel, (_event, ...args) => func(...args));
    },
  },
};

// Llama API for interacting with models
const llamaHandler = {
  // Model management
  hasModels: () => ipcRenderer.invoke('llama:has-models'),
  getModels: () => ipcRenderer.invoke('llama:get-models'),
  checkModels: () => ipcRenderer.invoke('llama:check-models'),
  loadModel: (modelPath: string) => ipcRenderer.invoke('llama:load-model', modelPath),
  
  // Query functions
  queryModel: (prompt: string, options?: ModelOptions) => 
    ipcRenderer.invoke('llama:query-model', { prompt, options }),
  
  // Streaming API
  streamQuery: (prompt: string, options?: ModelOptions) => {
    ipcRenderer.send('llama:stream-query', { prompt, options });
  },
  
  // Stream event handlers
  onStreamStart: (callback: (data: StreamResponse) => void) => {
    const subscription = (_event: IpcRendererEvent, data: StreamResponse) => {
      try {
        callback(data);
      } catch (error) {
        console.error('Error in stream start handler:', error);
      }
    };
    ipcRenderer.on('llama:stream-start', subscription);
    return () => ipcRenderer.removeListener('llama:stream-start', subscription);
  },
  
  onStreamData: (callback: (data: StreamResponse) => void) => {
    const subscription = (_event: IpcRendererEvent, data: StreamResponse) => {
      try {
        callback(data);
      } catch (error) {
        console.error('Error in stream data handler:', error);
      }
    };
    ipcRenderer.on('llama:stream-data', subscription);
    return () => ipcRenderer.removeListener('llama:stream-data', subscription);
  },
  
  onStreamEnd: (callback: (data: StreamResponse) => void) => {
    const subscription = (_event: IpcRendererEvent, data: StreamResponse) => {
      try {
        callback(data);
      } catch (error) {
        console.error('Error in stream end handler:', error);
      }
    };
    ipcRenderer.on('llama:stream-end', subscription);
    return () => ipcRenderer.removeListener('llama:stream-end', subscription);
  },
  
  onStreamError: (callback: (data: StreamResponse) => void) => {
    const subscription = (_event: IpcRendererEvent, data: StreamResponse) => {
      try {
        callback(data);
      } catch (error) {
        console.error('Error in stream error handler:', error);
      }
    };
    ipcRenderer.on('llama:stream-error', subscription);
    return () => ipcRenderer.removeListener('llama:stream-error', subscription);
  },
  
  // Process management
  stopProcesses: () => ipcRenderer.invoke('llama:stop-processes'),
};

// Expose the APIs to the renderer process
contextBridge.exposeInMainWorld('electron', electronHandler);
contextBridge.exposeInMainWorld('llama', llamaHandler);

// Export types
export type ElectronHandler = typeof electronHandler;
export type LlamaHandler = typeof llamaHandler;