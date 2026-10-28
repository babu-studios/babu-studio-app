import os from "node:os";
import { dirname, join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import type {
  PostProcessingState,
  RecordingExport,
  RecordingMode,
  RecordingResult,
  RecordingScene,
} from "@shared/types/media";
import {
  DEFAULT_EXPORT_RESOLUTION,
  DEFAULT_NOISE_REDUCTION,
  EXPORT_RESOLUTIONS,
  isNoiseReductionLevel,
  MAX_AUDIO_GAIN,
} from "@shared/constants/media.constants";
import type { NoiseReductionLevel } from "@shared/constants/media.constants";
import { powerGuard } from "../power-guard.service";
import { evenDimension, finite, getSourceDimensions } from "./device-match";
import {
  MASTER_FILE,
  projectSources,
  resultSourceFiles,
  type ProjectMetadata,
} from "./project-store";

export type FfmpegScope = "export" | "ai-preview" | "ai-shot" | "ai-short-clip";

export interface RenderLayoutOptions {
  previewQuality?: boolean;
  forcedCanvas?: { width: number; height: number };
  scope?: FfmpegScope;
  clipRange?: { startSeconds: number; lengthSeconds: number };
}

// Noise reduction for the microphone track. The high-pass filter drops rumble and the
// FFT denoiser removes hiss while leaving the voice band largely untouched.
const NOISE_REDUCTION_FILTERS: Record<NoiseReductionLevel, string> = {
  OFF: "",
  LOW: "highpass=f=80,afftdn=nr=6:nf=-45",
  MEDIUM: "highpass=f=100,afftdn=nr=12:nf=-35",
  HIGH: "highpass=f=120,afftdn=nr=18:nf=-30",
};

// Small vertical render for AI clip suggestions: same scene composition and
// audio mix as the vertical export, at a fraction of the size.
const AI_PREVIEW_WIDTH = 540;
const AI_PREVIEW_HEIGHT = 960;
const AI_PREVIEW_FPS = 30;

/** Live recording-service state needed to render one layout. Values are read
 * through closures so the facade keeps owning its private fields. */
export interface RenderHost {
  readonly projectDirectory?: string;
  isScopeCancelled(scope: FfmpegScope): boolean;
  runFfmpegTracked(args: string[], durationSeconds: number, onProgress: (progress: number) => void, scope?: FfmpegScope): Promise<void>;
}

/** Live recording-service state for the export pipeline (extends RenderHost). */
export interface PostProcessingHost extends RenderHost {
  getProjectMetadata(): ProjectMetadata | undefined;
  getSelectedExportModes(): RecordingMode[];
  getExportStates(): RecordingExport[];
  setExportStates(states: RecordingExport[]): void;
  getExportPaths(): Partial<Record<RecordingMode, string>>;
  setExportPaths(paths: Partial<Record<RecordingMode, string>>): void;
  getExportPath(): string | null;
  setExportPath(path: string | null): void;
  getActiveExportPath(): string | undefined;
  setActiveExportPath(path: string | undefined): void;
  isPostProcessingCancelled(): boolean;
  setPostProcessingCancelled(value: boolean): void;
  setPostProcessingPromise(promise: Promise<void> | undefined): void;
  getPostProcessingState(): PostProcessingState;
  setPostProcessingState(state: PostProcessingState): void;
  getPostProcessingError(): string | undefined;
  setPostProcessingError(error: string | undefined): void;
  saveProject(): Promise<void>;
  mergePostProcessing(result: RecordingResult): RecordingResult;
}

export async function startExport(ctx: PostProcessingHost, result: RecordingResult): Promise<RecordingResult> {
  const projectMetadata = ctx.getProjectMetadata();
  const projectDirectory = ctx.projectDirectory;
  if (!projectMetadata || !projectDirectory) {
    throw new Error("The recording project directory is unavailable.");
  }
  ctx.setPostProcessingState("PROCESSING");
  ctx.setPostProcessingError(undefined);
  projectMetadata.postProcessingStartedAt = new Date().toISOString();
  projectMetadata.postProcessingError = null;
  projectMetadata.postProcessingFailedAt = null;
  const exportPaths: Partial<Record<RecordingMode, string>> = {};
  const exportStates: RecordingExport[] = ctx.getSelectedExportModes().map((mode) => {
    const path = join(projectDirectory, "exports", mode === "HORIZONTAL" ? "horizontal.mp4" : "vertical.mp4");
    exportPaths[mode] = path;
    return { mode, path, state: "PENDING", progress: 0 };
  });
  ctx.setExportPaths(exportPaths);
  ctx.setExportStates(exportStates);
  ctx.setExportPath(exportPaths[result.recordingMode] ?? exportStates[0]?.path ?? null);
  projectMetadata.status = "SOURCE_FINALIZED";
  projectMetadata.postProcessingStatus = ctx.getPostProcessingState();
  projectMetadata.exportFiles = { ...exportPaths };
  projectMetadata.exports = exportStates;
  try {
    await mkdir(join(projectDirectory, "exports"), { recursive: true });
    await ctx.saveProject();
  } catch (error) {
    await handlePostProcessingFailure(ctx, new Error(`Unable to save project metadata before export: ${error instanceof Error ? error.message : String(error)}`));
    return ctx.mergePostProcessing(result);
  }

  launchPostProcessing(ctx, result);
  return ctx.mergePostProcessing(result);
}

async function beginRetryPostProcessing(ctx: PostProcessingHost, result: RecordingResult): Promise<RecordingResult> {
  const projectMetadata = ctx.getProjectMetadata();
  if (!projectMetadata) {
    throw new Error("The recording project metadata is unavailable.");
  }
  ctx.setPostProcessingState("PROCESSING");
  ctx.setPostProcessingError(undefined);
  ctx.setExportPath(ctx.getExportPaths()[result.recordingMode] ?? null);
  ctx.setExportStates(ctx.getExportStates().map((entry) => (
    entry.state === "COMPLETED"
      ? entry
      : { ...entry, state: "PENDING", progress: 0, error: undefined }
  )));
  projectMetadata.postProcessingStatus = ctx.getPostProcessingState();
  projectMetadata.status = "SOURCE_FINALIZED";
  projectMetadata.postProcessingError = null;
  projectMetadata.postProcessingFailedAt = null;
  projectMetadata.exports = ctx.getExportStates();
  projectMetadata.postProcessingStartedAt = new Date().toISOString();
  try {
    await ctx.saveProject();
  } catch (error) {
    await handlePostProcessingFailure(ctx, new Error(`Unable to save project metadata before retry: ${error instanceof Error ? error.message : String(error)}`));
    throw error;
  }
  launchPostProcessing(ctx, result);
  return ctx.mergePostProcessing(result);
}

export { beginRetryPostProcessing };

function launchPostProcessing(ctx: PostProcessingHost, result: RecordingResult): void {
  ctx.setPostProcessingCancelled(false);
  // Hold the guard from launch until every export (and failure handling) has finished.
  const releasePowerGuard = powerGuard.acquire();
  ctx.setPostProcessingPromise(postProcess(ctx, result)
    .catch((error: unknown) => handlePostProcessingFailure(ctx, error))
    .finally(releasePowerGuard));
}

async function handlePostProcessingFailure(ctx: PostProcessingHost, error: unknown): Promise<void> {
  ctx.setPostProcessingState("ERROR");
  ctx.setPostProcessingError(error instanceof Error ? error.message : String(error));
  const activeExport = ctx.getExportStates().find((entry) => entry.state === "PROCESSING");
  if (activeExport) {
    activeExport.state = "ERROR";
    activeExport.error = ctx.getPostProcessingError();
  }
  const projectMetadata = ctx.getProjectMetadata();
  if (projectMetadata) {
    projectMetadata.postProcessingStatus = ctx.getPostProcessingState();
    projectMetadata.status = "EXPORT_FAILED";
    projectMetadata.postProcessingError = ctx.getPostProcessingError();
    projectMetadata.postProcessingFailedAt = new Date().toISOString();
    projectMetadata.exports = ctx.getExportStates();
  }
  if (ctx.getActiveExportPath()) {
    await rm(ctx.getActiveExportPath() as string, { force: true }).catch((cleanupError: unknown) => {
      console.error("Unable to remove incomplete export:", cleanupError);
    });
    ctx.setActiveExportPath(undefined);
  }
  try {
    await ctx.saveProject();
  } catch (metadataError) {
    console.error("Unable to save post-processing failure to project metadata:", metadataError);
  }
  console.error("Recording post-processing failed:", error);
}

async function postProcess(ctx: PostProcessingHost, result: RecordingResult): Promise<void> {
  const project = ctx.getProjectMetadata();
  const scene = project?.scene as RecordingScene | undefined;
  if (!project || !scene || !ctx.projectDirectory) {
    throw new Error("The shared scene configuration was not saved with this recording.");
  }
  const failedExports: string[] = [];
  for (const exportEntry of ctx.getExportStates()) {
    if (exportEntry.state === "COMPLETED") {
      continue;
    }
    if (ctx.isPostProcessingCancelled()) {
      exportEntry.state = "ERROR";
      exportEntry.error = "Export cancelled";
      failedExports.push(`${exportEntry.mode}: ${exportEntry.error}`);
      continue;
    }
    exportEntry.state = "PROCESSING";
    exportEntry.error = undefined;
    exportEntry.progress = 0;
    ctx.setActiveExportPath(exportEntry.path);
    project.exports = ctx.getExportStates();
    await ctx.saveProject();
    try {
      await mkdir(dirname(exportEntry.path), { recursive: true });
      await renderLayout(
        ctx,
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
      ctx.setActiveExportPath(undefined);
    }
    project.exports = ctx.getExportStates();
    await ctx.saveProject();
  }

  ctx.setPostProcessingState(failedExports.length > 0 ? "ERROR" : "COMPLETED");
  ctx.setPostProcessingError(failedExports.length > 0 ? failedExports.join("; ") : undefined);
  project.postProcessingStatus = ctx.getPostProcessingState();
  const cancelled = ctx.isPostProcessingCancelled();
  project.status = cancelled
    ? "EXPORT_CANCELLED"
    : failedExports.length > 0 ? "EXPORT_FAILED" : "COMPLETED";
  project.postProcessingError = ctx.getPostProcessingError() ?? null;
  if (failedExports.length > 0) {
    project.postProcessingFailedAt = new Date().toISOString();
    project.postProcessingCompletedAt = null;
  } else {
    project.postProcessingFailedAt = null;
    project.postProcessingCompletedAt = new Date().toISOString();
  }
  await ctx.saveProject();
}

export async function renderLayout(
  ctx: RenderHost,
  result: RecordingResult,
  mode: RecordingMode,
  scene: RecordingScene,
  exportPath: string,
  project: ProjectMetadata,
  onProgress: (progress: number) => void,
  options?: RenderLayoutOptions,
): Promise<void> {
  const preview = options?.previewQuality === true;
  const ffmpegScope = options?.scope ?? (preview ? "ai-preview" : "export");
  const isCancelled = () => ctx.isScopeCancelled(ffmpegScope);
  // Highlight exports render only a time window of the take. A uniform
  // input seek on every source keeps the tracks aligned exactly as they
  // are in a full export; only the window changes.
  const clipStart = Math.max(0, options?.clipRange?.startSeconds ?? 0);
  const projectDirectory = ctx.projectDirectory;
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
    await ctx.runFfmpegTracked(args, durationSeconds, onProgress, ffmpegScope);
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
    await ctx.runFfmpegTracked(softwareArgs, durationSeconds, onProgress, ffmpegScope);
  }
}
