# Technology stack

| Layer | Technology | Responsibility |
|---|---|---|
| Desktop shell | Electron + TypeScript | Window lifecycle, secure preload bridge, and renderer IPC |
| UI | React + TypeScript + Vite | Studio layout, dual previews, audio mixer, recording and export controls |
| Media engine | C++20 + CMake | Platform-independent device access, capture-clock timestamping, and multi-track recording |
| macOS adapters | Objective-C++ and AVFoundation | Camera, capture-card and audio device capture, plus device enumeration |
| Encoding/export | FFmpeg (libavformat/libavcodec) | Source recording to Matroska, and MP4 composition and export |

## Process boundary

The renderer cannot access Node.js or native APIs directly. It calls the typed preload API, which invokes an Electron IPC handler. The Electron main process owns a C++ media-core child process and sends newline-delimited commands over its standard input, receiving one response line over standard output. Diagnostics use standard error so protocol output remains unambiguous.

The media core answers `STATUS` with `READY`, lists capture devices with `LIST_DEVICES`, and records the selected video and audio sources as separate synchronized tracks through `START_RECORDING`, `RECORDING_STATUS` and `STOP_RECORDING`. See [../shared/protocol/protocol.md](../shared/protocol/protocol.md) for the wire format.

Scene composition and MP4 export run in neither the renderer nor the core: once the source file is finalized, the Electron main process renders each selected layout sequentially with FFmpeg.
