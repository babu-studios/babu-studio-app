# Development setup

## Prerequisites

- macOS
- Node.js 20 or newer with npm
- CMake 3.20 or newer
- Xcode Command Line Tools, including Apple Clang
- FFmpeg and `pkg-config`, for the native core's libav* libraries

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

`npm run release:mac [patch|minor|major|x.y.z]` bumps the version, deletes `release/` and the previous build outputs, and then runs `npm run package:mac`.

`npm run package:mac` builds the native core, bundles it with FFmpeg (`scripts/bundle-media-tools.mjs`), and produces an ad-hoc signed macOS installer. The bundle (`core/build/bundle`) contains `creator-media-core`, `ffmpeg`, `ffprobe`, and every non-system dylib they need with relative load paths, so end users do not install FFmpeg or Homebrew. The packaged app points `BABU_STUDIO_FFMPEG_PATH` and `BABU_STUDIO_FFPROBE_PATH` at the bundled tools.

The bundle uses the build machine's architecture and its FFmpeg (found on `PATH`, or set `BABU_STUDIO_FFMPEG_SOURCE`). Build on an Apple Silicon Mac for arm64 and on an Intel Mac for x64. The FFmpeg must include `h264_videotoolbox`, and Homebrew's build is GPL (libx264), so check its license against your distribution plans or use an LGPL build.

The app is not notarized. On first launch users must right-click the app and choose **Open**, or use **System Settings → Privacy & Security → Open Anyway**.
