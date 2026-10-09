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
  kind: "gameplay" | "camera" | "alerts" | "camera-device" | "display-capture" | "game-capture";
  enabled: boolean;
  deviceId: string;
  captureResolution: "720p" | "1080p" | "1440p" | "2160p";
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
  gameVolume: number;
  microphoneVolume: number;
  captureCard?: string;
  camera?: string;
  gameAudio?: string;
  microphone?: string;
  microphoneEnabled?: boolean;
  captureWidth?: number;
  captureHeight?: number;
  scene: RecordingScene;
};

export type RecordingResult = {
  state: RecordingState;
  success: boolean;
  recordingMode: RecordingMode;
  filePath: string;
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
};
