# Technology stack

| Layer | Technology | Responsibility |
|---|---|---|
| Desktop shell | Electron + TypeScript | Window lifecycle, secure preload bridge, and renderer IPC |
| UI | React + TypeScript + Vite | Home, studio, settings, and media controls |
| Media engine | C++20 + CMake | Platform-independent capture, audio, scene, composition, recording, and streaming logic |
| macOS adapters | Objective-C++ and Apple media frameworks | ScreenCaptureKit, AVFoundation, and CoreAudio integration |
| Encoding/export | FFmpeg (planned) | Recording output and final video export |

## Process boundary

The renderer cannot access Node.js or native APIs directly. It calls the typed preload API, which invokes an Electron IPC handler. The Electron main process owns a C++ media-core child process and sends newline-delimited commands over its standard input, receiving one response line over standard output. Diagnostics use standard error so protocol output remains unambiguous.

The initial core supports a `STATUS` request and responds with `READY`. This is a connectivity check, not a media implementation. Device enumeration, permissions, capture, recording, streaming, and FFmpeg integration remain future work.
