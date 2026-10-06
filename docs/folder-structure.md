# Project structure

```text
apps/
  desktop/
    electron/
      src/
        ipc/              # Renderer-to-main IPC handlers
        services/         # Main-process services, including the C++ process client
    renderer/
      react/
        src/
          components/     # Common UI and studio panels
          pages/          # Home, Studio, and Settings screens
          hooks/
          stores/
          services/       # Typed renderer-side IPC clients
          types/
          utils/
core/
  include/creator/        # Public C++ interfaces
  src/
    core/                 # Platform-independent media core
    host/                 # stdio process entry point
    capture/
    audio/
    scene/
    compositor/
    recorder/
    streaming/
    postprocess/
    project/
  tests/
platform/
  macos/                  # ScreenCaptureKit, AVFoundation, and CoreAudio adapters
shared/
  protocol/               # Electron-to-core wire protocol
  types/                  # Shared TypeScript contracts
tests/
  integration/
scripts/
docs/
```

Electron owns the desktop window and renderer IPC. Its main process starts the C++ media-core host and exchanges newline-delimited commands with it. The host links the reusable C++ core library; macOS capture implementations will be added behind platform-specific interfaces.
