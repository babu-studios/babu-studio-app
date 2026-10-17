import { app, systemPreferences } from "electron";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { powerGuard } from "./power-guard.service";
import type { Readable } from "node:stream";
import type {
  NativeCaptureDevice,
  ExportRecordingRequest,
  PostProcessingState,
  RecordingExport,
  RecordingLayer,
  RecordingMode,
  RecordingResult,
  RecordingScene,
  RecordingSummary,
  StartRecordingRequest,
} from "@shared/types/media";
import { DEFAULT_EXPORT_RESOLUTION, EXPORT_RESOLUTIONS } from "@shared/constants/media.constants";
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
      this.projectFile = join(directory, "project.json");
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
          master: "master.mkv",
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
      master: "master.mkv",
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
        const project = JSON.parse(await readFile(join(directory, "project.json"), "utf8")) as ProjectMetadata;
        const source = project.recordingResult as RecordingResult | undefined;
        if (!source?.success) {
          continue;
        }
        await stat(join(directory, "master.mkv"));
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
      project = JSON.parse(await readFile(join(directory, "project.json"), "utf8")) as ProjectMetadata;
      await stat(join(directory, "master.mkv"));
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
    this.projectFile = join(directory, "project.json");
    this.projectMetadata = project;
    this.finalizedResult = source;
    this.stopResult = undefined;
    this.selectedExportModes = exportModes;
    return this.startExport(source);
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
  ): Promise<void> {
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
    const audioSettings = project.audio && typeof project.audio === "object"
      ? project.audio as { gameVolume?: number; microphoneVolume?: number }
      : {};
    const audioLayers = [
      { trackName: "Game Audio", volume: finite(audioSettings.gameVolume ?? 1, 1) },
      { trackName: "Microphone", volume: finite(audioSettings.microphoneVolume ?? 1, 1) },
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
    const canvas = mode === "VERTICAL" ? resolution.vertical : resolution.horizontal;
    const width = canvas.width;
    const height = canvas.height;
    const fps = Math.round(finite(projectCanvas.fps ?? 60, 60));
    const durationSeconds = Math.max(0.1, result.durationMs / 1000);
    const graph: string[] = [`color=c=black:s=${width}x${height}:r=${fps}:d=${durationSeconds.toFixed(3)}[base0]`];
    let currentVideo = "base0";
    let nextLayer = 0;
    for (const layer of videoLayers) {
      const trackName = layer.kind === "game-capture" ? "Gameplay" : "Webcam";
      const trackIndex = videoTracks.indexOf(trackName);
      if (trackIndex < 0) {
        throw new Error(`${trackName} is configured in the scene but has no recorded video track.`);
      }
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
        `[0:v:${trackIndex}]setpts=PTS-STARTPTS+${sourceOffsetSeconds}/TB,crop=iw-${left + right}:ih-${top + bottom}:${left}:${top},scale=${targetWidth}:${targetHeight}:flags=lanczos,setsar=1,format=rgba[${layerLabel}]`,
      );
      graph.push(`[${currentVideo}][${layerLabel}]overlay=${x}:${y}:eof_action=pass:shortest=0[${composedLabel}]`);
      currentVideo = composedLabel;
      nextLayer += 1;
    }

    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-progress", "pipe:2",
      "-nostats",
      "-y",
      "-i", join(projectDirectory, "master.mkv"),
    ];
    const gameAudio = audioLayers.find((track) => track.trackName === "Game Audio");
    const microphone = audioLayers.find((track) => track.trackName === "Microphone");
    const inputFor = (track: (typeof audioLayers)[number]) => `[0:a:${audioTrackNames.indexOf(track.trackName)}]`;
    const gainFor = (track: (typeof audioLayers)[number]) => Math.max(0, Math.min(1, track.volume)).toFixed(4);
    const alignAudioTrack = (track: (typeof audioLayers)[number]) => {
      const delayMs = trackStartOffsetMs(track.trackName, "audio");
      const delay = delayMs > 0 ? `,adelay=${delayMs}|${delayMs}` : "";
      return `${inputFor(track)}aresample=48000,asetpts=PTS-STARTPTS${delay}`;
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
      ...(audioOutputLabel ? ["-c:a", "aac", "-b:a", "192k"] : []),
      "-movflags", "+faststart",
      exportPath,
    );

    if (this.postProcessingCancelled) {
      throw new Error("Export cancelled");
    }
    try {
      await this.runFfmpegTracked(args, durationSeconds, onProgress);
    } catch (hardwareError) {
      await rm(exportPath, { force: true });
      if (this.postProcessingCancelled) {
        throw new Error("Export cancelled");
      }
      onProgress(0);
      const softwareArgs = [...args];
      const encoderIndex = softwareArgs.indexOf("h264_videotoolbox");
      if (encoderIndex < 0) {
        throw hardwareError;
      }
      softwareArgs[encoderIndex] = "libx264";
      softwareArgs.splice(encoderIndex + 1, 0, "-preset", "veryfast", "-crf", "20");
      const softwareFallbackIndex = softwareArgs.indexOf("-allow_sw");
      if (softwareFallbackIndex >= 0) {
        softwareArgs.splice(softwareFallbackIndex, 2);
      }
      await this.runFfmpegTracked(softwareArgs, durationSeconds, onProgress);
    }
  }

  private runFfmpegTracked(
    args: string[],
    durationSeconds: number,
    onProgress: (progress: number) => void,
  ): Promise<void> {
    return runFfmpeg(
      args,
      (child) => {
        this.postProcessingProcess = child;
        if (this.postProcessingCancelled) {
          child.kill("SIGTERM");
        }
      },
      (child) => {
        if (this.postProcessingProcess === child) {
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
