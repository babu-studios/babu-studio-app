# Babu Studio

Babu Studio is a macOS desktop recording and export application. The React renderer configures one shared scene and layer list with independent placements in landscape and portrait previews; new layers start centered in both layouts at matching output-pixel sizes, then can be adjusted independently. Electron owns project files and IPC, and a separate C++ media-core process captures and timestamps media.

## Requirements

- macOS
- Node.js 20 or newer and npm
- CMake 3.20 or newer
- Xcode Command Line Tools
- FFmpeg and `pkg-config`, for the native core's libav* libraries

## Getting started

```sh
npm install
npm run dev
```

The development command builds the C++ core before starting Electron. Recording writes each selected source to its own file under `~/Movies/Babu Studio/recording-<id>/`: capture-card video to `gameplay.mkv`, webcam video to `webcam.mkv`, game audio to `game-audio.m4a`, and microphone audio to `microphone.m4a`. The files stay synchronized on the capture clock. A `project.babu` stores the shared scene, per-layout layer placements, capture settings, source timing information, and export state. Takes recorded before per-source files keep a single `master.babu` and still open and export. When recording stops, the shared layer list is rendered with its landscape placements to `exports/horizontal.mp4` and its portrait placements to `exports/vertical.mp4`. The export picker can also render a small on-demand `exports/ai-preview.mp4` (540x960 vertical, same scene and mix) of any saved take for AI clip suggestions.

In both exports, microphone audio is compressed and boosted so speech stays in the foreground, and game audio holds a constant level underneath it; the combined mix is limited to prevent clipping. The original per-source files are preserved unchanged.

Mixer levels run from 0% to 200%. 100% matches the level the source was captured at, and anything above it boosts that track in the export, so a quiet capture card or microphone can be raised without re-recording. The live capture-card monitor follows the same level, and the recorded master file always keeps the untouched source tracks.

The microphone track has a **Noise reduction** setting (Off, Low, Medium, High) in its settings popup. It runs a high-pass filter to drop rumble and an FFT denoiser to remove hiss, leaving the voice band largely untouched. Like the mixer levels it is applied while exporting, so the master file keeps the raw microphone track.

Scenes, layers and their placements, audio mixer settings, export layouts and quality, and preview visibility are saved to `studio-config.json` in Electron's user-data directory. Existing scene and audio settings stored in the previous browser-based format are imported the first time the file is created.

Native capture and source recording use AVFoundation and FFmpeg's VideoToolbox encoder on macOS. Packaged apps include their own FFmpeg, so users install nothing else. In development, post-processing invokes `ffmpeg` from `PATH`; set `BABU_STUDIO_FFMPEG_PATH` to use a specific executable. If VideoToolbox export fails, the app retries with `libx264`. Source recordings are kept if export fails.

A live System Resources panel in the top bar shows CPU, GPU, memory, and disk usage once per second. Hovering it opens a popup with per-application CPU and memory usage and advice on which heavy background apps can be closed. GPU utilization is read from macOS (`ioreg`) and shows N/A where unavailable; disk shows percent used with used and remaining space.

The AI popup's Audio step generates multilingual subtitles from the take's microphone track: a compliant `microphone.wav` (mono 16-bit PCM at 16 or 24 kHz) uploads directly, anything else is converted to a temporary 24 kHz file while the original is preserved. The track is transcribed once with `muse-voice-transcribe-1.0` (timestamps come only from the API response, never invented), each selected language is translated with `muse-spark-1.3`, and one `subtitles-<code>.srt` is saved next to the recording. Progress shows real upload bytes, generation cancels cleanly, failures surface as toasts, and the Model API key never leaves the main process.

Spoken dubbing (voicing each language's subtitles as audio) waits on Meta releasing a text-to-speech model: the Model API currently returns text only and does not synthesize speech, so the Audio step ships subtitles only.

## Useful commands

```sh
npm run typecheck
npm run test:core
npm run build
npm run package:mac
npm run test:subtitles --workspace @babu-studios/electron
```

See [docs/development/setup.md](docs/development/setup.md) for the app boundaries and build details.

## Download

Get the latest installer for Apple Silicon or Intel from the [download page](https://babu-studios.github.io/babu-studio-app/) or the [Releases](https://github.com/babu-studios/babu-studio-app/releases) page. The app isn't notarized, so the first launch needs a one-time "Open Anyway" approval; the download page explains it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
