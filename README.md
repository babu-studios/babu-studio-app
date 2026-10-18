# Babu Studio

Babu Studio is a macOS desktop recording and streaming application. The React renderer configures one shared scene and layer list with independent placements in landscape and portrait previews; new layers start centered in both layouts at matching output-pixel sizes, then can be adjusted independently. Electron owns project files and IPC, and a separate C++ media-core process captures and timestamps media.

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

The development command builds the C++ core before starting Electron. Recording writes selected capture-card video, webcam video, game audio, and microphone audio as separate synchronized tracks in `master.mkv` under `~/Movies/Babu Studio/recording-<id>/`. A `project.json` stores the shared scene, per-layout layer placements, capture settings, source timing information, and export state. When recording stops, the shared layer list is rendered with its landscape placements to `exports/horizontal.mp4` and its portrait placements to `exports/vertical.mp4`.

In both exports, microphone audio is compressed and boosted, and game audio is ducked while the microphone is active so speech stays in the foreground. The original source tracks remain separate in `master.mkv`.

Scenes, layers and their placements, audio mixer settings, export layouts and quality, and preview visibility are saved to `studio-config.json` in Electron's user-data directory. Existing scene and audio settings stored in the previous browser-based format are imported the first time the file is created.

Native capture and source recording use AVFoundation and FFmpeg's VideoToolbox encoder on macOS. Packaged apps include their own FFmpeg, so users install nothing else. In development, post-processing invokes `ffmpeg` from `PATH`; set `BABU_STUDIO_FFMPEG_PATH` to use a specific executable. If VideoToolbox export fails, the app retries with `libx264`. Source recordings are kept if export fails.

A live System Resources panel below the previews shows CPU, GPU, memory, and disk usage once per second. GPU utilization is read from macOS (`ioreg`) and shows N/A where unavailable; disk shows percent used with used and remaining space.

## Useful commands

```sh
npm run typecheck
npm run test:core
npm run build
npm run package:mac
```

See [docs/development/setup.md](docs/development/setup.md) for the app boundaries and build details.

## Download

Get the latest installer for Apple Silicon or Intel from the [download page](https://babu-studios.github.io/babu-studio-app/) or the [Releases](https://github.com/babu-studios/babu-studio-app/releases) page. The app isn't notarized, so the first launch needs a one-time "Open Anyway" approval; the download page explains it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
