# Media-core host protocol

Electron's main process communicates with the native host using UTF-8, newline-delimited commands over stdin and one-line responses over stdout. Standard error is reserved for diagnostics.

| Request | Response | Meaning |
|---|---|---|
| `STATUS` | `READY` | The host and linked C++ core are running |
| `START_RECORDING<TAB>key=value...` | JSON recording result | Open selected AVFoundation sources and start writing synchronized video/audio tracks to `master.mkv` |
| `RECORDING_STATUS` | JSON recording result | Return the current recording state and track statistics |
| `STOP_RECORDING` | JSON recording result | Stop sources, flush encoders, and finalize the Matroska file |
| `LIST_DEVICES` | JSON device array | List available native video and audio devices |
| EOF | Process exits | Electron is shutting down |

Recording results include track names, capture-device information, timing offsets, frame/sample counts, dropped-frame counts, duration, file size, and errors. Scene composition and MP4 export are handled by Electron after source finalization; they do not run on the renderer thread.
