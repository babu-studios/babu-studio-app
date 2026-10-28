import type { NoiseReductionLevel } from "../constants/media.constants";

export type MediaCoreStatus = "ready";

export type RecordingMode = "HORIZONTAL" | "VERTICAL";
export type RecordingState = "IDLE" | "STARTING" | "RECORDING" | "STOPPING" | "COMPLETED" | "ERROR";
export type PostProcessingState = "NOT_STARTED" | "PROCESSING" | "COMPLETED" | "ERROR";

export type RecordingTrackStat = {
  name: string;
  kind: "video" | "audio";
  device: string;
  frames: number;
  actualFps: number;
  startOffsetMs: number;
  codec: string;
  width: number;
  height: number;
  sampleRate: number;
  channels: number;
};

export type NativeCaptureDevice = {
  id: string;
  name: string;
  type: "video" | "audio";
};

export type RecordingLayer = {
  kind: "gameplay" | "camera" | "alerts" | "camera-device" | "game-capture";
  enabled: boolean;
  deviceId: string;
  captureResolution: "360p" | "480p" | "720p" | "1080p" | "1440p" | "2160p";
  crop: { top: number; right: number; bottom: number; left: number };
  sourceDimensions: { width: number; height: number } | null;
  transforms: Record<"landscape" | "portrait", { x: number; y: number; width: number; height: number }>;
};

export type RecordingScene = {
  scene: { id: string; name: string; appearance: string } | null;
  layers: RecordingLayer[];
};

export type RecordingExport = {
  mode: RecordingMode;
  path: string;
  state: "PENDING" | "PROCESSING" | "COMPLETED" | "ERROR";
  progress?: number;
  error?: string;
};

export type StartRecordingRequest = {
  mode: RecordingMode;
  fps: number;
  /** Mixer levels as gain factors: 1 is the captured level, up to 2 boosts it in the export. */
  gameVolume: number;
  microphoneVolume: number;
  /** Noise reduction applied to the microphone track while exporting. */
  noiseReduction?: NoiseReductionLevel;
  captureCard?: string;
  camera?: string;
  gameAudio?: string;
  microphone?: string;
  microphoneEnabled?: boolean;
  captureWidth?: number;
  captureHeight?: number;
  captureExactSize?: boolean;
  exportModes?: RecordingMode[];
  exportResolution?: "360p" | "480p" | "720p" | "1080p" | "1440p" | "2160p";
  scene: RecordingScene;
};

export type RecordingSourceFile = {
  name: string;
  kind: "video" | "audio";
  path: string;
};

export type AiPreviewState = "IDLE" | "PROCESSING" | "COMPLETED" | "ERROR";

export type AiPreviewStatus = {
  state: AiPreviewState;
  progress: number;
  path: string | null;
  error?: string;
};

export type AiPreviewResult = {
  success: boolean;
  path: string | null;
  error: string | null;
};

export type AiArtifactsRequest = {
  id: string;
};

export type AiArtifactHighlight = AiHighlightSuggestion & {
  exportPath: string | null;
};

export type AiArtifactsResult = {
  shotPath: string | null;
  shortClipPath: string | null;
  /** Basenames of playable .mp4 files in the take's exports dir (ai-360p.mp4 first). */
  shotFiles: string[];
  highlights: {
    model: string | null;
    analyzedAt: string | null;
    clips: AiArtifactHighlight[];
  } | null;
};

export type AiKeySource = "secure-storage" | "environment" | "none";

export type AiKeyStatus = {
  configured: boolean;
  source: AiKeySource;
};

export type ExportAiPreviewRequest = {
  id: string;
};

export type AiHighlightState = "IDLE" | "ANALYZING" | "COMPLETED" | "ERROR";

export type AiHighlightSuggestion = {
  startTime: number;
  endTime: number;
  category: string;
  title: string;
  reason: string;
  confidence: number;
  source: "ai";
};

export type AiHighlightsStatus = {
  state: AiHighlightState;
  /** Honest stage label while the model call is opaque (e.g. "Uploading clip…"). Null when idle. */
  stage: string | null;
  /** Null while the model call is opaque (indeterminate); 100 only on success. */
  progress: number | null;
  clips: AiHighlightSuggestion[];
  model: string | null;
  analyzedAt: string | null;
  error?: string;
};

export type FindHighlightsRequest = {
  id: string;
  /** Basename of a generated .mp4 in the take's exports dir; defaults to ai-360p.mp4. */
  sourceFile?: string;
};

export type FindHighlightsResult = {
  success: boolean;
  clips: AiHighlightSuggestion[];
  model: string | null;
  analyzedAt: string | null;
  error: string | null;
};

export type ConvertMicWavRequest = {
  id: string;
};

export type MicWavResult = {
  success: boolean;
  /** Absolute path of the converted microphone.wav, or null. */
  path: string | null;
  error: string | null;
};

export type MicWavPreviewResult = {
  success: boolean;
  data: Uint8Array | null;
  error: string | null;
};

export type MicWavStatusResult = {
  /** Absolute path when microphone.wav already exists in the take, else null. */
  path: string | null;
};

export type ExportHighlightClipRequest = {
  id: string;
  /** Index into the persisted suggestion list. */
  index: number;
  /** Edited bounds; validated and clamped in the main process. */
  startTime?: number;
  endTime?: number;
};

export type ExportAllHighlightsRequest = {
  id: string;
  /** Optional edited clips; validated and clamped in the main process. */
  clips?: AiHighlightSuggestion[];
};

export type HighlightClipExportResult = {
  success: boolean;
  paths: string[];
  error: string | null;
};

export type AiSubtitleLanguage = {
  code: string;
  name: string;
};

export type AiSubtitleResult = {
  code: string;
  name: string;
  srtPath: string | null;
  error?: string;
};

export type AiSubtitlesState = "IDLE" | "WORKING" | "COMPLETED" | "ERROR";

export type AiSubtitlesStatus = {
  state: AiSubtitlesState;
  /** Honest stage label while the job runs (e.g. "Translating Spanish… (2/5)"). Null when idle. */
  stage: string | null;
  /** Real upload percent while the wav uploads; null during analysis and translation. */
  progress: number | null;
  languages: AiSubtitleResult[];
  error?: string;
};

export type StartSubtitlesRequest = {
  id: string;
  languages: AiSubtitleLanguage[];
};

export type ListSubtitlesRequest = {
  id: string;
};

export type StartSubtitlesResult = {
  success: boolean;
  languages: AiSubtitleResult[];
  error: string | null;
};

export type AiDubResult = {
  code: string;
  name: string;
  srtPath: string | null;
  wavPath: string | null;
  voice?: string;
  error?: string;
};

export type AiDubStatus = {
  state: AiSubtitlesState;
  /** Honest stage label while the job runs (e.g. "Voicing Spanish… (2/5)"). Null when idle. */
  stage: string | null;
  /** Real per-cue percent while voices synthesize; null while assembling. */
  progress: number | null;
  languages: AiDubResult[];
  error?: string;
};

export type StartDubRequest = {
  id: string;
  languages: AiSubtitleLanguage[];
};

export type StartDubResult = {
  success: boolean;
  languages: AiDubResult[];
  error: string | null;
};

export type DubPreviewRequest = {
  id: string;
  code: string;
};

export type RecordingResult = {
  state: RecordingState;
  success: boolean;
  recordingMode: RecordingMode;
  /** Legacy single-file path. New recordings write one file per source (see sourceFiles); this carries the first source file. */
  filePath: string;
  /** One entry per recorded source. Absent on takes recorded before per-source files. */
  sourceFiles?: RecordingSourceFile[];
  durationMs: number;
  fileSizeBytes: number;
  droppedVideoFrames: number;
  droppedAudioFrames: number;
  videoTracks: string[];
  audioTracks: string[];
  error: string | null;
  trackStats?: RecordingTrackStat[];
  postProcessingState?: PostProcessingState;
  exportPath?: string | null;
  exportPaths?: Partial<Record<RecordingMode, string>>;
  exports?: RecordingExport[];
  aiPreview?: AiPreviewStatus;
  aiShotExport?: AiPreviewStatus;
  aiShortClip?: AiPreviewStatus;
  aiHighlights?: AiHighlightsStatus;
  aiSubtitles?: AiSubtitlesStatus;
  aiDub?: AiDubStatus;
};

export type RecordingSummary = {
  id: string;
  createdAt: string;
  durationMs: number;
  fileSizeBytes: number;
  exported: boolean;
};

export type ExportRecordingRequest = {
  id: string;
  exportModes: RecordingMode[];
  exportResolution: "360p" | "480p" | "720p" | "1080p" | "1440p" | "2160p";
};
