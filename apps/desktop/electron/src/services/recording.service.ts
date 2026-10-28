import { app, systemPreferences } from "electron";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { performance } from "node:perf_hooks";
import { powerGuard } from "./power-guard.service";
import type {
  AiArtifactsRequest,
  AiArtifactsResult,
  AiHighlightsStatus,
  AiPreviewResult,
  AiPreviewStatus,
  ExportAiPreviewRequest,
  ExportAllHighlightsRequest,
  ExportHighlightClipRequest,
  ExportRecordingRequest,
  FindHighlightsRequest,
  FindHighlightsResult,
  HighlightClipExportResult,
  PostProcessingState,
  RecordingExport,
  RecordingMode,
  RecordingResult,
  RecordingScene,
  RecordingSummary,
  StartRecordingRequest,
} from "@shared/types/media";
import {
  metaHighlightsProvider,
  type HighlightsProvider,
} from "./ai-highlights.provider";
import {
  DEFAULT_EXPORT_RESOLUTION,
  DEFAULT_NOISE_REDUCTION,
  EXPORT_RESOLUTIONS,
  isNoiseReductionLevel,
} from "@shared/constants/media.constants";
import type { MediaCoreService } from "./media-core.service";
import { failure, nativeDeviceId } from "./recording/device-match";
import { runFfmpeg, type FfmpegProcess } from "./recording/ffmpeg-runner";
import {
  assertSourcesExist,
  PROJECT_FILE,
  projectSources,
  RECORDING_ID_PATTERN,
  recordingsRoot,
  writeProjectFile,
  type ProjectMetadata,
} from "./recording/project-store";
import * as exportRenderer from "./recording/export-renderer";
import type { PostProcessingHost } from "./recording/export-renderer";
import * as recordingAi from "./recording/recording-ai";
import type { AiScope, AiServiceHost } from "./recording/recording-ai";

type RecordingStartOptions = {
  outputDirectory?: string;
  synthetic?: boolean;
};

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

  private exportHost(): PostProcessingHost {
    return {
      projectDirectory: this.projectDirectory,
      isScopeCancelled: (scope) => this.isScopeCancelled(scope),
      runFfmpegTracked: (args, durationSeconds, onProgress, scope) => this.runFfmpegTracked(args, durationSeconds, onProgress, scope),
      getProjectMetadata: () => this.projectMetadata,
      getSelectedExportModes: () => this.selectedExportModes,
      getExportStates: () => this.exportStates,
      setExportStates: (states) => { this.exportStates = states; },
      getExportPaths: () => this.exportPaths,
      setExportPaths: (paths) => { this.exportPaths = paths; },
      getExportPath: () => this.exportPath,
      setExportPath: (path) => { this.exportPath = path; },
      getActiveExportPath: () => this.activeExportPath,
      setActiveExportPath: (path) => { this.activeExportPath = path; },
      isPostProcessingCancelled: () => this.postProcessingCancelled,
      setPostProcessingCancelled: (value) => { this.postProcessingCancelled = value; },
      setPostProcessingPromise: (promise) => { this.postProcessingPromise = promise; },
      getPostProcessingState: () => this.postProcessingState,
      setPostProcessingState: (state) => { this.postProcessingState = state; },
      getPostProcessingError: () => this.postProcessingError,
      setPostProcessingError: (error) => { this.postProcessingError = error; },
      saveProject: () => writeProjectFile(this.projectFile, this.projectMetadata),
      mergePostProcessing: (result) => this.withPostProcessing(result),
    };
  }

  private aiHost(): AiServiceHost {
    return {
      isRecordingActive: () => this.active,
      hasPendingStart: () => this.startPromise !== undefined,
      isExportProcessing: () => this.postProcessingState === "PROCESSING",
      hasPendingRetry: () => this.retryPromise !== undefined,
      tryBeginHighlightExport: () => {
        if (this.highlightExportInFlight) {
          return false;
        }
        this.highlightExportInFlight = true;
        return true;
      },
      endHighlightExport: () => { this.highlightExportInFlight = false; },
      assertNoHighlightExport: (action: string) => this.assertNoHighlightExport(action),
      getAiScopeState: (scope: AiScope) => scope === "ai-preview" ? this.aiPreviewState : scope === "ai-shot" ? this.aiShotExportState : this.aiShortClipState,
      setAiScopeState: (scope: AiScope, state: AiPreviewStatus) => {
        if (scope === "ai-preview") {
          this.aiPreviewState = state;
        } else if (scope === "ai-shot") {
          this.aiShotExportState = state;
        } else {
          this.aiShortClipState = state;
        }
      },
      isAiScopeCancelled: (scope: AiScope) => scope === "ai-preview" ? this.aiPreviewCancelled : scope === "ai-shot" ? this.aiShotExportCancelled : this.aiShortClipCancelled,
      setAiScopeCancelled: (scope: AiScope, value: boolean) => {
        if (scope === "ai-preview") {
          this.aiPreviewCancelled = value;
        } else if (scope === "ai-shot") {
          this.aiShotExportCancelled = value;
        } else {
          this.aiShortClipCancelled = value;
        }
      },
      getAiHighlightsState: () => this.aiHighlightsState,
      setAiHighlightsState: (state) => { this.aiHighlightsState = state; },
      setAiHighlightsRecordingId: (id) => { this.aiHighlightsRecordingId = id; },
      createHighlightsAbort: () => {
        const abort = new AbortController();
        this.aiHighlightsAbort = abort;
        return abort;
      },
      clearHighlightsAbort: (abort) => {
        if (this.aiHighlightsAbort === abort) {
          this.aiHighlightsAbort = undefined;
        }
      },
      getHighlightsProvider: () => this.highlightsProvider,
      getRecordingsRoot: () => recordingsRoot(),
      setProjectContext: (directory, project, source) => {
        this.projectDirectory = directory;
        this.projectFile = join(directory, PROJECT_FILE);
        this.projectMetadata = project;
        this.finalizedResult = source;
      },
      renderLayout: (result, mode, scene, exportPath, project, onProgress, options) => exportRenderer.renderLayout(
        {
          projectDirectory: this.projectDirectory,
          isScopeCancelled: (scope) => this.isScopeCancelled(scope),
          runFfmpegTracked: (args, durationSeconds, progress, scope) => this.runFfmpegTracked(args, durationSeconds, progress, scope),
        },
        result,
        mode,
        scene,
        exportPath,
        project,
        onProgress,
        options,
      ),
      runAiShortClipFfmpeg: (args, durationSeconds, onProgress) => this.runFfmpegTracked(args, durationSeconds, onProgress, "ai-short-clip"),
    };
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
    await exportRenderer.startExport(this.exportHost(), stopped);
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
      await writeProjectFile(this.projectFile, this.projectMetadata);

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
        await writeProjectFile(this.projectFile, this.projectMetadata);
      } else {
        coreStarted = true;
        projectMetadata.status = "RECORDING";
        projectMetadata.startedAt = new Date().toISOString();
        await writeProjectFile(this.projectFile, this.projectMetadata);
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
        await writeProjectFile(this.projectFile, this.projectMetadata);
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
      await writeProjectFile(this.projectFile, this.projectMetadata);
      return this.withPostProcessing({ ...result, postProcessingState: "NOT_STARTED", exportPath: null });
    }

    this.postProcessingState = "NOT_STARTED";
    this.postProcessingError = undefined;
    this.exportPaths = {};
    this.exportStates = [];
    this.exportPath = null;
    this.projectMetadata.postProcessingStatus = this.postProcessingState;
    try {
      await writeProjectFile(this.projectFile, this.projectMetadata);
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
    const root = recordingsRoot();
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
    const directory = join(recordingsRoot(), request.id);
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
    return exportRenderer.startExport(this.exportHost(), source);
  }

  async exportAiPreview(request: ExportAiPreviewRequest): Promise<AiPreviewResult> {
    return recordingAi.exportAiPreview(this.aiHost(), request);
  }

  cancelAiPreview(): void {
    if (this.aiPreviewState.state === "PROCESSING") {
      this.aiPreviewCancelled = true;
      if (this.aiPreviewProcess && !this.aiPreviewProcess.killed) {
        this.aiPreviewProcess.kill("SIGTERM");
      }
    }
  }

  async exportAiShotClip(request: ExportAiPreviewRequest): Promise<AiPreviewResult> {
    return recordingAi.exportAiShotClip(this.aiHost(), request);
  }

  cancelAiShotClipExport(): void {
    if (this.aiShotExportState.state === "PROCESSING") {
      this.aiShotExportCancelled = true;
      if (this.aiShotExportProcess && !this.aiShotExportProcess.killed) {
        this.aiShotExportProcess.kill("SIGTERM");
      }
    }
  }

  async generateAiShortClip(request: ExportAiPreviewRequest): Promise<AiPreviewResult> {
    return recordingAi.generateAiShortClip(this.aiHost(), request);
  }

  cancelAiShortClip(): void {
    if (this.aiShortClipState.state === "PROCESSING") {
      this.aiShortClipCancelled = true;
      if (this.aiShortClipProcess && !this.aiShortClipProcess.killed) {
        this.aiShortClipProcess.kill("SIGTERM");
      }
    }
  }

  async getAiArtifacts(request: AiArtifactsRequest): Promise<AiArtifactsResult> {
    return recordingAi.getAiArtifacts(this.aiHost(), request);
  }

  /** Test seam: substitute the network provider without touching callers. */
  setHighlightsProvider(provider: HighlightsProvider): void {
    this.highlightsProvider = provider;
  }

  async findHighlights(request: FindHighlightsRequest): Promise<FindHighlightsResult> {
    return recordingAi.findHighlights(this.aiHost(), request);
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

  async exportHighlightClip(request: ExportHighlightClipRequest): Promise<HighlightClipExportResult> {
    return recordingAi.exportHighlightClip(this.aiHost(), request);
  }

  async exportAllHighlightClips(request: ExportAllHighlightsRequest): Promise<HighlightClipExportResult> {
    return recordingAi.exportAllHighlightClips(this.aiHost(), request);
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
    const retryPromise = exportRenderer.beginRetryPostProcessing(this.exportHost(), result);
    this.retryPromise = retryPromise;
    try {
      return await retryPromise;
    } finally {
      if (this.retryPromise === retryPromise) {
        this.retryPromise = undefined;
      }
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
}
