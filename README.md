## Configuration

The LlamaService can be configured through the following options when calling `queryModel`:

```typescript
// Example options
const options = {
  temperature: 0.7,    // Controls randomness (0.0 to 1.0)
  topP: 0.9,           // Nucleus sampling parameter
  maxTokens: 500,      // Maximum tokens to generate
  seed: 42,            // Random seed for reproducibility
  contextSize: 2048,   // Context window size
  streaming: false     // Whether to stream the response
};

// Query with options
const response = await llamaService.queryModel("Your prompt here", options);
```

These options let you fine-tune the model's behavior for different use cases:
- Higher temperature (>0.7) produces more creative outputs
- Lower temperature (<0.3) produces more deterministic outputs
- Higher maxTokens allows for longer responses but takes more time
- Streaming mode is ideal for real-time UI updates## IPC Communication

The application uses Electron's IPC (Inter-Process Communication) system to communicate between the renderer process (UI) and the main process (where LlamaService runs). The following IPC channels are available:

### From Renderer to Main Process
- `llama:has-models`: Checks if any models are available
- `llama:get-models`: Gets a list of available model paths
- `llama:check-models`: Gets detailed model information (size, type, quantization)
- `llama:load-model`: Loads a specific model for use
- `llama:query-model`: Queries a model with a prompt (non-streaming)
- `llama:stream-query`: Starts a streaming query
- `llama:stop-processes`: Stops all running model processes

### From Main to Renderer Process
- `llama:stream-start`: Notifies that streaming has started
- `llama:stream-data`: Delivers a chunk of text during streaming
- `llama:stream-error`: Notifies of an error during streaming
- `llama:stream-end`: Notifies that streaming has completed

This IPC system allows the React UI to interact with the LlamaService running in the main Electron process.# Electron + Local LLM Application

This application integrates a Local Large Language Model (LLM) with Electron, using React for the frontend and llama.cpp for the model inference. Designed for cross-platform desktop usage, it leverages your local GPU resources for optimized inference.

## Technology Stack
- **Electron**: Cross-platform desktop application framework.
- **React**: Frontend UI built with React and React Router.
- **Webpack**: Module bundler and build tool.
- **llama.cpp**: High-performance inference engine for local Large Language Models.
- **Electron React Boilerplate**: Application structure and build pipeline.

## Prerequisites
Ensure you have the following prerequisites installed:
- **Git**: Required for cloning repositories.
  - [Install Git](https://git-scm.com/downloads)
- **C++ Compiler**: Required to build llama.cpp locally.
  - Windows: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  - macOS: Install Xcode Command Line Tools (`xcode-select --install`)
  - Linux: Install GCC (`sudo apt install build-essential` or equivalent)

*You do not need to manually download and build llama.cpp; the application will automatically handle cloning and compiling the necessary binaries for you.*

## Installation
Clone the repository and install dependencies:
```bash
git clone <your-repo-url>
cd <your-project-name>
npm install
```

If you encounter issues, check the [debugging guide](https://github.com/electron-react-boilerplate/electron-react-boilerplate/issues/400).

## Starting Development
When you run:
```bash
npm start
```
it initializes the application. The LLM models should be placed in the `assets/llama/models` directory. Place your `.gguf` file(s) in this folder to make them available to the application.

## Scripts

The application includes several utility scripts to help with development and testing:

### Build Llama Script
Located at `/scripts/build-llama.ts`, this script handles setting up the llama.cpp environment:

```bash
npm run build-llama
```

The script performs the following actions:
- Clones the llama.cpp repository from GitHub
- Compiles the source code with platform-specific optimizations
- Copies the resulting binaries and libraries to the appropriate locations in `/assets/llama/`
- Sets up the necessary directory structure for the application

### Benchmark Script
Located at `/scripts/benchmark.ts`, this script benchmarks LLM models:

```bash
npm run benchmark [options]
```

Options:
- `--prompt "Your prompt here"`: Specify a custom prompt for benchmarking
- `--models-dir "/path/to/models"`: Specify a custom directory containing model files

The script automatically discovers all GGUF models in the models directory and benchmarks them one by one, generating performance metrics for comparison.

## Benchmarking Models

The application includes a comprehensive benchmarking tool to evaluate the performance of your LLM models:

```bash
npm run benchmark
```

You can also provide a custom prompt for benchmarking:

```bash
npm run benchmark -- --prompt "Your custom prompt here"
```

### What the Benchmark Measures

The benchmark script evaluates each model in your `assets/llama/models` directory and provides detailed metrics:

- **Tokens Per Second**: Processing speed of the model
- **Setup Time**: Time required to load the model into memory
- **Generation Time**: Time spent actually generating the response
- **Total Time**: Complete runtime from start to finish
- **Output Length**: Character count of the generated response
- **Token Count**: Number of tokens processed

### Benchmark Process

For each model, the script:

1. Loads the model using the LLaMa binary
2. Runs inference with the specified prompt (default: "Explain the theory of relativity in simple terms")
3. Measures performance metrics during execution
4. Handles various model types and configurations automatically
5. Adapts command-line parameters based on the detected llama-cli version

### Benchmark Output

Results are saved in two formats:
- **Console output**: A summary table displaying all models and their performance
- **JSON file**: Detailed metrics saved to `logs/llama-benchmark-[timestamp].json`

The JSON output can be useful for comparing models over time or creating performance visualizations.

Log files from benchmarks and runtime operations are stored at:
- **Development mode**: `<project-root>/logs`
- **Production mode**: `{userData}/logs`

## Packaging for Production
To package the application for your platform:
```bash
npm run package
```

## Directory Structure
Please note the actual directory structure of the repository:

```
├── assets
│   └── llama
│       ├── bin      # Contains llama-cli binary
│       ├── lib      # Contains dynamic libraries (libllama.so, llama.dll, etc.)
│       └── models   # Place your .gguf model files here
├── src
│   ├── main         # Main process code
│   │   ├── llama-service.ts  # The LlamaService implementation
│   │   └── main.ts    # Main entry point with IPC handlers 
│   └── renderer     # Frontend UI code
│       └── components  # React components for the UI
├── scripts
│   ├── build-llama.ts   # Script to build llama.cpp
│   └── benchmark.ts     # Script for benchmarking models
└── logs             # Log files for development mode
```

- `/assets/llama/bin`: Contains the compiled llama.cpp binaries
- `/assets/llama/lib`: Stores shared libraries needed for inference
- `/assets/llama/models`: Place your `.gguf` LLM model files here
- `/logs`: Stores logs related to model initialization and errors (in development mode)
- `/scripts`: Contains utility scripts for building and benchmarking
- `/src/main`: Contains the Electron main process code including LlamaService
- `/src/renderer/components`: Contains React components for the UI

## LlamaService API

The application provides a comprehensive `LlamaService` to interact with LLM models:

### Model Management
- `hasModels()`: Checks if any models exist in the models directory.
- `getAvailableModels()`: Returns a list of available model file paths.
- `checkModels()`: Examines model files and returns detailed information including size, type, and quantization level.
- `loadModel(modelPath)`: Loads a specific model for inference.

### Inference
- `queryModel(prompt, options)`: Sends a prompt to the model and returns its response.
  - Options include: temperature, topP, maxTokens, seed, contextSize, and streaming.
  - Supports two query modes:
    - **Standard Query**: Returns the complete response when finished (when `streaming: false`)
    - **Streaming Query**: Emits chunks of text as they're generated (when `streaming: true`)
- `stopAllProcesses()`: Terminates all active model processes.

### Event-based Streaming
The service extends EventEmitter to enable streaming responses:
- `data` event: Emitted for each text chunk during streaming.
- `error` event: Emitted when an error occurs.
- `end` event: Emitted when the response is complete.

### Cross-platform Support
The service is designed to work across:
- Windows
- macOS
- Linux

## Maintainers
- [Tharun Chaparala](https://github.com/chaparalatharun)