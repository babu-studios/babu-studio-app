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
          components/
            common/       # Shared Dropdown and IconButton components
          App.tsx
          main.tsx
          styles.css
core/
  include/creator/core/   # Shared media-core interfaces
  src/
    core/                 # Shared media-core recording logic
    host/                 # stdio process entry point
  tests/                  # Media-core tests
platform/
  macos/
    CMakeLists.txt        # macOS adapter sources and framework links
    capture/
      avfoundation_capture.mm
shared/
  constants/
  protocol/               # Electron-to-core wire protocol
  types/                  # Shared TypeScript contracts
scripts/
docs/
```

Electron owns the desktop window and renderer IPC. Its main process starts the C++ media-core host and exchanges newline-delimited commands with it. The host links the reusable C++ core library; AVFoundation capture adapters live under `platform/macos/`. Electron stores recording project metadata and runs sequential FFmpeg exports after source files are finalized.

Keep operating-system APIs and framework dependencies in `platform/<os>/`; `core/` owns shared interfaces and recording logic. Windows support is not implemented yet. When work begins, add the Windows adapter and build configuration alongside the existing macOS implementation rather than keeping empty Windows folders in the repository.
