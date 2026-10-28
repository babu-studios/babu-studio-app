import { app, systemPreferences } from "electron";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdir, open, readdir, readFile, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
import os from "node:os";
import { basename, dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { powerGuard } from "./power-guard.service";
import type { Readable } from "node:stream";
import type {
  NativeCaptureDevice,
  AiArtifactsRequest,
  AiArtifactsResult,
  AiHighlightSuggestion,
  AiHighlightExportStatus,
  AiHighlightsStatus,
  AiPreviewResult,
  AiPreviewStatus,
  AiSubtitleLanguage,
  AiSubtitleResult,
  AiSubtitlesStatus,
  ConvertMicWavRequest,
  ExportAiPreviewRequest,
  ExportAllHighlightsRequest,
  ExportHighlightClipRequest,
  FindHighlightsRequest,
  FindHighlightsResult,
  ExportRecordingRequest,
  HighlightClipExportResult,
  MicWavPreviewResult,
  MicWavResult,
  MicWavStatusResult,
  PostProcessingState,
  RecordingExport,
  RecordingLayer,
  RecordingMode,
  RecordingResult,
  RecordingScene,
  RecordingSourceFile,
  RecordingSummary,
  ListSubtitlesRequest,
  StartRecordingRequest,
  StartSubtitlesRequest,
  StartSubtitlesResult,
} from "@shared/types/media";
import {
  HIGHLIGHTS_MODEL_ID,
  highlightFileName,
  metaHighlightsProvider,
  parseHighlightSuggestions,
  type HighlightsProvider,
} from "./ai-highlights.provider";
import { transcribeWav, translateTurns, type TranslatedLanguage } from "./ai-subtitles.provider";
import { formatSrt, isCompliantWavHeader } from "./subtitles-srt.js";
import {
  DEFAULT_EXPORT_RESOLUTION,
  DEFAULT_NOISE_REDUCTION,
  EXPORT_RESOLUTIONS,
  isNoiseReductionLevel,
  MAX_AUDIO_GAIN,
} from "@shared/constants/media.constants";
import type { NoiseReductionLevel } from "@shared/constants/media.constants";
import type { MediaCoreService } from "./media-core.service";

const RECORDING_ID_PATTERN = /^recording-[0-9A-Za-z-]+$/;

type FfmpegProcess = ChildProcessByStdio<null, null, Readable>;

const CAPTURE_SIZES = {
  "360p": { width: 640, height: 360 },
  "480p": { width: 854, height: 480 },
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "1440p": { width: 2560, height: 1440 },
  "2160p": { width: 3840, height: 2160 },
} as const;

// Noise reduction for the microphone track. The high-pass filter drops rumble and the
// FFT denoiser removes hiss while leaving the voice band largely untouched.
const NOISE_REDUCTION_FILTERS: Record<NoiseReductionLevel, string> = {
  OFF: "",
  LOW: "highpass=f=80,afftdn=nr=6:nf=-45",
  MEDIUM: "highpass=f=100,afftdn=nr=12:nf=-35",
  HIGH: "highpass=f=120,afftdn=nr=18:nf=-30",
};

type ProjectMetadata = Record<string, unknown> & {
  status: string;
  postProcessingStatus: PostProcessingState;
};

type RecordingStartOptions = {
  outputDirectory?: string;
  synthetic?: boolean;
};

function failure(request: StartRecordingRequest, error: string): RecordingResult {
  return {
    state: "ERROR",
    success: false,
    recordingMode: request.mode,
    filePath: "",
    durationMs: 0,
    fileSizeBytes: 0,
    droppedVideoFrames: 0,
    droppedAudioFrames: 0,
    videoTracks: [],
    audioTracks: [],
    error,
    postProcessingState: "NOT_STARTED",
    exportPath: null,
  };
}

function evenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeCaptureDeviceName(name: string): string {
  return name
    .replace(/^default\s*-\s*/i, "")
    .replace(/\s+\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, "")
    .replace(/\s+\(built-in\)$/i, "")
    .trim()
    .toLocaleLowerCase();
}

function nativeDeviceId(
  selectedName: string,
  type: NativeCaptureDevice["type"],
  devices: NativeCaptureDevice[],
): string {
  const typedDevices = [...new Map(
    devices.filter((device) => device.type === type).map((device) => [device.id, device]),
  ).values()];
  const hardwareId = /\(([0-9a-f]{4}):([0-9a-f]{4})\)\s*$/i.exec(selectedName.trim());
  const compactHardwareId = hardwareId ? `${hardwareId[1]}${hardwareId[2]}`.toLocaleLowerCase() : undefined;
  const hardwareMatches = compactHardwareId
    ? typedDevices.filter((device) => device.id.toLocaleLowerCase().replace(/[^0-9a-f]/g, "").includes(compactHardwareId))
    : [];
  if (hardwareMatches.length === 1) {
    return hardwareMatches[0].id;
  }

  const normalizedName = normalizeCaptureDeviceName(selectedName);
  const nameMatches = typedDevices.filter((device) => normalizeCaptureDeviceName(device.name) === normalizedName);
  if (nameMatches.length === 1) {
    return nameMatches[0].id;
  }

  if (hardwareMatches.length > 1 || nameMatches.length > 1) {
    throw new Error(`More than one native ${type} device matches "${selectedName}". Choose a uniquely identified input.`);
  }

  const available = typedDevices.map((device) => device.name).join(", ") || "none";
  throw new Error(`Selected ${type} device "${selectedName}" is not available to the native recorder. Available ${type} devices: ${available}.`);
}

function getSourceDimensions(layer: RecordingLayer): { width: number; height: number } {
  if (layer.sourceDimensions) {
    return layer.sourceDimensions;
  }
  switch (layer.captureResolution) {
    case "360p": return CAPTURE_SIZES["360p"];
    case "480p": return CAPTURE_SIZES["480p"];
    case "720p": return CAPTURE_SIZES["720p"];
    case "1080p": return CAPTURE_SIZES["1080p"];
    case "1440p": return CAPTURE_SIZES["1440p"];
    case "2160p": return CAPTURE_SIZES["2160p"];
  }
}

function runFfmpeg(
  args: string[],
  onSpawn: (child: FfmpegProcess) => void,
  onClose: (child: FfmpegProcess) => void,
  onOutputTime: (microseconds: number) => void,
): Promise<void> {
  const ffmpegPath = process.env.BABU_STUDIO_FFMPEG_PATH || "ffmpeg";
  return new Promise((resolve, reject) => {
    const releasePowerGuard = powerGuard.acquire();
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    onSpawn(child);
    let stderr = "";
    let progressRemainder = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-12_000);
      const lines = `${progressRemainder}${chunk}`.split(/\r?\n/);
      progressRemainder = lines.pop() ?? "";
      for (const line of lines) {
        const separator = line.indexOf("=");
        if (separator < 0 || line.slice(0, separator) !== "out_time_us") {
          continue;
        }
        const microseconds = Number(line.slice(separator + 1));
        if (Number.isFinite(microseconds) && microseconds >= 0) {
          onOutputTime(microseconds);
        }
      }
    });
    child.once("error", (error) => {
      releasePowerGuard();
      reject(error);
    });
    child.once("close", (code, signal) => {
      releasePowerGuard();
      onClose(child);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}: ${stderr.trim() || "No diagnostic output."}`));
      }
    });
  });
}

// Custom extensions so the OS has no app to open these internal files.
const MASTER_FILE = "master.babu";
const PROJECT_FILE = "project.babu";

// Small vertical render for AI clip suggestions: same scene composition and
// audio mix as the vertical export, at a fraction of the size.
const AI_PREVIEW_FILE = "ai-preview.mp4";
const AI_PREVIEW_WIDTH = 540;
const AI_PREVIEW_HEIGHT = 960;
const AI_PREVIEW_FPS = 30;

// Two-step AI shot clip: a forced-360p vertical file for AI ingestion, then a
// short clip cut from it. Both live in the take's exports directory.
const AI_SHOT_360P_FILE = "ai-360p.mp4";
const AI_SHOT_WIDTH = 360;
const AI_SHOT_HEIGHT = 640;
const AI_SHOT_FPS = 30;
const AI_SHORT_CLIP_FILE = "ai-short-clip.mp4";
const AI_SHORT_CLIP_SECONDS = 30;

// AI highlight suggestions: sidecar analysis file in the take's exports
// directory. master.babu / project.babu formats are never touched for this.
const AI_HIGHLIGHTS_FILE = "ai-highlights.json";

// Deterministic short-clip window: up to AI_SHORT_CLIP_SECONDS taken from the
// middle of the take so short takes still produce a whole-take clip.
function aiShortClipWindow(durationMs: number): { startSeconds: number; lengthSeconds: number } {
  const totalSeconds = Math.max(0.1, durationMs / 1000);
  const lengthSeconds = Math.min(AI_SHORT_CLIP_SECONDS, totalSeconds);
  const startSeconds = Math.max(0, (totalSeconds - lengthSeconds) / 2);
  return { startSeconds, lengthSeconds };
}

type ProjectSourceFile = {
  name: string;
  kind: "video" | "audio";
  file: string;
};

function isProjectSourceFile(value: unknown): value is ProjectSourceFile {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return typeof entry.name === "string"
    && (entry.kind === "video" || entry.kind === "audio")
    && typeof entry.file === "string"
    && entry.file.length > 0
    && !entry.file.includes("/")
    && !entry.file.includes("\\");
}

// Recorded source files for a take with absolute paths, or null for takes
// recorded before per-source files (a single master.babu).
function projectSources(project: ProjectMetadata, directory: string): RecordingSourceFile[] | null {
  const sources = project.sources as { files?: unknown } | undefined;
  if (!sources || !Array.isArray(sources.files)) {
    return null;
  }
  return sources.files
    .filter(isProjectSourceFile)
    .map((entry) => ({ name: entry.name, kind: entry.kind, path: join(directory, entry.file) }));
}

function resultSourceFiles(result: RecordingResult): RecordingSourceFile[] | null {
  return Array.isArray(result.sourceFiles) && result.sourceFiles.length > 0 ? result.sourceFiles : null;
}

function sanitizeSubtitleLanguages(languages: unknown): AiSubtitleLanguage[] {
  if (!Array.isArray(languages) || languages.length === 0 || languages.length > 78) {
    throw new Error("Select between 1 and 78 languages for subtitles.");
  }
  return languages.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("Each subtitle language must name a code and a language.");
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.code !== "string" || !/^[a-z]{2,3}(-[a-z]{2})?$/i.test(record.code)
      || typeof record.name !== "string" || record.name.trim().length === 0 || record.name.length > 48) {
      throw new Error("Each subtitle language must name a valid code and language.");
    }
    return { code: record.code.toLowerCase(), name: record.name.trim() };
  });
}

async function isCompliantWav(wavPath: string): Promise<boolean> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(wavPath, "r");
    const buffer = Buffer.alloc(44);
    const { bytesRead } = await handle.read(buffer, 0, 44, 0);
    await handle.close();
    return bytesRead === 44 && isCompliantWavHeader(buffer);
  } catch {
    try {
      await handle?.close();
    } catch {
      // Ignore close failures after a failed read.
    }
    return false;
  }
}

async function assertSourcesExist(sources: RecordingSourceFile[] | null, directory: string): Promise<void> {
  if (sources) {
    if (sources.length === 0) {
      throw new Error("The selected recording lists no source files.");
    }
    for (const source of sources) {
      await stat(source.path);
    }
    return;
  }
  await stat(join(directory, MASTER_FILE));
}

export class RecordingService {
  private projectFile?: string;
  private projectDirectory?: string;
  private projectMetadata?: ProjectMetadata;
  private activeState = false;
  private releaseRecordingPowerGuard?: () => void;
  private startPromise?: Promise<RecordingResult>;
  private stopPromise?: Promise<RecordingResult>;
  private retryPromise?: Promise<RecordingResult>;
  private postProcessingPromise?: Promise<void>;
  private postProcessingState: PostProcessingState = "NOT_STARTED";
  private exportPath: string | null = null;
  private exportPaths: Partial<Record<RecordingMode, string>> = {};
  private exportStates: RecordingExport[] = [];
  private activeExportPath?: string;
  private postProcessingError?: string;
  private finalizedResult?: RecordingResult;
  private stopResult?: RecordingResult;
  private postProcessingProcess?: FfmpegProcess;
  private postProcessingCancelled = false;
  private aiPreviewState: AiPreviewStatus = { state: "IDLE", progress: 0, path: null };
  private aiPreviewProcess?: FfmpegProcess;
  private aiPreviewCancelled = false;
  private aiShotExportState: AiPreviewStatus = { state: "IDLE", progress: 0, path: null };
  private aiShotExportProcess?: FfmpegProcess;
  private aiShotExportCancelled = false;
  private aiShortClipState: AiPreviewStatus = { state: "IDLE", progress: 0, path: null };
  private aiShortClipProcess?: FfmpegProcess;
  private aiShortClipCancelled = false;
  private highlightExportInFlight = false;
  private highlightExportState: AiHighlightExportStatus = {
    state: "IDLE",
    progress: null,
    current: 0,
    total: 0,
  };
  private aiHighlightsState: AiHighlightsStatus = {
    state: "IDLE",
    stage: null,
    progress: null,
    clips: [],
    model: null,
    analyzedAt: null,
  };
  private aiHighlightsAbort?: AbortController;
  private aiHighlightsRecordingId?: string;
  private highlightsProvider: HighlightsProvider = metaHighlightsProvider;
  private aiSubtitlesState: AiSubtitlesStatus = {
    state: "IDLE",
    stage: null,
    progress: null,
    languages: [],
  };
  private aiSubtitlesAbort?: AbortController;
  private aiSubtitlesRecordingId?: string;

  private isScopeCancelled(scope: "export" | "ai-preview" | "ai-shot" | "ai-short-clip"): boolean {
    switch (scope) {
      case "ai-preview": return this.aiPreviewCancelled;
      case "ai-shot": return this.aiShotExportCancelled;
      case "ai-short-clip": return this.aiShortClipCancelled;
      default: return this.postProcessingCancelled;
    }
  }
  private selectedExportModes: RecordingMode[] = ["HORIZONTAL", "VERTICAL"];

  constructor(private readonly mediaCore: MediaCoreService) {}

  private get active(): boolean {
    return this.activeState;
  }

  // Keep the system awake for the whole recording; sleeping pauses capture and truncates the file.
  private set active(value: boolean) {
    this.activeState = value;
    if (value && !this.releaseRecordingPowerGuard) {
      this.releaseRecordingPowerGuard = powerGuard.acquire();
    } else if (!value) {
      this.releaseRecordingPowerGuard?.();
      this.releaseRecordingPowerGuard = undefined;
    }
  }

  async start(request: StartRecordingRequest): Promise<RecordingResult> {
    return this.startWithOptions(request, {});
  }

  async runSyntheticFlowTest(
    durationMs: number,
    outputDirectory: string,
    exportModes: RecordingMode[],
    onProgress: (elapsedMs: number) => void,
  ): Promise<RecordingResult> {
    if (!Number.isInteger(durationMs) || durationMs < 1_000 || durationMs > 3_600_000) {
      throw new Error("Synthetic flow-test duration must be between 1,000 and 3,600,000 milliseconds.");
    }
    const recordingScene: RecordingScene = {
      scene: { id: "synthetic-flow-test", name: "Flow Test", appearance: "gameplay" },
      layers: [
        {
          kind: "game-capture",
          enabled: true,
          deviceId: "synthetic-game",
          captureResolution: "1080p",
          crop: { top: 0, right: 0, bottom: 0, left: 0 },
          sourceDimensions: { width: 1920, height: 1080 },
          transforms: {
            landscape: { x: 0, y: 0, width: 100, height: 100 },
            portrait: { x: 0, y: 0, width: 100, height: 100 },
          },
        },
        {
          kind: "camera-device",
          enabled: true,
          deviceId: "synthetic-camera",
          captureResolution: "720p",
          crop: { top: 0, right: 0, bottom: 0, left: 0 },
          sourceDimensions: { width: 1280, height: 720 },
          transforms: {
            landscape: { x: 72, y: 72, width: 24, height: 24 },
            portrait: { x: 38, y: 72, width: 24, height: 16 },
          },
        },
      ],
    };
    const request: StartRecordingRequest = {
      mode: "HORIZONTAL",
      fps: 60,
      gameVolume: 1,
      microphoneVolume: 1,
      // Exercise the microphone noise-reduction filters in the end-to-end flow test.
      noiseReduction: "HIGH",
      captureCard: "synthetic-game",
      camera: "synthetic-camera",
      gameAudio: "synthetic-game-audio",
      microphone: "synthetic-microphone",
      microphoneEnabled: true,
      exportModes,
      scene: recordingScene,
    };
    const started = await this.startWithOptions(request, { outputDirectory, synthetic: true });
    if (!started.success) {
      throw new Error(started.error || "Synthetic recording could not start.");
    }

    const startedAt = performance.now();
    while (performance.now() - startedAt < durationMs) {
      const elapsedMs = performance.now() - startedAt;
      onProgress(Math.min(durationMs, elapsedMs));
      await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, durationMs - elapsedMs)));
    }
    onProgress(durationMs);

    const stopped = await this.stop();
    if (!stopped.success) {
      throw new Error(stopped.error || "Synthetic recording could not be finalized.");
    }
    await this.startExport(stopped);
    if (this.postProcessingPromise) {
      await this.postProcessingPromise;
    }
    const result = this.withPostProcessing(stopped);
    if (result.postProcessingState !== "COMPLETED"
      || result.exports?.some((entry) => entry.state !== "COMPLETED")) {
      throw new Error(result.error || "One or more synthetic layout exports failed.");
    }
    return result;
  }

  private async startWithOptions(
    request: StartRecordingRequest,
    options: RecordingStartOptions,
  ): Promise<RecordingResult> {
    const availableModes: RecordingMode[] = ["HORIZONTAL", "VERTICAL"];
    const requestedModes = request.exportModes ?? availableModes;
    if (!Array.isArray(requestedModes)
      || requestedModes.length === 0
      || requestedModes.some((mode) => !availableModes.includes(mode))) {
      return failure(request, "Select at least one valid export layout.");
    }
    const exportModes = availableModes.filter((mode) => requestedModes.includes(mode));
    const exportResolution = request.exportResolution ?? DEFAULT_EXPORT_RESOLUTION;
    if (!(exportResolution in EXPORT_RESOLUTIONS)) {
      return failure(request, "Select a valid export resolution.");
    }
    const sessionRequest = { ...request, exportModes, exportResolution };
    if (this.active || this.startPromise) {
      return failure(sessionRequest, "A recording is already in progress.");
    }
    if (this.postProcessingState === "PROCESSING") {
      return failure(sessionRequest, "Wait for the selected layout exports to finish before starting another recording.");
    }
    this.stopResult = undefined;
    this.active = true;
    const startPromise = this.beginRecording(sessionRequest, options);
    this.startPromise = startPromise;
    try {
      return await startPromise;
    } finally {
      if (this.startPromise === startPromise) {
        this.startPromise = undefined;
      }
    }
  }

  private async beginRecording(
    request: StartRecordingRequest,
    options: RecordingStartOptions,
  ): Promise<RecordingResult> {
    let coreStarted = false;
    try {
      if (!options.synthetic && process.platform === "darwin") {
        const needsCamera = Boolean(request.captureCard || request.camera);
        const needsMic = Boolean(request.gameAudio || request.microphoneEnabled !== false);
        if (needsCamera && !(await systemPreferences.askForMediaAccess("camera"))) {
          this.active = false;
          return failure(request, "Camera access was denied. Allow it in System Settings > Privacy & Security.");
        }
        if (needsMic && !(await systemPreferences.askForMediaAccess("microphone"))) {
          this.active = false;
          return failure(request, "Microphone access was denied. Allow it in System Settings > Privacy & Security.");
        }
      }

      const recordingId = new Date().toISOString().replace(/[:.]/g, "-");
      const directory = options.outputDirectory
        ?? join(app.getPath("videos"), "Babu Studio", `recording-${recordingId}`);
      await mkdir(join(directory, "exports"), { recursive: true });
      this.projectDirectory = directory;
      this.projectFile = join(directory, PROJECT_FILE);
      this.postProcessingState = "NOT_STARTED";
      this.selectedExportModes = request.exportModes ?? ["HORIZONTAL", "VERTICAL"];
      this.exportPath = null;
      this.exportPaths = {};
      this.exportStates = [];
      this.activeExportPath = undefined;
      this.postProcessingError = undefined;
      this.finalizedResult = undefined;
      const exportResolution = request.exportResolution ?? DEFAULT_EXPORT_RESOLUTION;
      const projectMetadata: ProjectMetadata = {
        recordingId,
        createdAt: new Date().toISOString(),
        status: "STARTING",
        recordingMode: request.mode,
        exportModes: request.exportModes,
        canvas: {
          horizontal: EXPORT_RESOLUTIONS[exportResolution].horizontal,
          vertical: EXPORT_RESOLUTIONS[exportResolution].vertical,
          exportResolution,
          fps: request.fps,
        },
        sources: {
          files: [],
          videoTracks: [],
          audioTracks: [],
          timestamps: {
            clock: "CoreMedia host clock, relative to recorder start",
            sourceOffsetsMs: {},
          },
        },
        scene: request.scene,
        audio: {
          gameVolume: request.gameVolume,
          microphoneVolume: request.microphoneVolume,
          microphoneEnabled: request.microphoneEnabled !== false,
          noiseReduction: isNoiseReductionLevel(request.noiseReduction)
            ? request.noiseReduction
            : DEFAULT_NOISE_REDUCTION,
          sampleRate: 48000,
          channels: 2,
        },
        capture: {
          fps: request.fps,
          captureCard: request.captureCard ?? null,
          camera: request.camera ?? null,
          gameAudio: request.gameAudio ?? null,
          microphone: request.microphone ?? null,
          captureWidth: request.captureWidth ?? null,
          captureHeight: request.captureHeight ?? null,
          videoEncoder: "H.264 VideoToolbox when available",
        },
        postProcessingStatus: "NOT_STARTED",
        exportFiles: {},
        exports: [],
      };
      this.projectMetadata = projectMetadata;
      await this.writeProject();

      let nativeRequest = request;
      if (!options.synthetic && process.platform === "darwin") {
        const nativeDevices = await this.mediaCore.listDevices();
        nativeRequest = {
          ...request,
          captureCard: request.captureCard
            ? nativeDeviceId(request.captureCard, "video", nativeDevices)
            : undefined,
          camera: request.camera ? nativeDeviceId(request.camera, "video", nativeDevices) : undefined,
          gameAudio: request.gameAudio ? nativeDeviceId(request.gameAudio, "audio", nativeDevices) : undefined,
          microphone: request.microphone ? nativeDeviceId(request.microphone, "audio", nativeDevices) : undefined,
        };
      }
      const result = await this.mediaCore.startRecording(directory, nativeRequest, options.synthetic);
      if (!result.success) {
        this.active = false;
        projectMetadata.status = "ERROR";
        projectMetadata.error = result.error;
        await this.writeProject();
      } else {
        coreStarted = true;
        projectMetadata.status = "RECORDING";
        projectMetadata.startedAt = new Date().toISOString();
        await this.writeProject();
      }
      return this.withPostProcessing(result);
    } catch (error) {
      if (coreStarted) {
        try {
          await this.mediaCore.stopRecording();
          this.active = false;
        } catch (stopError) {
          this.active = true;
          console.error("Unable to stop media core after recording setup failed:", stopError);
        }
      } else {
        this.active = false;
      }
      if (this.projectMetadata) {
        this.projectMetadata.status = "ERROR";
        this.projectMetadata.error = error instanceof Error ? error.message : String(error);
        await this.writeProject();
      }
      throw error;
    }
  }

  async stop(): Promise<RecordingResult> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    const stopPromise = this.stopAfterStart();
    this.stopPromise = stopPromise;
    try {
      return await stopPromise;
    } finally {
      if (this.stopPromise === stopPromise) {
        this.stopPromise = undefined;
      }
    }
  }

  private async stopAfterStart(): Promise<RecordingResult> {
    const pendingStart = this.startPromise;
    if (pendingStart) {
      const started = await pendingStart;
      if (!started.success) {
        return this.withPostProcessing(started);
      }
    }
    if (!this.active) {
      const result = await this.mediaCore.getRecordingStatus();
      return {
        ...result,
        state: "ERROR",
        success: false,
        error: "No recording is in progress.",
        postProcessingState: this.postProcessingState,
        exportPath: this.exportPath,
        exportPaths: { ...this.exportPaths },
        exports: this.exportStates.map((entry) => ({ ...entry })),
      };
    }
    const result = await this.mediaCore.stopRecording();
    this.active = false;
    this.finalizedResult = result;
    this.stopResult = result;
    if (!this.projectMetadata || !this.projectFile || !this.projectDirectory) {
      return this.withPostProcessing(result);
    }
    this.projectMetadata.durationMs = result.durationMs;
    this.projectMetadata.stoppedAt = new Date().toISOString();
    this.projectMetadata.status = result.success ? "SOURCE_FINALIZED" : "ERROR";
    this.projectMetadata.sources = {
      files: (result.sourceFiles ?? []).map((file) => ({
        name: file.name,
        kind: file.kind,
        file: basename(file.path),
      })),
      videoTracks: result.videoTracks,
      audioTracks: result.audioTracks,
      timestamps: {
        clock: "CoreMedia host clock, relative to recorder start",
        sourceOffsetsMs: Object.fromEntries((result.trackStats ?? []).map((track) => [track.name, track.startOffsetMs])),
      },
    };
    this.projectMetadata.trackStats = result.trackStats ?? [];
    const videoEncoder = result.trackStats?.find((track) => track.kind === "video")?.codec;
    const audioEncoder = result.trackStats?.find((track) => track.kind === "audio")?.codec;
    const capture = this.projectMetadata.capture as Record<string, unknown>;
    capture.videoEncoder = videoEncoder ?? "unknown";
    capture.audioEncoder = audioEncoder ?? "unknown";
    this.projectMetadata.recordingResult = result;

    if (!result.success) {
      this.projectMetadata.error = result.error;
      await this.writeProject();
      return this.withPostProcessing({ ...result, postProcessingState: "NOT_STARTED", exportPath: null });
    }

    this.postProcessingState = "NOT_STARTED";
    this.postProcessingError = undefined;
    this.exportPaths = {};
    this.exportStates = [];
    this.exportPath = null;
    this.projectMetadata.postProcessingStatus = this.postProcessingState;
    try {
      await this.writeProject();
    } catch (error) {
      return this.withPostProcessing({
        ...result,
        success: false,
        state: "ERROR",
        error: `Unable to save project metadata: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    return this.withPostProcessing(result);
  }

  async listRecordings(): Promise<RecordingSummary[]> {
    const root = this.recordingsRoot();
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const summaries: RecordingSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !RECORDING_ID_PATTERN.test(entry.name)) {
        continue;
      }
      const directory = join(root, entry.name);
      try {
        const project = JSON.parse(await readFile(join(directory, PROJECT_FILE), "utf8")) as ProjectMetadata;
        const source = project.recordingResult as RecordingResult | undefined;
        if (!source?.success) {
          continue;
        }
        await assertSourcesExist(projectSources(project, directory), directory);
        summaries.push({
          id: entry.name,
          createdAt: typeof project.createdAt === "string" ? project.createdAt : "",
          durationMs: source.durationMs,
          fileSizeBytes: source.fileSizeBytes,
          exported: project.postProcessingStatus === "COMPLETED",
        });
      } catch {
        continue;
      }
    }
    return summaries.sort((first, second) => second.id.localeCompare(first.id));
  }

  async exportRecording(request: ExportRecordingRequest): Promise<RecordingResult> {
    if (this.active || this.startPromise) {
      throw new Error("Stop the current recording before exporting.");
    }
    if (this.postProcessingState === "PROCESSING" || this.retryPromise) {
      throw new Error("Another export is already in progress.");
    }
    this.assertNoHighlightExport("exporting.");
    const availableModes: RecordingMode[] = ["HORIZONTAL", "VERTICAL"];
    if (typeof request?.id !== "string" || !RECORDING_ID_PATTERN.test(request.id)) {
      throw new Error("Select a valid recording to export.");
    }
    if (!Array.isArray(request.exportModes)
      || request.exportModes.length === 0
      || request.exportModes.some((mode) => !availableModes.includes(mode))) {
      throw new Error("Select at least one valid export layout.");
    }
    if (!(request.exportResolution in EXPORT_RESOLUTIONS)) {
      throw new Error("Select a valid export resolution.");
    }
    const directory = join(this.recordingsRoot(), request.id);
    let project: ProjectMetadata;
    try {
      project = JSON.parse(await readFile(join(directory, PROJECT_FILE), "utf8")) as ProjectMetadata;
      await assertSourcesExist(projectSources(project, directory), directory);
    } catch {
      throw new Error("The selected recording's source files could not be found.");
    }
    const source = project.recordingResult as RecordingResult | undefined;
    if (!source?.success) {
      throw new Error("The selected recording has no finalized source to export.");
    }

    const exportModes = availableModes.filter((mode) => request.exportModes.includes(mode));
    const canvas = (project.canvas && typeof project.canvas === "object" ? project.canvas : {}) as Record<string, unknown>;
    project.canvas = {
      ...canvas,
      horizontal: EXPORT_RESOLUTIONS[request.exportResolution].horizontal,
      vertical: EXPORT_RESOLUTIONS[request.exportResolution].vertical,
      exportResolution: request.exportResolution,
    };
    project.exportModes = exportModes;
    this.projectDirectory = directory;
    this.projectFile = join(directory, PROJECT_FILE);
    this.projectMetadata = project;
    this.finalizedResult = source;
    this.stopResult = undefined;
    this.selectedExportModes = exportModes;
    return this.startExport(source);
  }

  // Render a small vertical preview of a saved take for AI clip suggestions.
  // It mirrors the vertical scene at low quality and never touches the
  // regular layout export state.
  async exportAiPreview(request: ExportAiPreviewRequest): Promise<AiPreviewResult> {
    if (this.active || this.startPromise) {
      throw new Error("Stop the current recording before rendering the AI preview.");
    }
    if (this.postProcessingState === "PROCESSING" || this.retryPromise) {
      throw new Error("Wait for the selected layout exports to finish before rendering the AI preview.");
    }
    if (this.aiPreviewState.state === "PROCESSING") {
      throw new Error("The AI preview is already rendering.");
    }
    if (this.aiShotExportState.state === "PROCESSING" || this.aiShortClipState.state === "PROCESSING") {
      throw new Error("Wait for the AI shot-clip task to finish before rendering the AI preview.");
    }
    this.assertNoHighlightExport("rendering the AI preview.");
    if (typeof request?.id !== "string" || !RECORDING_ID_PATTERN.test(request.id)) {
      throw new Error("Select a valid recording for the AI preview.");
    }
    const directory = join(this.recordingsRoot(), request.id);
    let project: ProjectMetadata;
    try {
      project = JSON.parse(await readFile(join(directory, PROJECT_FILE), "utf8")) as ProjectMetadata;
      await assertSourcesExist(projectSources(project, directory), directory);
    } catch {
      throw new Error("The selected recording's source files could not be found.");
    }
    const source = project.recordingResult as RecordingResult | undefined;
    if (!source?.success) {
      throw new Error("The selected recording has no finalized source to preview.");
    }
    const scene = project.scene as RecordingScene | undefined;
    if (!scene) {
      throw new Error("The shared scene configuration was not saved with this recording.");
    }
    this.projectDirectory = directory;
    this.projectFile = join(directory, PROJECT_FILE);
    this.projectMetadata = project;
    this.finalizedResult = source;
    const previewPath = join(directory, "exports", AI_PREVIEW_FILE);
    this.aiPreviewCancelled = false;
    this.aiPreviewState = { state: "PROCESSING", progress: 0, path: previewPath };
    try {
      await mkdir(join(directory, "exports"), { recursive: true });
      await this.renderLayout(
        source,
        "VERTICAL",
        scene,
        previewPath,
        project,
        (progress) => {
          this.aiPreviewState = { ...this.aiPreviewState, progress };
        },
        { previewQuality: true },
      );
      if (this.aiPreviewCancelled) {
        throw new Error("AI preview cancelled");
      }
      this.aiPreviewState = { state: "COMPLETED", progress: 100, path: previewPath };
      return { success: true, path: previewPath, error: null };
    } catch (error) {
      await rm(previewPath, { force: true }).catch((cleanupError: unknown) => {
        console.error("Unable to remove incomplete AI preview:", cleanupError);
      });
      const message = error instanceof Error ? error.message : String(error);
      this.aiPreviewState = { state: "ERROR", progress: 0, path: null, error: message };
      return { success: false, path: null, error: message };
    }
  }

  cancelAiPreview(): void {
    if (this.aiPreviewState.state === "PROCESSING") {
      this.aiPreviewCancelled = true;
      if (this.aiPreviewProcess && !this.aiPreviewProcess.killed) {
        this.aiPreviewProcess.kill("SIGTERM");
      }
    }
  }

  // Step 1 of the AI shot clip: a forced-360p vertical render of a saved take,
  // regardless of the export-quality dropdown. Never touches the regular
  // layout export state.
  async exportAiShotClip(request: ExportAiPreviewRequest): Promise<AiPreviewResult> {
    if (this.active || this.startPromise) {
      throw new Error("Stop the current recording before exporting the AI 360p file.");
    }
    if (this.postProcessingState === "PROCESSING" || this.retryPromise) {
      throw new Error("Wait for the selected layout exports to finish before exporting the AI 360p file.");
    }
    if (this.aiPreviewState.state === "PROCESSING") {
      throw new Error("Wait for the AI preview to finish before exporting the AI 360p file.");
    }
    if (this.aiShotExportState.state === "PROCESSING") {
      throw new Error("The AI 360p export is already running.");
    }
    if (this.aiShortClipState.state === "PROCESSING") {
      throw new Error("Wait for the AI short clip to finish before exporting the AI 360p file.");
    }
    this.assertNoHighlightExport("exporting the AI 360p file.");
    if (typeof request?.id !== "string" || !RECORDING_ID_PATTERN.test(request.id)) {
      throw new Error("Select a valid recording for the AI 360p export.");
    }
    const directory = join(this.recordingsRoot(), request.id);
    let project: ProjectMetadata;
    try {
      project = JSON.parse(await readFile(join(directory, PROJECT_FILE), "utf8")) as ProjectMetadata;
      await assertSourcesExist(projectSources(project, directory), directory);
    } catch {
      throw new Error("The selected recording's source files could not be found.");
    }
    const source = project.recordingResult as RecordingResult | undefined;
    if (!source?.success) {
      throw new Error("The selected recording has no finalized source to export.");
    }
    const scene = project.scene as RecordingScene | undefined;
    if (!scene) {
      throw new Error("The shared scene configuration was not saved with this recording.");
    }
    this.projectDirectory = directory;
    this.projectFile = join(directory, PROJECT_FILE);
    this.projectMetadata = project;
    this.finalizedResult = source;
    const shotPath = join(directory, "exports", AI_SHOT_360P_FILE);
    this.aiShotExportCancelled = false;
    this.aiShotExportState = { state: "PROCESSING", progress: 0, path: shotPath };
    try {
      await mkdir(join(directory, "exports"), { recursive: true });
      await this.renderLayout(
        source,
        "VERTICAL",
        scene,
        shotPath,
        project,
        (progress) => {
          this.aiShotExportState = { ...this.aiShotExportState, progress };
        },
        {
          previewQuality: true,
          forcedCanvas: { width: AI_SHOT_WIDTH, height: AI_SHOT_HEIGHT },
          scope: "ai-shot",
        },
      );
      if (this.aiShotExportCancelled) {
        throw new Error("AI 360p export cancelled");
      }
      this.aiShotExportState = { state: "COMPLETED", progress: 100, path: shotPath };
      return { success: true, path: shotPath, error: null };
    } catch (error) {
      await rm(shotPath, { force: true }).catch((cleanupError: unknown) => {
        console.error("Unable to remove incomplete AI 360p export:", cleanupError);
      });
      const message = this.aiShotExportCancelled ? "AI 360p export cancelled" : error instanceof Error ? error.message : String(error);
      this.aiShotExportState = { state: "ERROR", progress: 0, path: null, error: message };
      return { success: false, path: null, error: message };
    }
  }

  cancelAiShotClipExport(): void {
    if (this.aiShotExportState.state === "PROCESSING") {
      this.aiShotExportCancelled = true;
      if (this.aiShotExportProcess && !this.aiShotExportProcess.killed) {
        this.aiShotExportProcess.kill("SIGTERM");
      }
    }
  }

  // Step 2 of the AI shot clip: cut a short clip from the take's AI 360p file.
  // Requires step 1 so there is always a 360p source to cut from.
  async generateAiShortClip(request: ExportAiPreviewRequest): Promise<AiPreviewResult> {
    if (this.active || this.startPromise) {
      throw new Error("Stop the current recording before generating the AI short clip.");
    }
    if (this.postProcessingState === "PROCESSING" || this.retryPromise) {
      throw new Error("Wait for the selected layout exports to finish before generating the AI short clip.");
    }
    if (this.aiPreviewState.state === "PROCESSING") {
      throw new Error("Wait for the AI preview to finish before generating the AI short clip.");
    }
    if (this.aiShotExportState.state === "PROCESSING") {
      throw new Error("Wait for the AI 360p export to finish before generating the AI short clip.");
    }
    if (this.aiShortClipState.state === "PROCESSING") {
      throw new Error("The AI short clip is already generating.");
    }
    this.assertNoHighlightExport("generating the AI short clip.");
    if (typeof request?.id !== "string" || !RECORDING_ID_PATTERN.test(request.id)) {
      throw new Error("Select a valid recording for the AI short clip.");
    }
    const directory = join(this.recordingsRoot(), request.id);
    let project: ProjectMetadata;
    try {
      project = JSON.parse(await readFile(join(directory, PROJECT_FILE), "utf8")) as ProjectMetadata;
      await assertSourcesExist(projectSources(project, directory), directory);
    } catch {
      throw new Error("The selected recording's source files could not be found.");
    }
    const source = project.recordingResult as RecordingResult | undefined;
    if (!source?.success) {
      throw new Error("The selected recording has no finalized source for the AI short clip.");
    }
    const shotPath = join(directory, "exports", AI_SHOT_360P_FILE);
    try {
      await stat(shotPath);
    } catch {
      throw new Error("Export the AI 360p file first, then generate the short clip.");
    }
    const clipPath = join(directory, "exports", AI_SHORT_CLIP_FILE);
    const { startSeconds, lengthSeconds } = aiShortClipWindow(source.durationMs);
    this.aiShortClipCancelled = false;
    this.aiShortClipState = { state: "PROCESSING", progress: 0, path: clipPath };
    const onProgress = (progress: number): void => {
      this.aiShortClipState = { ...this.aiShortClipState, progress };
    };
    const buildArgs = (videoCodec: string, extraCodecArgs: string[]): string[] => [
      "-hide_banner",
      "-loglevel", "error",
      "-progress", "pipe:2",
      "-nostats",
      "-y",
      "-ss", startSeconds.toFixed(3),
      "-t", lengthSeconds.toFixed(3),
      "-i", shotPath,
      "-r", String(AI_SHOT_FPS),
      "-c:v", videoCodec,
      ...extraCodecArgs,
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      clipPath,
    ];
    try {
      try {
        await this.runFfmpegTracked(
          buildArgs("h264_videotoolbox", ["-allow_sw", "1", "-b:v", "1.5M", "-profile:v", "high"]),
          lengthSeconds,
          onProgress,
          "ai-short-clip",
        );
      } catch {
        await rm(clipPath, { force: true });
        if (this.aiShortClipCancelled) {
          throw new Error("AI short clip cancelled");
        }
        onProgress(0);
        await this.runFfmpegTracked(
          buildArgs("libx264", ["-preset", "veryfast", "-crf", "28"]),
          lengthSeconds,
          onProgress,
          "ai-short-clip",
        );
      }
      if (this.aiShortClipCancelled) {
        throw new Error("AI short clip cancelled");
      }
      this.aiShortClipState = { state: "COMPLETED", progress: 100, path: clipPath };
      return { success: true, path: clipPath, error: null };
    } catch (error) {
      await rm(clipPath, { force: true }).catch((cleanupError: unknown) => {
        console.error("Unable to remove incomplete AI short clip:", cleanupError);
      });
      const message = this.aiShortClipCancelled ? "AI short clip cancelled" : error instanceof Error ? error.message : String(error);
      this.aiShortClipState = { state: "ERROR", progress: 0, path: null, error: message };
      return { success: false, path: null, error: message };
    }
  }

  cancelAiShortClip(): void {
    if (this.aiShortClipState.state === "PROCESSING") {
      this.aiShortClipCancelled = true;
      if (this.aiShortClipProcess && !this.aiShortClipProcess.killed) {
        this.aiShortClipProcess.kill("SIGTERM");
      }
    }
  }

  private async listShotFiles(directory: string): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(join(directory, "exports"));
    } catch {
      return [];
    }
    const clips = entries.filter((name) => name.toLowerCase().endsWith(".mp4")).sort();
    clips.sort((a, b) => {
      if (a === AI_SHOT_360P_FILE) {
        return -1;
      }
      if (b === AI_SHOT_360P_FILE) {
        return 1;
      }
      return a.localeCompare(b);
    });
    return clips;
  }

  // Resolve which generated file feeds AI analysis/export. Only basenames
  // inside the take's own exports dir are accepted — never absolute paths.
  private async resolveAiSourceFile(directory: string, requested?: unknown): Promise<{ file: string; path: string }> {
    const available = await this.listShotFiles(directory);
    if (available.length === 0) {
      throw new Error("Generate the AI 360p file first, then find highlights.");
    }
    const name = typeof requested === "string" ? requested : "";
    const file = name.length > 0 ? name : AI_SHOT_360P_FILE;
    if (!/^[A-Za-z0-9][A-Za-z0-9 _\-.]*\.mp4$/i.test(file) || !available.includes(file)) {
      throw new Error("Select a generated clip from this recording's exports folder.");
    }
    const full = join(directory, "exports", file);
    try {
      await stat(full);
    } catch {
      throw new Error("The selected clip file could not be found. Generate it again.");
    }
    return { file, path: full };
  }

  // File management for AI artifacts: report what already exists on disk so
  // the UI restores Done state instead of forcing a re-export. Never throws
  // for a missing take — absent files simply read as null.
  async getAiArtifacts(request: AiArtifactsRequest): Promise<AiArtifactsResult> {
    if (typeof request?.id !== "string" || !RECORDING_ID_PATTERN.test(request.id)) {
      throw new Error("Select a valid recording.");
    }
    const directory = join(this.recordingsRoot(), request.id);
    const existingFile = async (file: string): Promise<string | null> => {
      const full = join(directory, "exports", file);
      try {
        await stat(full);
        return full;
      } catch {
        return null;
      }
    };
    const shotPath = await existingFile(AI_SHOT_360P_FILE);
    const shortClipPath = await existingFile(AI_SHORT_CLIP_FILE);
    const shotFiles = await this.listShotFiles(directory);
    let highlights: AiArtifactsResult["highlights"] = null;
    try {
      const sidecar = JSON.parse(
        await readFile(join(directory, "exports", AI_HIGHLIGHTS_FILE), "utf8"),
      ) as {
        model?: unknown;
        analyzedAt?: unknown;
        durationSeconds?: unknown;
        clips?: unknown;
        exports?: unknown;
      };
      const durationSeconds = Number(sidecar.durationSeconds);
      const clips = parseHighlightSuggestions(
        Array.isArray(sidecar.clips) ? sidecar.clips : [],
        durationSeconds,
        typeof sidecar.model === "string" ? sidecar.model : HIGHLIGHTS_MODEL_ID,
      );
      if (clips.length > 0) {
        const exportStates = Array.isArray(sidecar.exports) ? sidecar.exports : [];
        const withPaths = await Promise.all(clips.map(async (clip, index) => {
          const saved = (exportStates[index] as { path?: unknown } | undefined)?.path;
          let exportPath: string | null = null;
          if (typeof saved === "string" && saved.length > 0) {
            // Sidecar stores an absolute path; also accept the bare filename
            // in case the library moved between machines.
            const leaf = saved.split("/").pop() ?? saved;
            exportPath = (await existingFile(leaf.includes(".mp4") ? leaf : saved)) ?? null;
            if (!exportPath) {
              try {
                await stat(saved);
                exportPath = saved;
              } catch {
                exportPath = null;
              }
            }
          }
          if (!exportPath) {
            exportPath = await existingFile(highlightFileName(index, clip.category));
          }
          return { ...clip, exportPath };
        }));
        highlights = {
          model: typeof sidecar.model === "string" ? sidecar.model : null,
          analyzedAt: typeof sidecar.analyzedAt === "string" ? sidecar.analyzedAt : null,
          clips: withPaths,
        };
      }
    } catch {
      highlights = null;
    }
    return { shotPath, shortClipPath, shotFiles, highlights };
  }

  /** Test seam: substitute the network provider without touching callers. */
  setHighlightsProvider(provider: HighlightsProvider): void {
    this.highlightsProvider = provider;
  }

  // Find highlight moments in the take's ai-360p.mp4 via the Meta
  // video-analysis provider. Progress stays honest: stage labels while the
  // model call is opaque (indeterminate, progress null); 100 only on success.
  async findHighlights(request: FindHighlightsRequest): Promise<FindHighlightsResult> {
    if (this.active || this.startPromise) {
      throw new Error("Stop the current recording before finding highlights.");
    }
    if (this.postProcessingState === "PROCESSING" || this.retryPromise) {
      throw new Error("Wait for the selected layout exports to finish before finding highlights.");
    }
    if (this.aiShotExportState.state === "PROCESSING"
      || this.aiShortClipState.state === "PROCESSING"
      || this.aiPreviewState.state === "PROCESSING") {
      throw new Error("Wait for the running AI task to finish before finding highlights.");
    }
    this.assertNoHighlightExport("finding highlights.");
    if (this.aiHighlightsState.state === "ANALYZING") {
      throw new Error("Highlight analysis is already running.");
    }
    if (typeof request?.id !== "string" || !RECORDING_ID_PATTERN.test(request.id)) {
      throw new Error("Select a valid recording to find highlights.");
    }
    const directory = join(this.recordingsRoot(), request.id);
    let project: ProjectMetadata;
    try {
      project = JSON.parse(await readFile(join(directory, PROJECT_FILE), "utf8")) as ProjectMetadata;
      await assertSourcesExist(projectSources(project, directory), directory);
    } catch {
      throw new Error("The selected recording's source files could not be found.");
    }
    const source = project.recordingResult as RecordingResult | undefined;
    if (!source?.success) {
      throw new Error("The selected recording has no finalized source for highlight analysis.");
    }
    const aiSource = await this.resolveAiSourceFile(directory, request.sourceFile);
    const shotPath = aiSource.path;
    this.projectDirectory = directory;
    this.projectFile = join(directory, PROJECT_FILE);
    this.projectMetadata = project;
    this.finalizedResult = source;
    this.aiHighlightsRecordingId = request.id;
    const abort = new AbortController();
    this.aiHighlightsAbort = abort;
    this.aiHighlightsState = {
      state: "ANALYZING",
      stage: "Measuring clip…",
      progress: null,
      clips: [],
      model: HIGHLIGHTS_MODEL_ID,
      analyzedAt: null,
    };
    try {
      const durationSeconds = await this.measureVideoDuration(shotPath, source.durationMs);
      if (abort.signal.aborted) {
        throw new Error("Highlight analysis cancelled");
      }
      this.aiHighlightsState = { ...this.aiHighlightsState, stage: "Uploading clip for analysis…", progress: 0 };
      const raw = await this.highlightsProvider.analyzeVideo(shotPath, durationSeconds, abort.signal, (fraction) => {
        if (this.aiHighlightsAbort === abort && this.aiHighlightsState.state === "ANALYZING") {
          this.aiHighlightsState = { ...this.aiHighlightsState, progress: Math.round(fraction * 100) };
        }
      });
      if (abort.signal.aborted) {
        throw new Error("Highlight analysis cancelled");
      }
      this.aiHighlightsState = { ...this.aiHighlightsState, stage: "Reading suggestions…", progress: null };
      const clips = parseHighlightSuggestions(raw, durationSeconds, HIGHLIGHTS_MODEL_ID);
      if (clips.length === 0) {
        throw new Error("The model returned no usable highlight moments. Try again.");
      }
      const analyzedAt = new Date().toISOString();
      this.aiHighlightsState = {
        state: "COMPLETED",
        stage: null,
        progress: 100,
        clips,
        model: HIGHLIGHTS_MODEL_ID,
        analyzedAt,
      };
      await this.writeHighlightsSidecar(directory, durationSeconds, clips, analyzedAt, aiSource.file);
      return { success: true, clips, model: HIGHLIGHTS_MODEL_ID, analyzedAt, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = abort.signal.aborted || message === "Highlight analysis cancelled";
      this.aiHighlightsState = {
        state: cancelled ? "IDLE" : "ERROR",
        stage: null,
        progress: null,
        clips: [],
        model: HIGHLIGHTS_MODEL_ID,
        analyzedAt: null,
        ...(cancelled ? {} : { error: message }),
      };
      if (cancelled) {
        throw new Error("Highlight analysis cancelled");
      }
      return { success: false, clips: [], model: HIGHLIGHTS_MODEL_ID, analyzedAt: null, error: message };
    } finally {
      if (this.aiHighlightsAbort === abort) {
        this.aiHighlightsAbort = undefined;
      }
    }
  }

  async convertMicrophoneWav(request: ConvertMicWavRequest): Promise<MicWavResult> {
    if (this.active || this.startPromise) {
      throw new Error("Stop the current recording before converting microphone audio.");
    }
    if (this.postProcessingState === "PROCESSING" || this.retryPromise) {
      throw new Error("Wait for the selected layout exports to finish before converting microphone audio.");
    }
    if (typeof request?.id !== "string" || !RECORDING_ID_PATTERN.test(request.id)) {
      throw new Error("Select a valid recording to convert microphone audio.");
    }
    const directory = join(this.recordingsRoot(), request.id);
    let project: ProjectMetadata;
    try {
      project = JSON.parse(await readFile(join(directory, PROJECT_FILE), "utf8")) as ProjectMetadata;
    } catch {
      throw new Error("The selected recording's project file could not be read.");
    }
    const sources = projectSources(project, directory);
    const mic = sources?.find((source) => source.kind === "audio" && basename(source.path) === "microphone.m4a") ?? null;
    if (!mic) {
      throw new Error("The selected recording has no microphone track to convert.");
    }
    try {
      await stat(mic.path);
    } catch {
      throw new Error("The microphone file could not be found.");
    }
    // 16 kHz mono PCM: the standard shape for speech/AI audio pipelines.
    const wavPath = join(directory, "microphone.wav");
    try {
      await runFfmpeg(
        ["-y", "-i", mic.path, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath],
        () => {},
        () => {},
        () => {},
      );
    } catch (error) {
      await rm(wavPath, { force: true }).catch((cleanupError: unknown) => {
        console.error("Unable to remove incomplete microphone.wav:", cleanupError);
      });
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, path: null, error: message };
    }
    return { success: true, path: wavPath, error: null };
  }

  // Reports whether microphone.wav already exists in the take. Read-only.
  async getMicrophoneWavStatus(request: ConvertMicWavRequest): Promise<MicWavStatusResult> {
    if (typeof request?.id !== "string" || !RECORDING_ID_PATTERN.test(request.id)) {
      return { path: null };
    }
    try {
      const wavPath = join(this.recordingsRoot(), request.id, "microphone.wav");
      await stat(wavPath);
      return { path: wavPath };
    } catch {
      return { path: null };
    }
  }

  // Reads the take's microphone.wav for in-app preview. The path is fixed
  // to the take directory; the renderer never supplies a file path.
  async readMicrophoneWavPreview(request: ConvertMicWavRequest): Promise<MicWavPreviewResult> {
    if (this.active || this.startPromise) {
      throw new Error("Stop the current recording before previewing microphone audio.");
    }
    if (typeof request?.id !== "string" || !RECORDING_ID_PATTERN.test(request.id)) {
      throw new Error("Select a valid recording to preview microphone audio.");
    }
    const wavPath = join(this.recordingsRoot(), request.id, "microphone.wav");
    let info;
    try {
      info = await stat(wavPath);
    } catch {
      throw new Error("Convert the microphone file before previewing it.");
    }
    if (info.size > 200_000_000) {
      throw new Error("The microphone file is too large to preview.");
    }
    try {
      const data = await readFile(wavPath);
      return { success: true, data: new Uint8Array(data), error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, data: null, error: message };
    }
  }

  cancelFindHighlights(): void {
    if (this.aiHighlightsState.state === "ANALYZING") {
      this.aiHighlightsAbort?.abort();
    }
  }

  private assertNoHighlightExport(action: string): void {
    if (this.highlightExportInFlight) {
      throw new Error(`Wait for the highlight export to finish before ${action}.`);
    }
  }

  // Transcribe the take's microphone audio once, translate the turns into
  // each requested language, and write one .srt per language. Timings always
  // come from the transcription response, never invented.
  async startSubtitles(request: StartSubtitlesRequest): Promise<StartSubtitlesResult> {
    if (this.active || this.startPromise) {
      throw new Error("Stop the current recording before generating subtitles.");
    }
    if (this.postProcessingState === "PROCESSING" || this.retryPromise) {
      throw new Error("Wait for the selected layout exports to finish before generating subtitles.");
    }
    if (this.aiHighlightsState.state === "ANALYZING") {
      throw new Error("Wait for highlight analysis to finish before generating subtitles.");
    }
    if (this.aiSubtitlesState.state === "WORKING") {
      throw new Error("Subtitle generation is already running.");
    }
    if (typeof request?.id !== "string" || !RECORDING_ID_PATTERN.test(request.id)) {
      throw new Error("Select a valid recording to generate subtitles.");
    }
    const languages = sanitizeSubtitleLanguages(request.languages);
    const directory = join(this.recordingsRoot(), request.id);
    try {
      await stat(join(directory, PROJECT_FILE));
    } catch {
      throw new Error("The selected recording could not be found.");
    }
    const abort = new AbortController();
    this.aiSubtitlesAbort = abort;
    this.aiSubtitlesRecordingId = request.id;
    this.aiSubtitlesState = {
      state: "WORKING",
      stage: "Preparing microphone audio…",
      progress: null,
      languages: languages.map((language) => ({ ...language, srtPath: null })),
    };
    let tempWav: string | null = null;
    const results: AiSubtitleResult[] = [];
    try {
      const resolved = await this.resolveTranscribableWav(directory, request.id);
      tempWav = resolved.temp;
      if (abort.signal.aborted) {
        throw new Error("Subtitles cancelled");
      }
      this.aiSubtitlesState = { ...this.aiSubtitlesState, stage: "Uploading audio for transcription…", progress: 0 };
      const transcript = await transcribeWav(resolved.path, abort.signal, (fraction) => {
        if (this.aiSubtitlesAbort === abort && this.aiSubtitlesState.state === "WORKING") {
          this.aiSubtitlesState = { ...this.aiSubtitlesState, progress: Math.round(fraction * 100) };
        }
      });
      if (abort.signal.aborted) {
        throw new Error("Subtitles cancelled");
      }
      for (let index = 0; index < languages.length; index += 1) {
        const language = languages[index];
        if (abort.signal.aborted) {
          throw new Error("Subtitles cancelled");
        }
        this.aiSubtitlesState = {
          ...this.aiSubtitlesState,
          stage: `Translating ${language.name}… (${index + 1}/${languages.length})`,
          progress: null,
          languages: [...results, ...languages.slice(index).map((rest) => ({ ...rest, srtPath: null }))],
        };
        try {
          const translated = await translateTurns(transcript.turns, language, abort.signal);
          const srtPath = join(directory, `subtitles-${language.code}.srt`);
          await writeFile(srtPath, formatSrt(translated), "utf8");
          results.push({ ...language, srtPath });
        } catch (error) {
          if (abort.signal.aborted) {
            throw new Error("Subtitles cancelled");
          }
          const message = error instanceof Error ? error.message : String(error);
          results.push({ ...language, srtPath: null, error: message });
        }
      }
      const failed = results.filter((result) => result.error);
      if (failed.length === results.length) {
        const message = failed[0]?.error ?? "Subtitle generation failed.";
        this.aiSubtitlesState = { state: "ERROR", stage: null, progress: null, languages: results, error: message };
        return { success: false, languages: results, error: message };
      }
      this.aiSubtitlesState = { state: "COMPLETED", stage: null, progress: 100, languages: results };
      return {
        success: true,
        languages: results,
        error: failed.length > 0 ? `${failed.length} of ${results.length} languages failed; the rest are saved.` : null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = abort.signal.aborted || message === "Subtitles cancelled";
      this.aiSubtitlesState = {
        state: cancelled ? "IDLE" : "ERROR",
        stage: null,
        progress: null,
        languages: results,
        ...(cancelled ? {} : { error: message }),
      };
      if (cancelled) {
        throw new Error("Subtitles cancelled");
      }
      return { success: false, languages: results, error: message };
    } finally {
      if (tempWav) {
        await rm(tempWav, { force: true }).catch((cleanupError: unknown) => {
          console.error("Unable to remove temporary subtitle audio:", cleanupError);
        });
      }
      if (this.aiSubtitlesAbort === abort) {
        this.aiSubtitlesAbort = undefined;
      }
    }
  }

  cancelSubtitles(): void {
    if (this.aiSubtitlesState.state === "WORKING") {
      this.aiSubtitlesAbort?.abort();
    }
  }

  // Every subtitles-*.srt already saved in the take, regardless of which
  // run produced it. Names resolve renderer-side from the language list.
  async listSubtitles(request: ListSubtitlesRequest): Promise<AiSubtitleResult[]> {
    if (typeof request?.id !== "string" || !RECORDING_ID_PATTERN.test(request.id)) {
      return [];
    }
    const directory = join(this.recordingsRoot(), request.id);
    let entries;
    try {
      entries = await readdir(directory);
    } catch {
      return [];
    }
    const results: AiSubtitleResult[] = [];
    for (const entry of entries) {
      const match = /^subtitles-([a-z]{2,3}(?:-[a-z]{2})?)\.srt$/i.exec(entry);
      if (match) {
        const code = match[1].toLowerCase();
        results.push({ code, name: code, srtPath: join(directory, entry) });
      }
    }
    return results.sort((a, b) => a.code.localeCompare(b.code));
  }

  // Compliant microphone.wav uploads directly; anything else is converted to
  // a temporary 24 kHz mono file while the original is preserved.
  private async resolveTranscribableWav(directory: string, id: string): Promise<{ path: string; temp: string | null }> {
    const wavPath = join(directory, "microphone.wav");
    if (await isCompliantWav(wavPath)) {
      return { path: wavPath, temp: null };
    }
    const m4aPath = join(directory, "microphone.m4a");
    try {
      await stat(m4aPath);
    } catch {
      throw new Error("The selected recording has no microphone audio. Convert it in the Mic WAV step first.");
    }
    const tempPath = join(os.tmpdir(), `babu-mic-${id}-${Date.now()}.wav`);
    try {
      await runFfmpeg(
        ["-y", "-i", m4aPath, "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", "-map_metadata", "-1", tempPath],
        () => {},
        () => {},
        () => {},
      );
    } catch {
      throw new Error("The microphone audio could not be converted for transcription.");
    }
    return { path: tempPath, temp: tempPath };
  }

  // Cut one persisted suggestion from the ORIGINAL recording sources with the
  // full scene composition. Never modifies the take's original recording.
  async exportHighlightClip(request: ExportHighlightClipRequest): Promise<HighlightClipExportResult> {
    if (this.active || this.startPromise) {
      throw new Error("Stop the current recording before exporting highlights.");
    }
    if (this.postProcessingState === "PROCESSING" || this.retryPromise) {
      throw new Error("Wait for the selected layout exports to finish before exporting highlights.");
    }
    if (this.aiHighlightsState.state === "ANALYZING") {
      throw new Error("Wait for highlight analysis to finish before exporting.");
    }
    if (this.highlightExportInFlight) {
      throw new Error("A highlight export is already running.");
    }
    const clips = await this.loadHighlightClips(request?.id);
    const index = request?.index;
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= clips.clips.length) {
      throw new Error("Select a valid highlight suggestion to export.");
    }
    const clip = this.clampClipToDuration(
      {
        ...clips.clips[index as number],
        ...(typeof request?.startTime === "number" ? { startTime: request.startTime } : {}),
        ...(typeof request?.endTime === "number" ? { endTime: request.endTime } : {}),
      },
      clips.durationSeconds,
    );
    this.highlightExportInFlight = true;
    this.highlightExportState = { state: "WORKING", progress: 0, current: 1, total: 1 };
    try {
      const path = await this.cutHighlightClip(clips, clip, index as number, (progress) => {
        if (this.highlightExportInFlight) {
          this.highlightExportState = { state: "WORKING", progress, current: 1, total: 1 };
        }
      });
      await this.markHighlightExported(clips.directory, index as number, path);
      this.highlightExportState = { state: "COMPLETED", progress: 100, current: 1, total: 1 };
      return { success: true, paths: [path], error: null };
    } catch (error) {
      this.highlightExportState = { state: "ERROR", progress: null, current: 1, total: 1 };
      throw error;
    } finally {
      this.highlightExportInFlight = false;
    }
  }

  // Cut every persisted suggestion (or the validated edited list) from the
  // ORIGINAL recording sources. Never modifies the take's original recording.
  async exportAllHighlightClips(request: ExportAllHighlightsRequest): Promise<HighlightClipExportResult> {
    if (this.active || this.startPromise) {
      throw new Error("Stop the current recording before exporting highlights.");
    }
    if (this.postProcessingState === "PROCESSING" || this.retryPromise) {
      throw new Error("Wait for the selected layout exports to finish before exporting highlights.");
    }
    if (this.aiHighlightsState.state === "ANALYZING") {
      throw new Error("Wait for highlight analysis to finish before exporting.");
    }
    if (this.highlightExportInFlight) {
      throw new Error("A highlight export is already running.");
    }
    const loaded = await this.loadHighlightClips(request?.id);
    const edited = Array.isArray(request?.clips) && request.clips.length > 0 ? request.clips : loaded.clips;
    const durationSeconds = loaded.durationSeconds;
    const total = edited.length;
    this.highlightExportInFlight = true;
    this.highlightExportState = { state: "WORKING", progress: 0, current: 0, total };
    try {
      const paths: string[] = [];
      for (let index = 0; index < edited.length; index += 1) {
        const current = index + 1;
        const clip = this.clampClipToDuration(edited[index], durationSeconds);
        this.highlightExportState = { state: "WORKING", progress: 0, current, total };
        const path = await this.cutHighlightClip(loaded, clip, index, (progress) => {
          if (this.highlightExportInFlight) {
            this.highlightExportState = {
              state: "WORKING",
              progress: Math.round(((index + progress / 100) / Math.max(1, total)) * 100),
              current,
              total,
            };
          }
        });
        paths.push(path);
        await this.markHighlightExported(loaded.directory, index, path);
      }
      if (paths.length === 0) {
        throw new Error("There are no highlight suggestions to export.");
      }
      this.highlightExportState = { state: "COMPLETED", progress: 100, current: total, total };
      return { success: true, paths, error: null };
    } catch (error) {
      this.highlightExportState = { state: "ERROR", progress: null, current: 0, total };
      throw error;
    } finally {
      this.highlightExportInFlight = false;
    }
  }

  private clampClipToDuration(clip: AiHighlightSuggestion, durationSeconds: number): AiHighlightSuggestion {
    const start = Math.min(Math.max(0, Number(clip.startTime) || 0), Math.max(0, durationSeconds - 0.5));
    const end = Math.min(Math.max(0, Number(clip.endTime) || 0), durationSeconds);
    if (!(start < end)) {
      throw new Error("Highlight times are invalid: the end must be after the start.");
    }
    return { ...clip, startTime: start, endTime: end, source: "ai" };
  }

  // Highlights render from the ORIGINAL recording sources with the full scene
  // composition (vertical layout at the take's export resolution) — the 360p
  // file exists only to keep the AI upload small. Never modifies sources.
  private async cutHighlightClip(
    loaded: { directory: string; project: ProjectMetadata; source: RecordingResult; scene: RecordingScene },
    clip: AiHighlightSuggestion,
    index: number,
    onProgress: (progress: number) => void,
  ): Promise<string> {
    const fileName = highlightFileName(index, clip.category);
    const outputPath = join(loaded.directory, "exports", fileName);
    const startSeconds = Math.max(0, clip.startTime);
    const lengthSeconds = Math.max(0.5, clip.endTime - clip.startTime);
    try {
      await this.renderLayout(loaded.source, "VERTICAL", loaded.scene, outputPath, loaded.project, onProgress, {
        scope: "ai-short-clip",
        clipRange: { startSeconds, lengthSeconds },
      });
    } catch (error) {
      await rm(outputPath, { force: true }).catch((cleanupError: unknown) => {
        console.error("Unable to remove incomplete highlight export:", cleanupError);
      });
      throw error;
    }
    return outputPath;
  }

  // ffprobe-measured duration of the analysis source; falls back to the take's
  // recorded duration when ffprobe is unavailable. Never shells out: argv only.
  private async measureVideoDuration(videoPath: string, fallbackDurationMs: number): Promise<number> {
    const fallbackSeconds = Math.max(0.1, (Number(fallbackDurationMs) || 0) / 1000);
    const ffprobePath = process.env.BABU_STUDIO_FFPROBE_PATH || "ffprobe";
    try {
      const { spawn } = await import("node:child_process");
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(
          ffprobePath,
          ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", videoPath],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        let stdout = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
        });
        child.once("error", reject);
        child.once("close", (code) => {
          if (code === 0) {
            resolve(stdout.trim());
          } else {
            reject(new Error(`ffprobe exited with code ${code ?? "unknown"}`));
          }
        });
      });
      const seconds = Number(output);
      if (Number.isFinite(seconds) && seconds > 0) {
        return seconds;
      }
      return fallbackSeconds;
    } catch {
      return fallbackSeconds;
    }
  }

  private async writeHighlightsSidecar(
    directory: string,
    durationSeconds: number,
    clips: AiHighlightSuggestion[],
    analyzedAt: string,
    sourceFile: string,
  ): Promise<void> {
    const sidecar = {
      version: 1,
      model: HIGHLIGHTS_MODEL_ID,
      analyzedAt,
      durationSeconds,
      sourceFile,
      clips: clips.map((clip) => ({ ...clip, source: "ai" })),
      exports: clips.map(() => ({ state: "PENDING", path: null as string | null })),
    };
    await mkdir(join(directory, "exports"), { recursive: true });
    await writeFile(join(directory, "exports", AI_HIGHLIGHTS_FILE), JSON.stringify(sidecar, null, 2));
  }

  private async loadHighlightClips(id: string): Promise<{ directory: string; clips: AiHighlightSuggestion[]; durationSeconds: number; project: ProjectMetadata; source: RecordingResult; scene: RecordingScene }> {
    if (typeof id !== "string" || !RECORDING_ID_PATTERN.test(id)) {
      throw new Error("Select a valid recording for highlight export.");
    }
    const directory = join(this.recordingsRoot(), id);
    let sidecar: { clips?: unknown; durationSeconds?: unknown; sourceFile?: unknown };
    try {
      sidecar = JSON.parse(await readFile(join(directory, "exports", AI_HIGHLIGHTS_FILE), "utf8"));
    } catch {
      throw new Error("Find highlights first, then export the suggestions.");
    }
    const rawClips = Array.isArray(sidecar.clips) ? sidecar.clips : [];
    const durationSeconds = Number(sidecar.durationSeconds);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error("The saved highlight analysis is unreadable. Run Find Highlights again.");
    }
    const clips = parseHighlightSuggestions(rawClips, durationSeconds, HIGHLIGHTS_MODEL_ID);
    if (clips.length === 0) {
      throw new Error("The saved highlight analysis is unreadable. Run Find Highlights again.");
    }
    let project: ProjectMetadata;
    try {
      project = JSON.parse(await readFile(join(directory, PROJECT_FILE), "utf8")) as ProjectMetadata;
      await assertSourcesExist(projectSources(project, directory), directory);
    } catch {
      throw new Error("The selected recording's source files could not be found.");
    }
    const source = project.recordingResult as RecordingResult | undefined;
    if (!source?.success) {
      throw new Error("The selected recording has no finalized source to export.");
    }
    const scene = project.scene as RecordingScene | undefined;
    if (!scene) {
      throw new Error("The shared scene configuration was not saved with this recording.");
    }
    this.projectDirectory = directory;
    this.projectFile = join(directory, PROJECT_FILE);
    this.projectMetadata = project;
    this.finalizedResult = source;
    return { directory, clips, durationSeconds, project, source, scene };
  }

  private async markHighlightExported(directory: string, index: number, path: string): Promise<void> {
    try {
      const sidecarPath = join(directory, "exports", AI_HIGHLIGHTS_FILE);
      const sidecar = JSON.parse(await readFile(sidecarPath, "utf8")) as {
        exports?: Array<{ state: string; path: string | null }>;
      };
      if (Array.isArray(sidecar.exports) && sidecar.exports[index]) {
        sidecar.exports[index] = { state: "COMPLETED", path };
        await writeFile(sidecarPath, JSON.stringify(sidecar, null, 2));
      }
    } catch (error) {
      console.error("Unable to record highlight export status:", error);
    }
  }

  private recordingsRoot(): string {
    return join(app.getPath("videos"), "Babu Studio");
  }

  private async startExport(result: RecordingResult): Promise<RecordingResult> {
    const projectMetadata = this.projectMetadata;
    const projectDirectory = this.projectDirectory;
    if (!projectMetadata || !projectDirectory) {
      throw new Error("The recording project directory is unavailable.");
    }
    this.postProcessingState = "PROCESSING";
    this.postProcessingError = undefined;
    projectMetadata.postProcessingStartedAt = new Date().toISOString();
    projectMetadata.postProcessingError = null;
    projectMetadata.postProcessingFailedAt = null;
    this.exportPaths = {};
    this.exportStates = this.selectedExportModes.map((mode) => {
      const path = join(projectDirectory, "exports", mode === "HORIZONTAL" ? "horizontal.mp4" : "vertical.mp4");
      this.exportPaths[mode] = path;
      return { mode, path, state: "PENDING", progress: 0 };
    });
    this.exportPath = this.exportPaths[result.recordingMode] ?? this.exportStates[0]?.path ?? null;
    projectMetadata.status = "SOURCE_FINALIZED";
    projectMetadata.postProcessingStatus = this.postProcessingState;
    projectMetadata.exportFiles = { ...this.exportPaths };
    projectMetadata.exports = this.exportStates;
    try {
      await mkdir(join(projectDirectory, "exports"), { recursive: true });
      await this.writeProject();
    } catch (error) {
      await this.handlePostProcessingFailure(new Error(`Unable to save project metadata before export: ${error instanceof Error ? error.message : String(error)}`));
      return this.withPostProcessing(result);
    }

    this.launchPostProcessing(result);
    return this.withPostProcessing(result);
  }

  async getStatus(): Promise<RecordingResult> {
    const result = await this.mediaCore.getRecordingStatus();
    return this.withPostProcessing(result);
  }

  private withPostProcessing(result: RecordingResult): RecordingResult {
    return {
      ...result,
      error: this.postProcessingError ?? result.error,
      postProcessingState: this.postProcessingState,
      exportPath: this.exportPath,
      exportPaths: { ...this.exportPaths },
      exports: this.exportStates.map((entry) => ({ ...entry })),
      aiPreview: { ...this.aiPreviewState },
      aiShotExport: { ...this.aiShotExportState },
      aiShortClip: { ...this.aiShortClipState },
      aiHighlights: {
        ...this.aiHighlightsState,
        clips: this.aiHighlightsState.clips.map((clip) => ({ ...clip })),
      },
      aiSubtitles: {
        ...this.aiSubtitlesState,
        languages: this.aiSubtitlesState.languages.map((language) => ({ ...language })),
      },
      aiHighlightExport: { ...this.highlightExportState },
    };
  }

  cancelPostProcessing(): void {
    if (this.postProcessingState === "PROCESSING") {
      this.postProcessingCancelled = true;
      this.stopPostProcessing();
    }
  }

  stopPostProcessing(): void {
    if (this.postProcessingProcess && !this.postProcessingProcess.killed) {
      this.postProcessingProcess.kill("SIGTERM");
    }
  }

  async finishForShutdown(): Promise<void> {
    if (this.startPromise) {
      try {
        await this.startPromise;
      } catch (error) {
        if (this.active) {
          throw error;
        }
        console.error("Recording setup failed while preparing to quit:", error);
      }
    }
    if (this.stopPromise) {
      const result = await this.stopPromise;
      if (!result.success && this.stopResult) {
        throw new Error(result.error || "The recording could not be finalized.");
      }
    }
    if (this.active) {
      const result = await this.stop();
      if (!result.success && this.stopResult) {
        throw new Error(result.error || "The recording could not be finalized.");
      }
    }
    if (this.retryPromise) {
      await this.retryPromise;
    }
    if (this.postProcessingState === "PROCESSING" && this.postProcessingPromise) {
      await this.postProcessingPromise;
    }
    if (this.postProcessingState === "ERROR") {
      throw new Error(this.postProcessingError || "One or more layout exports failed.");
    }
  }

  async retryPostProcessing(): Promise<RecordingResult> {
    if (this.retryPromise) {
      throw new Error("Post-processing is already being retried.");
    }
    if (this.active || this.postProcessingState === "PROCESSING") {
      throw new Error("Post-processing cannot be retried while recording or exporting is active.");
    }
    const result = this.finalizedResult;
    if (!result?.success || !this.projectMetadata || !this.projectFile || !this.projectDirectory) {
      throw new Error("There is no finalized source recording available to export.");
    }
    const retryPromise = this.beginRetryPostProcessing(result);
    this.retryPromise = retryPromise;
    try {
      return await retryPromise;
    } finally {
      if (this.retryPromise === retryPromise) {
        this.retryPromise = undefined;
      }
    }
  }

  private async beginRetryPostProcessing(result: RecordingResult): Promise<RecordingResult> {
    const projectMetadata = this.projectMetadata;
    if (!projectMetadata) {
      throw new Error("The recording project metadata is unavailable.");
    }
    this.postProcessingState = "PROCESSING";
    this.postProcessingError = undefined;
    this.exportPath = this.exportPaths[result.recordingMode] ?? null;
    this.exportStates = this.exportStates.map((entry) => (
      entry.state === "COMPLETED"
        ? entry
        : { ...entry, state: "PENDING", progress: 0, error: undefined }
    ));
    projectMetadata.postProcessingStatus = this.postProcessingState;
    projectMetadata.status = "SOURCE_FINALIZED";
    projectMetadata.postProcessingError = null;
    projectMetadata.postProcessingFailedAt = null;
    projectMetadata.exports = this.exportStates;
    projectMetadata.postProcessingStartedAt = new Date().toISOString();
    try {
      await this.writeProject();
    } catch (error) {
      await this.handlePostProcessingFailure(new Error(`Unable to save project metadata before retry: ${error instanceof Error ? error.message : String(error)}`));
      throw error;
    }
    this.launchPostProcessing(result);
    return this.withPostProcessing(result);
  }

  private launchPostProcessing(result: RecordingResult): void {
    this.postProcessingCancelled = false;
    // Hold the guard from launch until every export (and failure handling) has finished.
    const releasePowerGuard = powerGuard.acquire();
    this.postProcessingPromise = this.postProcess(result)
      .catch((error: unknown) => this.handlePostProcessingFailure(error))
      .finally(releasePowerGuard);
  }

  private async handlePostProcessingFailure(error: unknown): Promise<void> {
    this.postProcessingState = "ERROR";
    this.postProcessingError = error instanceof Error ? error.message : String(error);
    const activeExport = this.exportStates.find((entry) => entry.state === "PROCESSING");
    if (activeExport) {
      activeExport.state = "ERROR";
      activeExport.error = this.postProcessingError;
    }
    if (this.projectMetadata) {
      this.projectMetadata.postProcessingStatus = this.postProcessingState;
      this.projectMetadata.status = "EXPORT_FAILED";
      this.projectMetadata.postProcessingError = this.postProcessingError;
      this.projectMetadata.postProcessingFailedAt = new Date().toISOString();
      this.projectMetadata.exports = this.exportStates;
    }
    if (this.activeExportPath) {
      await rm(this.activeExportPath, { force: true }).catch((cleanupError: unknown) => {
        console.error("Unable to remove incomplete export:", cleanupError);
      });
      this.activeExportPath = undefined;
    }
    try {
      await this.writeProject();
    } catch (metadataError) {
      console.error("Unable to save post-processing failure to project metadata:", metadataError);
    }
    console.error("Recording post-processing failed:", error);
  }

  private async postProcess(result: RecordingResult): Promise<void> {
    const project = this.projectMetadata;
    const scene = project?.scene as RecordingScene | undefined;
    if (!project || !scene || !this.projectDirectory) {
      throw new Error("The shared scene configuration was not saved with this recording.");
    }
    const failedExports: string[] = [];
    for (const exportEntry of this.exportStates) {
      if (exportEntry.state === "COMPLETED") {
        continue;
      }
      if (this.postProcessingCancelled) {
        exportEntry.state = "ERROR";
        exportEntry.error = "Export cancelled";
        failedExports.push(`${exportEntry.mode}: ${exportEntry.error}`);
        continue;
      }
      exportEntry.state = "PROCESSING";
      exportEntry.error = undefined;
      exportEntry.progress = 0;
      this.activeExportPath = exportEntry.path;
      project.exports = this.exportStates;
      await this.writeProject();
      try {
        await mkdir(dirname(exportEntry.path), { recursive: true });
        await this.renderLayout(
          result,
          exportEntry.mode,
          scene,
          exportEntry.path,
          project,
          (progress) => { exportEntry.progress = progress; },
        );
        exportEntry.state = "COMPLETED";
        exportEntry.progress = 100;
      } catch (error) {
        exportEntry.state = "ERROR";
        exportEntry.error = error instanceof Error ? error.message : String(error);
        failedExports.push(`${exportEntry.mode}: ${exportEntry.error}`);
        await rm(exportEntry.path, { force: true }).catch((cleanupError: unknown) => {
          console.error(`Unable to remove incomplete ${exportEntry.mode} export:`, cleanupError);
        });
        console.error(`${exportEntry.mode} export failed:`, error);
      } finally {
        this.activeExportPath = undefined;
      }
      project.exports = this.exportStates;
      await this.writeProject();
    }

    this.postProcessingState = failedExports.length > 0 ? "ERROR" : "COMPLETED";
    this.postProcessingError = failedExports.length > 0 ? failedExports.join("; ") : undefined;
    project.postProcessingStatus = this.postProcessingState;
    project.status = this.postProcessingCancelled
      ? "EXPORT_CANCELLED"
      : failedExports.length > 0 ? "EXPORT_FAILED" : "COMPLETED";
    project.postProcessingError = this.postProcessingError ?? null;
    if (failedExports.length > 0) {
      project.postProcessingFailedAt = new Date().toISOString();
      project.postProcessingCompletedAt = null;
    } else {
      project.postProcessingFailedAt = null;
      project.postProcessingCompletedAt = new Date().toISOString();
    }
    await this.writeProject();
  }

  private async renderLayout(
    result: RecordingResult,
    mode: RecordingMode,
    scene: RecordingScene,
    exportPath: string,
    project: ProjectMetadata,
    onProgress: (progress: number) => void,
    options?: { previewQuality?: boolean; forcedCanvas?: { width: number; height: number }; scope?: "export" | "ai-preview" | "ai-shot" | "ai-short-clip"; clipRange?: { startSeconds: number; lengthSeconds: number } },
  ): Promise<void> {
    const preview = options?.previewQuality === true;
    const ffmpegScope = options?.scope ?? (preview ? "ai-preview" : "export");
    const isCancelled = () => this.isScopeCancelled(ffmpegScope);
    // Highlight exports render only a time window of the take. A uniform
    // input seek on every source keeps the tracks aligned exactly as they
    // are in a full export; only the window changes.
    const clipStart = Math.max(0, options?.clipRange?.startSeconds ?? 0);
    const projectDirectory = this.projectDirectory;
    if (!projectDirectory) {
      throw new Error("The recording project directory is unavailable.");
    }
    const videoTracks = result.videoTracks;
    const activeLayers = scene.layers.filter((layer) => layer.enabled);
    const videoLayers = activeLayers.filter((layer) => layer.kind === "game-capture" || layer.kind === "camera-device").reverse();
    if (videoLayers.length === 0) {
      throw new Error(`${mode} scene has no recorded capture-card or webcam video source.`);
    }
    const audioTrackNames = result.audioTracks;
    const sourceEntries = projectSources(project, projectDirectory) ?? resultSourceFiles(result);
    const inputs = sourceEntries ? sourceEntries.map((entry) => entry.path) : [join(projectDirectory, MASTER_FILE)];
    const videoRefFor = (trackName: string): string => {
      if (sourceEntries) {
        const input = sourceEntries.findIndex((entry) => entry.kind === "video" && entry.name === trackName);
        if (input < 0) {
          throw new Error(`${trackName} is configured in the scene but has no recorded video file.`);
        }
        return `[${input}:v:0]`;
      }
      const trackIndex = videoTracks.indexOf(trackName);
      if (trackIndex < 0) {
        throw new Error(`${trackName} is configured in the scene but has no recorded video track.`);
      }
      return `[0:v:${trackIndex}]`;
    };
    const audioRefFor = (trackName: string): string => {
      if (sourceEntries) {
        const input = sourceEntries.findIndex((entry) => entry.kind === "audio" && entry.name === trackName);
        if (input < 0) {
          throw new Error(`${trackName} is configured in the scene but has no recorded audio file.`);
        }
        return `[${input}:a:0]`;
      }
      const trackIndex = audioTrackNames.indexOf(trackName);
      if (trackIndex < 0) {
        throw new Error(`${trackName} is configured in the scene but has no recorded audio track.`);
      }
      return `[0:a:${trackIndex}]`;
    };
    const audioSettings = project.audio && typeof project.audio === "object"
      ? project.audio as { gameVolume?: number; microphoneVolume?: number; noiseReduction?: NoiseReductionLevel }
      : {};
    const microphoneNoiseReduction = isNoiseReductionLevel(audioSettings.noiseReduction)
      ? audioSettings.noiseReduction
      : DEFAULT_NOISE_REDUCTION;
    const audioLayers = [
      { trackName: "Game Audio", volume: finite(audioSettings.gameVolume ?? 1, 1), noiseReduction: DEFAULT_NOISE_REDUCTION },
      { trackName: "Microphone", volume: finite(audioSettings.microphoneVolume ?? 1, 1), noiseReduction: microphoneNoiseReduction },
    ].filter((track) => audioTrackNames.includes(track.trackName));
    const trackStartOffsetMs = (name: string, kind: "video" | "audio") => {
      const track = result.trackStats?.find((candidate) => candidate.name === name && candidate.kind === kind);
      return Math.max(0, Math.round(finite(track?.startOffsetMs ?? 0)));
    };

    const projectCanvas = project.canvas as {
      exportResolution?: keyof typeof EXPORT_RESOLUTIONS;
      fps?: number;
    };
    const resolution = EXPORT_RESOLUTIONS[projectCanvas.exportResolution ?? DEFAULT_EXPORT_RESOLUTION]
      ?? EXPORT_RESOLUTIONS[DEFAULT_EXPORT_RESOLUTION];
    const canvas = options?.forcedCanvas
      ?? (preview
        ? { width: AI_PREVIEW_WIDTH, height: AI_PREVIEW_HEIGHT }
        : mode === "VERTICAL" ? resolution.vertical : resolution.horizontal);
    const width = canvas.width;
    const height = canvas.height;
    const fps = preview ? AI_PREVIEW_FPS : Math.round(finite(projectCanvas.fps ?? 60, 60));
    const durationSeconds = options?.clipRange
      ? Math.max(0.1, options.clipRange.lengthSeconds)
      : Math.max(0.1, result.durationMs / 1000);
    const graph: string[] = [`color=c=black:s=${width}x${height}:r=${fps}:d=${durationSeconds.toFixed(3)},format=yuv420p[base0]`];
    let currentVideo = "base0";
    let nextLayer = 0;
    for (const layer of videoLayers) {
      const trackName = layer.kind === "game-capture" ? "Gameplay" : "Webcam";
      const videoRef = videoRefFor(trackName);
      const source = getSourceDimensions(layer);
      const sourceWidth = Math.max(2, finite(source.width, 1920));
      const sourceHeight = Math.max(2, finite(source.height, 1080));
      const crop = layer.crop;
      const left = Math.max(0, Math.min(sourceWidth - 2, Math.round(finite(crop.left))));
      const right = Math.max(0, Math.min(sourceWidth - left - 2, Math.round(finite(crop.right))));
      const top = Math.max(0, Math.min(sourceHeight - 2, Math.round(finite(crop.top))));
      const bottom = Math.max(0, Math.min(sourceHeight - top - 2, Math.round(finite(crop.bottom))));
      const transform = layer.transforms[mode === "VERTICAL" ? "portrait" : "landscape"];
      const visibleWidth = sourceWidth - left - right;
      const visibleHeight = sourceHeight - top - bottom;
      const xPct = finite(transform.x) + finite(transform.width) * left / sourceWidth;
      const yPct = finite(transform.y) + finite(transform.height) * top / sourceHeight;
      const targetWidth = evenDimension(width * finite(transform.width) * visibleWidth / sourceWidth / 100);
      const targetHeight = evenDimension(height * finite(transform.height) * visibleHeight / sourceHeight / 100);
      const x = Math.round(width * xPct / 100);
      const y = Math.round(height * yPct / 100);
      const sourceOffsetSeconds = (trackStartOffsetMs(trackName, "video") / 1000).toFixed(3);
      const layerLabel = `layer${nextLayer}`;
      const composedLabel = `base${nextLayer + 1}`;
      graph.push(
        `${videoRef}setpts=PTS-STARTPTS+${sourceOffsetSeconds}/TB,crop=iw-${left + right}:ih-${top + bottom}:${left}:${top},scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease:flags=bicubic,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1,format=yuva420p[${layerLabel}]`,
      );
      graph.push(`[${currentVideo}][${layerLabel}]overlay=${x}:${y}:format=yuv420:eof_action=pass:shortest=0[${composedLabel}]`);
      currentVideo = composedLabel;
      nextLayer += 1;
    }

    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-progress", "pipe:2",
      "-nostats",
      "-y",
      "-threads", "0",
      "-filter_threads", String(os.cpus().length),
      "-filter_complex_threads", String(os.cpus().length),
      ...inputs.flatMap((input) => clipStart > 0 ? ["-ss", clipStart.toFixed(3), "-i", input] : ["-i", input]),
    ];
    const gameAudio = audioLayers.find((track) => track.trackName === "Game Audio");
    const microphone = audioLayers.find((track) => track.trackName === "Microphone");
    const inputFor = (track: (typeof audioLayers)[number]) => audioRefFor(track.trackName);
    const gainFor = (track: (typeof audioLayers)[number]) => Math.max(0, Math.min(MAX_AUDIO_GAIN, track.volume)).toFixed(4);
    const alignAudioTrack = (track: (typeof audioLayers)[number]) => {
      const delayMs = trackStartOffsetMs(track.trackName, "audio");
      const delay = delayMs > 0 ? `,adelay=${delayMs}|${delayMs}` : "";
      const noiseReduction = NOISE_REDUCTION_FILTERS[track.noiseReduction];
      return `${inputFor(track)}aresample=48000,asetpts=PTS-STARTPTS${delay}${noiseReduction ? `,${noiseReduction}` : ""}`;
    };
    let audioOutputLabel: string | undefined;
    if (gameAudio && microphone) {
      // No ducking: game audio keeps a constant level; voice is louder on top of it.
      graph.push(`${alignAudioTrack(gameAudio)},volume=${(Number(gainFor(gameAudio)) * 0.8).toFixed(4)}[gameAudio]`);
      graph.push(
        `${alignAudioTrack(microphone)},volume=${gainFor(microphone)},acompressor=threshold=0.1:ratio=2:attack=5:release=200:makeup=4,volume=1.5[voice]`,
      );
      graph.push("[gameAudio][voice]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95:attack=5:release=250[mixedAudio]");
      audioOutputLabel = "[mixedAudio]";
    } else if (microphone) {
      graph.push(
        `${alignAudioTrack(microphone)},volume=${gainFor(microphone)},acompressor=threshold=0.1:ratio=2:attack=5:release=200:makeup=4,alimiter=limit=0.95[mixedAudio]`,
      );
      audioOutputLabel = "[mixedAudio]";
    } else if (gameAudio) {
      graph.push(`${alignAudioTrack(gameAudio)},volume=${gainFor(gameAudio)},alimiter=limit=0.95[mixedAudio]`);
      audioOutputLabel = "[mixedAudio]";
    }
    args.push("-filter_complex", graph.join(";"), "-map", `[${currentVideo}]`);
    if (audioOutputLabel) {
      args.push("-map", audioOutputLabel);
    }
    args.push(
      "-t", durationSeconds.toFixed(3),
      "-r", String(fps),
      "-c:v", "h264_videotoolbox", "-allow_sw", "1",
      ...(preview
        ? ["-b:v", "1.5M", "-profile:v", "high"]
        : [
          "-b:v", width >= 3840 ? "40M" : width >= 1920 || height >= 1920 ? "20M" : "10M",
          "-realtime", "0", "-prio_speed", "1", "-profile:v", "high",
        ]),
      ...(audioOutputLabel ? ["-c:a", "aac", "-b:a", preview ? "128k" : "192k"] : []),
      "-movflags", "+faststart",
      exportPath,
    );

    if (isCancelled()) {
      throw new Error("Export cancelled");
    }
    try {
      await this.runFfmpegTracked(args, durationSeconds, onProgress, ffmpegScope);
    } catch (hardwareError) {
      await rm(exportPath, { force: true });
      if (isCancelled()) {
        throw new Error("Export cancelled");
      }
      onProgress(0);
      const softwareArgs = [...args];
      const encoderIndex = softwareArgs.indexOf("h264_videotoolbox");
      if (encoderIndex < 0) {
        throw hardwareError;
      }
      softwareArgs[encoderIndex] = "libx264";
      softwareArgs.splice(encoderIndex + 1, 0, "-preset", "veryfast", "-crf", preview ? "28" : "20");
      const bitrateIndex = softwareArgs.indexOf("-b:v");
      const bitrateFlags = softwareArgs.indexOf("-realtime");
      if (bitrateIndex >= 0) {
        softwareArgs.splice(bitrateIndex, 2);
      }
      if (bitrateFlags >= 0) {
        softwareArgs.splice(softwareArgs.indexOf("-realtime"), 4);
      }
      const softwareFallbackIndex = softwareArgs.indexOf("-allow_sw");
      if (softwareFallbackIndex >= 0) {
        softwareArgs.splice(softwareFallbackIndex, 2);
      }
      await this.runFfmpegTracked(softwareArgs, durationSeconds, onProgress, ffmpegScope);
    }
  }

  private runFfmpegTracked(
    args: string[],
    durationSeconds: number,
    onProgress: (progress: number) => void,
    scope: "export" | "ai-preview" | "ai-shot" | "ai-short-clip" = "export",
  ): Promise<void> {
    return runFfmpeg(
      args,
      (child) => {
        if (scope === "ai-preview") {
          this.aiPreviewProcess = child;
        } else if (scope === "ai-shot") {
          this.aiShotExportProcess = child;
        } else if (scope === "ai-short-clip") {
          this.aiShortClipProcess = child;
        } else {
          this.postProcessingProcess = child;
        }
        if (this.isScopeCancelled(scope)) {
          child.kill("SIGTERM");
        }
      },
      (child) => {
        if (scope === "ai-preview") {
          if (this.aiPreviewProcess === child) {
            this.aiPreviewProcess = undefined;
          }
        } else if (scope === "ai-shot") {
          if (this.aiShotExportProcess === child) {
            this.aiShotExportProcess = undefined;
          }
        } else if (scope === "ai-short-clip") {
          if (this.aiShortClipProcess === child) {
            this.aiShortClipProcess = undefined;
          }
        } else if (this.postProcessingProcess === child) {
          this.postProcessingProcess = undefined;
        }
      },
      (microseconds) => {
        const progress = Math.min(99, Math.round(
          Math.min(1, microseconds / (durationSeconds * 1_000_000)) * 100,
        ));
        onProgress(progress);
      },
    );
  }

  private async writeProject(): Promise<void> {
    if (this.projectFile && this.projectMetadata) {
      await writeFile(this.projectFile, JSON.stringify(this.projectMetadata, null, 2));
    }
  }
}
