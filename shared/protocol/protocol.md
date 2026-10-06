# Media-core host protocol

Electron's main process communicates with the native host using UTF-8, newline-delimited commands over stdin and one-line responses over stdout. Standard error is reserved for diagnostics.

| Request | Response | Meaning |
|---|---|---|
| `STATUS` | `READY` | The host and linked C++ core are running |
| EOF | Process exits | Electron is shutting down |

The protocol is intentionally small during bootstrap. Commands for capture, audio, scenes, recording, and streaming will be added with typed request/response contracts before those features are implemented.
