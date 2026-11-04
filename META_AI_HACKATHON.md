# Babu AI Studio — Meta AI Hackathon Submission

> Record the game. Let Meta AI cut the clips.

This document tells a code reviewer exactly what the software is, what was
built during the Meta AI hackathon, which Meta models are used, and where every
piece of the hackathon implementation lives in the repository.

## 1. What the software is

**Babu Studio** (hackathon brand: **Babu AI Studio**) is a macOS desktop
recording and export app for gamers and creators. It is built with Electron,
React, and a C++ media core:

- The **React renderer** configures one shared scene and layer list, with
  independent placements in landscape and portrait previews.
- **Electron (main process)** owns project files, IPC, export orchestration,
  and all AI work.
- A separate **C++ media-core process** captures and timestamps media via
  AVFoundation; FFmpeg/VideoToolbox handles encoding.
- A recording writes each source to its own file under
  `~/Movies/Babu Studio/recording-<id>/` (`gameplay.mkv`, `webcam.mkv`,
  `game-audio.m4a`, `microphone.m4a`), plus a `project.babu` project file.

Pre-hackathon, the app could record and export horizontal/vertical videos.
**Everything AI — turning a finished recording into short clips with Meta
models — was built during the hackathon.**

## 2. What was built in the hackathon

One end-to-end feature: the **AI clips wizard**, a 5-step guided popup that
turns one recording into short, shareable clips.

| Step | Name | What it does |
|------|------|--------------|
| 1 | Setup | Pick a recording; paste the Model API key (stored encrypted, see §5) |
| 2 | AI clip | Render a forced-360p vertical file (`ai-360p.mp4`) sized for AI ingestion |
| 3 | Highlights | Meta AI watches the 360p file and suggests 3–5 clips; user edits times, exports one/all as `highlight_00N_<category>.mp4` |
| 4 | Mic WAV | Convert `microphone.m4a` → 16 kHz mono `microphone.wav` with in-app audio preview |
| 5 | Subtitles | Transcribe the mic once, translate into up to 78 languages, save one `subtitles-<code>.srt` per language |

Supporting hackathon work:

- On-demand `ai-preview.mp4` render (540×960) and deterministic 30 s
  `ai-short-clip.mp4` cut from the 360p file.
- Take folder layout `master/` + `export/ai/{subtitles,highlights}/` with
  local-time names, so AI artifacts are organized per take.
- Persisted analysis sidecar `ai-highlights.json` — reopening a take shows
  past suggestions without re-running AI.
- Hackathon marketing site under `website/meta-hackathon/` (AI pipeline,
  results, architecture, 3D room, presentation deck).

## 3. Models used (Meta Model API)

Base URL for all calls: `https://api.meta.ai`. Auth is a Bearer
`MODEL_API_KEY` (`LLM_<id>_<secret>`), which never leaves the main process.

| Model | Used for | Endpoint | File |
|-------|----------|----------|------|
| `muse-voice-transcribe-1.0` | Speech-to-text with word/speaker turns (DIARIZATION mode) | `POST /v1/asr/transcribe` (multipart: `request` JSON + `audio` WAV) | `apps/desktop/electron/src/services/ai-subtitles.provider.ts` |
| `muse-spark-1.3` | Video highlight analysis (timestamps as prompt-driven JSON) | Files API `POST /v1/files`, then `POST /v1/responses` with `input_file` ref | `apps/desktop/electron/src/services/ai-highlights.provider.ts` |
| `muse-spark-1.3` | Subtitle translation (turn texts → target language, ids preserved) | `POST /v1/responses` via `completeModelText()` | `apps/desktop/electron/src/services/ai-subtitles.provider.ts` → `ai-highlights.provider.ts` |

Key facts for reviewers:

- No HTTP libraries: requests are hand-built `node:https` calls (multipart
  bodies, streaming file upload with real byte progress, abort + timeout).
- No official timestamp schema exists for video analysis, so timestamps are
  prompt-driven free text parsed as strict JSON and validated
  (`parseHighlightSuggestions`: clamp to duration, pad to a 30 s minimum,
  drop >60% overlaps, cap at 8 clips).
- Transcription requires RIFF/WAVE mono 16-bit PCM at 16 or 24 kHz; anything
  else is converted with FFmpeg at 24 kHz to a temp file (original preserved).
- Subtitle timestamps **always** come from the transcription response;
  translation only swaps text (`mapTranslatedTurns` throws on count/id
  mismatch). Nothing is invented.

## 4. Implementation map (file by file)

### Main process — AI providers (network layer)

- `apps/desktop/electron/src/services/ai-highlights.provider.ts`
  `HIGHLIGHTS_MODEL_ID = "muse-spark-1.3"`. Files-API upload, Responses-API
  analysis (`metaHighlightsProvider.analyzeVideo`), text completion
  (`completeModelText`), key resolution seam (`setModelApiKeyResolver`,
  substitutable in tests), pure validators (`parseHighlightSuggestions`,
  `highlightFileName`).
- `apps/desktop/electron/src/services/ai-subtitles.provider.ts`
  `TRANSCRIBE_MODEL_ID = "muse-voice-transcribe-1.0"`. `transcribeWav()`
  (multipart upload, real upload progress, 10 min timeout) and
  `translateTurns()` (strict JSON-array prompt, id-preserving parse).
- `apps/desktop/electron/src/services/subtitles-srt.ts`
  Pure, dependency-free helpers: SRT formatting, turn normalization/
  validation, WAV-header compliance check. Covered by
  `apps/desktop/electron/src/services/subtitles-srt.test.ts`
  (`npm run test:subtitles --workspace @babu-studios/electron`).
- `apps/desktop/electron/src/services/ai-credentials.service.ts`
  Encrypted key store (Electron `safeStorage` + `ai-credentials.json` in
  userData, `MODEL_API_KEY` env fallback). Key plaintext never reaches the
  renderer.

### Main process — orchestration (job layer)

- `apps/desktop/electron/src/services/recording.service.ts` — AI methods:
  - `exportAiPreview()` (~line 923): 540×960 `ai-preview.mp4`.
  - `exportAiShotClip()` (~1003): forced-360p `ai-360p.mp4` render.
  - `generateAiShortClip()` (~1089): deterministic 30 s cut.
  - `findHighlights()` (~1333): measure duration → upload → analyze →
    validate → write `ai-highlights.json` sidecar (~1913).
  - `convertMicrophoneWav()` (~1434) + `getMicrophoneWavStatus()` +
    `readMicrophoneWavPreview()` (~1482–1527): mic → WAV pipeline.
  - `startSubtitles()` (~1544) + `resolveTranscribableWav()` (~1693) +
    `listSubtitles()` (~1665): transcribe once → translate per language →
    write `subtitles-<code>.srt`.
  - `exportHighlightClip()` / `exportAllHighlightClips()` (~1726–1818):
    cut suggestions from full-quality sources (never from the 360p file).
  - All jobs: mutual exclusion (one AI job at a time), AbortController
    cancels, honest stage labels + real progress via `getStatus()`.
- `apps/desktop/electron/src/ipc/media-core.ipc.ts` — registers all
  `recording:*` AI IPC handlers.
- `apps/desktop/electron/src/ipc/ai-credentials.ipc.ts` — `ai-key:status/
  set/clear` handlers (status only; plaintext never returned).
- `apps/desktop/electron/src/main.ts` — wires `AiCredentialsService` +
  `setModelApiKeyResolver()`; AI flow-test harness
  (`BABU_STUDIO_FLOW_TEST_AI_*`).
- `apps/desktop/electron/src/preload.ts` — exposes the `window.babuStudio`
  AI bridge (findHighlights, startSubtitles, convertMicWav, export
  highlight(s), AI key status/set/clear, …).
- `shared/types/media.ts` — all AI contracts: `AiHighlightSuggestion`,
  `AiHighlightsStatus`, `AiSubtitleLanguage/Result/Status`,
  `AiArtifactsResult`, `AiKeyStatus`, `MicWav*`, `FindHighlights*`,
  `ExportHighlightClip*`, AI fields on `RecordingResult`.

### Renderer — AI clips wizard (UI layer)

- `apps/desktop/renderer/react/src/features/export/components/AiDialog.tsx`
  The 5-step wizard: stepper bar, per-step checkpoints/locks, 78-language
  picker (sorted), editable highlight rows, independent audio players,
  toast-only errors, real progress bars.
- `apps/desktop/renderer/react/src/features/export/hooks/useAiHighlights.ts`
  Highlight state: find/cancel, key status/save/clear, persisted-artifact
  restore, editable times, single/all export with live FFmpeg percent polling.
- `apps/desktop/renderer/react/src/features/export/hooks/useSubtitles.ts`
  Subtitle state: start/cancel, stage + upload-progress polling, merge of run
  rows over on-disk `.srt` files.
- `apps/desktop/renderer/react/src/features/export/hooks/useMicWav.ts`
  Mic WAV state: convert, existing-file restore, lazy audio preview blob.
- `apps/desktop/renderer/react/src/features/export/hooks/useExportFlow.ts`
  Owns the AI dialog open state plus AI preview/360p/short-clip render state.
- `apps/desktop/renderer/react/src/features/export/components/ExportDialogs.tsx`
  Mounts `AiDialog` alongside the export dialogs.
- `apps/desktop/renderer/react/src/features/export/types/export.types.ts`
  `AiDialogProps` contract.

### Hackathon website

- `website/meta-hackathon/index.html` — “Babu AI Studio” hackathon page: AI
  pipeline, results, architecture, Meta models, install, download, 3D room.
- `website/meta-hackathon/room3d.js`, `site.js`, `styles.css`,
  `BabuStudioMetaAIHackathon.pptx`, `screenshots/`, `subtitles/`.

## 5. End-to-end flows (reviewer walkthroughs)

### A. Highlights: recording → AI suggestions → exported clips

1. User opens AI clips, picks a recording, saves the Model API key
   (`AiDialog` Setup → `setAiKey` → encrypted `ai-credentials.json`).
2. AI clip step: `exportAiShotClip` renders forced-360p vertical
   `export/ai/ai-360p.mp4` (small for upload).
3. Highlights step: `findHighlights` → `measureVideoDuration` →
   `metaHighlightsProvider.analyzeVideo` (Files-API upload with byte
   progress → Responses API with `muse-spark-1.3`) →
   `parseHighlightSuggestions` validates/clamps/pads/dedupes → writes
   `export/ai/highlights/ai-highlights.json`.
4. User edits start/end times inline; `exportHighlightClip` /
   `exportAllHighlights` cut each suggestion from the **full-quality**
   sources into `export/ai/highlights/highlight_00N_<category>.mp4` with
   real FFmpeg percent per clip.
5. Reopening the take calls `getAiArtifacts`, which re-verifies on-disk
   files and restores suggestions without re-running AI.

### B. Subtitles: mic track → multilingual SRTs

1. Mic WAV step: `convertMicrophoneWav` runs FFmpeg
   (`-ac 1 -ar 16000 pcm_s16le`) → `master/microphone.wav`; preview streams
   bytes via `micWavPreview` (renderer never gets a file path).
2. Subtitles step: `startSubtitles` → `resolveTranscribableWav` (direct
   upload if the header is compliant, else temp 24 kHz conversion) →
   `transcribeWav` with `muse-voice-transcribe-1.0` (DIARIZATION turns,
   real upload progress) → per language, `translateTurns` with
   `muse-spark-1.3` → `formatSrt` → `export/ai/subtitles/subtitles-<code>.srt`.
3. Per-language failures are recorded per row; a run succeeds if any language
   succeeds. `listSubtitles` merges every on-disk `.srt` with the latest run.

### C. Security / honesty properties (verify in review)

- API key plaintext exists only in the main process (`resolveKey()`); IPC
  exposes status booleans, never the key.
- Progress is honest: real upload bytes and real FFmpeg percent where
  measurable; `null`/indeterminate with stage labels where the model call is
  opaque — no fabricated percentages.
- One AI job at a time enforced in both main (`assertNoHighlightExport`,
  state guards) and renderer (`anyAiTaskBusy` lock).
- Cancels propagate via AbortController through network, FFmpeg, and loops;
  partial files are removed.

## 6. On-disk layout per take (after AI runs)

```text
~/Movies/Babu Studio/recording-<id>/
├── project.babu                  # scene, placements, capture settings, export state
├── master/
│   ├── gameplay.mkv / webcam.mkv / game-audio.m4a / microphone.m4a
│   └── microphone.wav            # 16 kHz mono, from Mic WAV step
└── export/
    ├── horizontal.mp4 / vertical.mp4
    └── ai/
        ├── ai-360p.mp4           # 360×640 analysis file (Highlights input)
        ├── ai-preview.mp4        # 540×960 on-demand preview
        ├── ai-short-clip.mp4     # deterministic 30 s cut
        ├── highlights/
        │   ├── ai-highlights.json
        │   └── highlight_001_<category>.mp4 …
        └── subtitles/
            └── subtitles-<code>.srt …
```

## 7. Verify it (commands)

```sh
npm install
npm run typecheck                                  # electron + renderer
npm run test:subtitles --workspace @babu-studios/electron   # SRT/turn unit tests
npm run test:core                                  # C++ media-core tests
npm run dev                                        # build core + start Electron
```

In the app: finish a recording → open **AI clips** → paste a Model API key →
walk the 5 steps. Without a key, every AI action fails with an explicit
“not configured” message (never a silent or fake result).
