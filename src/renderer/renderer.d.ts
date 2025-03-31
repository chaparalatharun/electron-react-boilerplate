// src/renderer/renderer.d.ts
import { ElectronHandler } from '../main/preload';

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

interface LlamaAPI {
  // Model management
  hasModels: () => Promise<boolean>;
  getModels: () => Promise<string[]>;
  checkModels: () => Promise<ModelInfo[]>;
  loadModel: (modelPath: string) => Promise<{success: boolean, error?: string}>;
  
  // Query functions
  queryModel: (prompt: string, options?: ModelOptions) => 
    Promise<{success: boolean, response?: string, error?: string}>;
  
  // Streaming API
  streamQuery: (prompt: string, options?: ModelOptions) => void;
  
  // Stream event handlers
  onStreamStart: (callback: (data: StreamResponse) => void) => () => void;
  onStreamData: (callback: (data: StreamResponse) => void) => () => void;
  onStreamEnd: (callback: (data: StreamResponse) => void) => () => void;
  onStreamError: (callback: (data: StreamResponse) => void) => () => void;
  
  // Process management
  stopProcesses: () => Promise<{success: boolean, error?: string}>;
}

declare global {
  interface Window {
    // Keep the existing electron definition
    electron: ElectronHandler;
    // Add the llama API
    llama: LlamaAPI;
  }
}