# Development setup

## Prerequisites

- macOS
- Node.js 20 or newer with npm
- CMake 3.20 or newer
- Xcode Command Line Tools, including Apple Clang

## Install and run

From the repository root:

```sh
npm install
npm run dev
```

The development command compiles `creator-media-core` into `core/build/bin/` and then starts the Babu Studio Electron/Vite development server. The Electron main process launches this executable as a child process. The React renderer only accesses it through the typed preload bridge and Electron IPC.

## Validation and packaging

```sh
npm run typecheck
npm run test:core
npm run build
npm run package:mac
```

`npm run package:mac` produces a macOS installer and includes the built native core as an application resource. Build the native core on the target macOS architecture.
