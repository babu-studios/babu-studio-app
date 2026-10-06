# DUI Studio

DUI Studio is a macOS desktop recording and streaming application. The desktop UI is built with React and Electron; a separate C++ media-core process will own native media work and communicate with Electron over standard input/output.

## Requirements

- macOS
- Node.js 20 or newer and npm
- CMake 3.20 or newer
- Xcode Command Line Tools

## Getting started

```sh
npm install
npm run dev
```

The development command builds the C++ core before starting Electron. The starter UI currently checks that the core process is reachable; capture, recording, streaming, and export are not implemented yet.

## Useful commands

```sh
npm run typecheck
npm run test:core
npm run build
npm run package:mac
```

See [docs/development/setup.md](docs/development/setup.md) for the app boundaries and build details.
