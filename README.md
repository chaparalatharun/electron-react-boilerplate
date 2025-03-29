# Electron + Local LLM Application

This application integrates a Local Large Language Model (LLM) with Electron, using React for the frontend and llama.cpp for the model inference. Designed for cross-platform desktop usage, it leverages your local GPU resources for optimized inference.

---

## Technology Stack

- **Electron**: Cross-platform desktop application framework.
- **React**: Frontend UI built with React and React Router.
- **Webpack**: Module bundler and build tool.
- **llama.cpp**: High-performance inference engine for local Large Language Models.
- **Electron React Boilerplate**: Application structure and build pipeline.

---

## Prerequisites

Ensure you have the following prerequisites installed:

- **Git**: Required for cloning repositories.
  - [Install Git](https://git-scm.com/downloads)
- **C++ Compiler**: Required to build llama.cpp locally.
  - Windows: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  - macOS: Install Xcode Command Line Tools (`xcode-select --install`)
  - Linux: Install GCC (`sudo apt install build-essential` or equivalent)

*You do not need to manually download and build llama.cpp; the application will automatically handle cloning and compiling the necessary binaries for you.*

---

## Installation

Clone the repository and install dependencies:

```bash
git clone <your-repo-url>
cd <your-project-name>
npm install
```

If you encounter issues, check the [debugging guide](https://github.com/electron-react-boilerplate/electron-react-boilerplate/issues/400).

---

## Starting Development

When you run:

```bash
npm start
```

it creates a folder named `llama` within the `src/main` directory, including a subdirectory called `models`. Place the `.gguf` file(s) of the model(s) you want to benchmark into this `models` folder.

---

## Benchmarking Models

Once you've placed all model files you wish to benchmark into the `models` directory, run the following command to benchmark the available local LLM models:

```bash
BENCHMARK=true npm start
```

This command performs the following actions:
- Automatically clones the llama.cpp repository.
- Compiles and installs the llama.cpp binaries and libraries.
- Runs a benchmark test on each model present in the `models` directory.
- Logs detailed benchmark results, including performance metrics like tokens per second, setup time, and generation time.

Log files from benchmarks and runtime operations are stored at:
- **Development mode**: `<project-root>/logs`
- **Production mode**: `{userData}/logs`

*Note*: The benchmark will not run if you simply execute `npm start` without setting `BENCHMARK=true`.

---

## Packaging for Production

To package the application for your platform:

```bash
npm run package
```

---

## Directory Structure

```
├── src
│   ├── main
│   │   ├── llama
│   │   │   ├── bin
│   │   │   ├── lib
│   │   │   └── models
│   ├── renderer
│   │   ├── components
│   │   └── containers
├── resources
└── logs
```

- `bin`: Contains the compiled llama.cpp binaries.
- `lib`: Shared libraries needed for inference.
- `models`: Place your `.gguf` LLM model files here.
- `logs`: Stores logs related to model initialization, benchmarking, and runtime errors.

---


## Maintainers

- [Tharun Chaparala](https://github.com/chaparalatharun)

