import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AiArtifactsRequest,
  AiArtifactsResult,
  AiHighlightSuggestion,
  AiPreviewResult,
  AiPreviewStatus,
  AiHighlightsStatus,
  ExportAiPreviewRequest,
  ExportAllHighlightsRequest,
  ExportHighlightClipRequest,
  FindHighlightsRequest,
  FindHighlightsResult,
  HighlightClipExportResult,
  RecordingMode,
  RecordingResult,
  RecordingScene,
} from "@shared/types/media";
import {
  HIGHLIGHTS_MODEL_ID,
  highlightFileName,
  parseHighlightSuggestions,
  type HighlightsProvider,
} from "../ai-highlights.provider";
import type { RenderLayoutOptions } from "./export-renderer";
import {
  assertSourcesExist,
  PROJECT_FILE,
  projectSources,
  RECORDING_ID_PATTERN,
  type ProjectMetadata,
} from "./project-store";

export type AiScope = "ai-preview" | "ai-shot" | "ai-short-clip";

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

const AI_PREVIEW_FILE = "ai-preview.mp4";

// Deterministic short-clip window: up to AI_SHORT_CLIP_SECONDS taken from the
// middle of the take so short takes still produce a whole-take clip.
function aiShortClipWindow(durationMs: number): { startSeconds: number; lengthSeconds: number } {
  const totalSeconds = Math.max(0.1, durationMs / 1000);
  const lengthSeconds = Math.min(AI_SHORT_CLIP_SECONDS, totalSeconds);
  const startSeconds = Math.max(0, (totalSeconds - lengthSeconds) / 2);
  return { startSeconds, lengthSeconds };
}

/** Live recording-service state for the AI tasks. All access goes through
 * closures so the facade keeps owning its private fields; only `import type`
 * facade types are referenced, never values. */
export interface AiServiceHost {
  isRecordingActive(): boolean;
  hasPendingStart(): boolean;
  isExportProcessing(): boolean;
  hasPendingRetry(): boolean;
  tryBeginHighlightExport(): boolean;
  endHighlightExport(): void;
  assertNoHighlightExport(action: string): void;
  getAiScopeState(scope: AiScope): AiPreviewStatus;
  setAiScopeState(scope: AiScope, state: AiPreviewStatus): void;
  isAiScopeCancelled(scope: AiScope): boolean;
  setAiScopeCancelled(scope: AiScope, value: boolean): void;
  getAiHighlightsState(): AiHighlightsStatus;
  setAiHighlightsState(state: AiHighlightsStatus): void;
  setAiHighlightsRecordingId(id: string): void;
  createHighlightsAbort(): AbortController;
  clearHighlightsAbort(abort: AbortController): void;
  getHighlightsProvider(): HighlightsProvider;
  getRecordingsRoot(): string;
  setProjectContext(directory: string, project: ProjectMetadata, source: RecordingResult): void;
  renderLayout(
    result: RecordingResult,
    mode: RecordingMode,
    scene: RecordingScene,
    exportPath: string,
    project: ProjectMetadata,
    onProgress: (progress: number) => void,
    options?: RenderLayoutOptions,
  ): Promise<void>;
  runAiShortClipFfmpeg(args: string[], durationSeconds: number, onProgress: (progress: number) => void): Promise<void>;
}

// Render a small vertical preview of a saved take for AI clip suggestions.
// It mirrors the vertical scene at low quality and never touches the
// regular layout export state.
export async function exportAiPreview(ctx: AiServiceHost, request: ExportAiPreviewRequest): Promise<AiPreviewResult> {
  if (ctx.isRecordingActive() || ctx.hasPendingStart()) {
    throw new Error("Stop the current recording before rendering the AI preview.");
  }
  if (ctx.isExportProcessing() || ctx.hasPendingRetry()) {
    throw new Error("Wait for the selected layout exports to finish before rendering the AI preview.");
  }
  if (ctx.getAiScopeState("ai-preview").state === "PROCESSING") {
    throw new Error("The AI preview is already rendering.");
  }
  if (ctx.getAiScopeState("ai-shot").state === "PROCESSING" || ctx.getAiScopeState("ai-short-clip").state === "PROCESSING") {
    throw new Error("Wait for the AI shot-clip task to finish before rendering the AI preview.");
  }
  ctx.assertNoHighlightExport("rendering the AI preview.");
  if (typeof request?.id !== "string" || !RECORDING_ID_PATTERN.test(request.id)) {
    throw new Error("Select a valid recording for the AI preview.");
  }
  const directory = join(ctx.getRecordingsRoot(), request.id);
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
  ctx.setProjectContext(directory, project, source);
  const previewPath = join(directory, "exports", AI_PREVIEW_FILE);
  ctx.setAiScopeCancelled("ai-preview", false);
  ctx.setAiScopeState("ai-preview", { state: "PROCESSING", progress: 0, path: previewPath });
  try {
    await mkdir(join(directory, "exports"), { recursive: true });
    await ctx.renderLayout(
      source,
      "VERTICAL",
      scene,
      previewPath,
      project,
      (progress) => {
        ctx.setAiScopeState("ai-preview", { ...ctx.getAiScopeState("ai-preview"), progress });
      },
      { previewQuality: true },
    );
    if (ctx.isAiScopeCancelled("ai-preview")) {
      throw new Error("AI preview cancelled");
    }
    ctx.setAiScopeState("ai-preview", { state: "COMPLETED", progress: 100, path: previewPath });
    return { success: true, path: previewPath, error: null };
  } catch (error) {
    await rm(previewPath, { force: true }).catch((cleanupError: unknown) => {
      console.error("Unable to remove incomplete AI preview:", cleanupError);
    });
    const message = error instanceof Error ? error.message : String(error);
    ctx.setAiScopeState("ai-preview", { state: "ERROR", progress: 0, path: null, error: message });
    return { success: false, path: null, error: message };
  }
}

// Step 1 of the AI shot clip: a forced-360p vertical render of a saved take,
// regardless of the export-quality dropdown. Never touches the regular
// layout export state.
export async function exportAiShotClip(ctx: AiServiceHost, request: ExportAiPreviewRequest): Promise<AiPreviewResult> {
  if (ctx.isRecordingActive() || ctx.hasPendingStart()) {
    throw new Error("Stop the current recording before exporting the AI 360p file.");
  }
  if (ctx.isExportProcessing() || ctx.hasPendingRetry()) {
    throw new Error("Wait for the selected layout exports to finish before exporting the AI 360p file.");
  }
  if (ctx.getAiScopeState("ai-preview").state === "PROCESSING") {
    throw new Error("Wait for the AI preview to finish before exporting the AI 360p file.");
  }
  if (ctx.getAiScopeState("ai-shot").state === "PROCESSING") {
    throw new Error("The AI 360p export is already running.");
  }
  if (ctx.getAiScopeState("ai-short-clip").state === "PROCESSING") {
    throw new Error("Wait for the AI short clip to finish before exporting the AI 360p file.");
  }
  ctx.assertNoHighlightExport("exporting the AI 360p file.");
  if (typeof request?.id !== "string" || !RECORDING_ID_PATTERN.test(request.id)) {
    throw new Error("Select a valid recording for the AI 360p export.");
  }
  const directory = join(ctx.getRecordingsRoot(), request.id);
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
  ctx.setProjectContext(directory, project, source);
  const shotPath = join(directory, "exports", AI_SHOT_360P_FILE);
  ctx.setAiScopeCancelled("ai-shot", false);
  ctx.setAiScopeState("ai-shot", { state: "PROCESSING", progress: 0, path: shotPath });
  try {
    await mkdir(join(directory, "exports"), { recursive: true });
    await ctx.renderLayout(
      source,
      "VERTICAL",
      scene,
      shotPath,
      project,
      (progress) => {
        ctx.setAiScopeState("ai-shot", { ...ctx.getAiScopeState("ai-shot"), progress });
      },
      {
        previewQuality: true,
        forcedCanvas: { width: AI_SHOT_WIDTH, height: AI_SHOT_HEIGHT },
        scope: "ai-shot",
      },
    );
    if (ctx.isAiScopeCancelled("ai-shot")) {
      throw new Error("AI 360p export cancelled");
    }
    ctx.setAiScopeState("ai-shot", { state: "COMPLETED", progress: 100, path: shotPath });
    return { success: true, path: shotPath, error: null };
  } catch (error) {
    await rm(shotPath, { force: true }).catch((cleanupError: unknown) => {
      console.error("Unable to remove incomplete AI 360p export:", cleanupError);
    });
    const message = ctx.isAiScopeCancelled("ai-shot") ? "AI 360p export cancelled" : error instanceof Error ? error.message : String(error);
    ctx.setAiScopeState("ai-shot", { state: "ERROR", progress: 0, path: null, error: message });
    return { success: false, path: null, error: message };
  }
}

// Step 2 of the AI shot clip: cut a short clip from the take's AI 360p file.
// Requires step 1 so there is always a 360p source to cut from.
export async function generateAiShortClip(ctx: AiServiceHost, request: ExportAiPreviewRequest): Promise<AiPreviewResult> {
  if (ctx.isRecordingActive() || ctx.hasPendingStart()) {
    throw new Error("Stop the current recording before generating the AI short clip.");
  }
  if (ctx.isExportProcessing() || ctx.hasPendingRetry()) {
    throw new Error("Wait for the selected layout exports to finish before generating the AI short clip.");
  }
  if (ctx.getAiScopeState("ai-preview").state === "PROCESSING") {
    throw new Error("Wait for the AI preview to finish before generating the AI short clip.");
  }
  if (ctx.getAiScopeState("ai-shot").state === "PROCESSING") {
    throw new Error("Wait for the AI 360p export to finish before generating the AI short clip.");
  }
  if (ctx.getAiScopeState("ai-short-clip").state === "PROCESSING") {
    throw new Error("The AI short clip is already generating.");
  }
  ctx.assertNoHighlightExport("generating the AI short clip.");
  if (typeof request?.id !== "string" || !RECORDING_ID_PATTERN.test(request.id)) {
    throw new Error("Select a valid recording for the AI short clip.");
  }
  const directory = join(ctx.getRecordingsRoot(), request.id);
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
  ctx.setAiScopeCancelled("ai-short-clip", false);
  ctx.setAiScopeState("ai-short-clip", { state: "PROCESSING", progress: 0, path: clipPath });
  const onProgress = (progress: number): void => {
    ctx.setAiScopeState("ai-short-clip", { ...ctx.getAiScopeState("ai-short-clip"), progress });
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
      await ctx.runAiShortClipFfmpeg(
        buildArgs("h264_videotoolbox", ["-allow_sw", "1", "-b:v", "1.5M", "-profile:v", "high"]),
        lengthSeconds,
        onProgress,
      );
    } catch {
      await rm(clipPath, { force: true });
      if (ctx.isAiScopeCancelled("ai-short-clip")) {
        throw new Error("AI short clip cancelled");
      }
      onProgress(0);
      await ctx.runAiShortClipFfmpeg(
        buildArgs("libx264", ["-preset", "veryfast", "-crf", "28"]),
        lengthSeconds,
        onProgress,
      );
    }
    if (ctx.isAiScopeCancelled("ai-short-clip")) {
      throw new Error("AI short clip cancelled");
    }
    ctx.setAiScopeState("ai-short-clip", { state: "COMPLETED", progress: 100, path: clipPath });
    return { success: true, path: clipPath, error: null };
  } catch (error) {
    await rm(clipPath, { force: true }).catch((cleanupError: unknown) => {
      console.error("Unable to remove incomplete AI short clip:", cleanupError);
    });
    const message = ctx.isAiScopeCancelled("ai-short-clip") ? "AI short clip cancelled" : error instanceof Error ? error.message : String(error);
    ctx.setAiScopeState("ai-short-clip", { state: "ERROR", progress: 0, path: null, error: message });
    return { success: false, path: null, error: message };
  }
}

async function listShotFiles(directory: string): Promise<string[]> {
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
async function resolveAiSourceFile(directory: string, requested?: unknown): Promise<{ file: string; path: string }> {
  const available = await listShotFiles(directory);
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
export async function getAiArtifacts(ctx: AiServiceHost, request: AiArtifactsRequest): Promise<AiArtifactsResult> {
  if (typeof request?.id !== "string" || !RECORDING_ID_PATTERN.test(request.id)) {
    throw new Error("Select a valid recording.");
  }
  const directory = join(ctx.getRecordingsRoot(), request.id);
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
  const shotFiles = await listShotFiles(directory);
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

// Find highlight moments in the take's ai-360p.mp4 via the Meta
// video-analysis provider. Progress stays honest: stage labels while the
// model call is opaque (indeterminate, progress null); 100 only on success.
export async function findHighlights(ctx: AiServiceHost, request: FindHighlightsRequest): Promise<FindHighlightsResult> {
  if (ctx.isRecordingActive() || ctx.hasPendingStart()) {
    throw new Error("Stop the current recording before finding highlights.");
  }
  if (ctx.isExportProcessing() || ctx.hasPendingRetry()) {
    throw new Error("Wait for the selected layout exports to finish before finding highlights.");
  }
  if (ctx.getAiScopeState("ai-shot").state === "PROCESSING"
    || ctx.getAiScopeState("ai-short-clip").state === "PROCESSING"
    || ctx.getAiScopeState("ai-preview").state === "PROCESSING") {
    throw new Error("Wait for the running AI task to finish before finding highlights.");
  }
  ctx.assertNoHighlightExport("finding highlights.");
  if (ctx.getAiHighlightsState().state === "ANALYZING") {
    throw new Error("Highlight analysis is already running.");
  }
  if (typeof request?.id !== "string" || !RECORDING_ID_PATTERN.test(request.id)) {
    throw new Error("Select a valid recording to find highlights.");
  }
  const directory = join(ctx.getRecordingsRoot(), request.id);
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
  const aiSource = await resolveAiSourceFile(directory, request.sourceFile);
  const shotPath = aiSource.path;
  ctx.setProjectContext(directory, project, source);
  ctx.setAiHighlightsRecordingId(request.id);
  const abort = ctx.createHighlightsAbort();
  ctx.setAiHighlightsState({
    state: "ANALYZING",
    stage: "Measuring clip…",
    progress: null,
    clips: [],
    model: HIGHLIGHTS_MODEL_ID,
    analyzedAt: null,
  });
  try {
    const durationSeconds = await measureVideoDuration(shotPath, source.durationMs);
    if (abort.signal.aborted) {
      throw new Error("Highlight analysis cancelled");
    }
    ctx.setAiHighlightsState({ ...ctx.getAiHighlightsState(), stage: "Uploading clip for analysis…" });
    const raw = await ctx.getHighlightsProvider().analyzeVideo(shotPath, durationSeconds, abort.signal);
    if (abort.signal.aborted) {
      throw new Error("Highlight analysis cancelled");
    }
    ctx.setAiHighlightsState({ ...ctx.getAiHighlightsState(), stage: "Reading suggestions…" });
    const clips = parseHighlightSuggestions(raw, durationSeconds, HIGHLIGHTS_MODEL_ID);
    if (clips.length === 0) {
      throw new Error("The model returned no usable highlight moments. Try again.");
    }
    const analyzedAt = new Date().toISOString();
    ctx.setAiHighlightsState({
      state: "COMPLETED",
      stage: null,
      progress: 100,
      clips,
      model: HIGHLIGHTS_MODEL_ID,
      analyzedAt,
    });
    await writeHighlightsSidecar(directory, durationSeconds, clips, analyzedAt, aiSource.file);
    return { success: true, clips, model: HIGHLIGHTS_MODEL_ID, analyzedAt, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cancelled = abort.signal.aborted || message === "Highlight analysis cancelled";
    ctx.setAiHighlightsState({
      state: cancelled ? "IDLE" : "ERROR",
      stage: null,
      progress: null,
      clips: [],
      model: HIGHLIGHTS_MODEL_ID,
      analyzedAt: null,
      ...(cancelled ? {} : { error: message }),
    });
    if (cancelled) {
      throw new Error("Highlight analysis cancelled");
    }
    return { success: false, clips: [], model: HIGHLIGHTS_MODEL_ID, analyzedAt: null, error: message };
  } finally {
    ctx.clearHighlightsAbort(abort);
  }
}

// Cut one persisted suggestion from the ORIGINAL recording sources with the
// full scene composition. Never modifies the take's original recording.
export async function exportHighlightClip(ctx: AiServiceHost, request: ExportHighlightClipRequest): Promise<HighlightClipExportResult> {
  if (ctx.isRecordingActive() || ctx.hasPendingStart()) {
    throw new Error("Stop the current recording before exporting highlights.");
  }
  if (ctx.isExportProcessing() || ctx.hasPendingRetry()) {
    throw new Error("Wait for the selected layout exports to finish before exporting highlights.");
  }
  if (ctx.getAiHighlightsState().state === "ANALYZING") {
    throw new Error("Wait for highlight analysis to finish before exporting.");
  }
  if (!ctx.tryBeginHighlightExport()) {
    throw new Error("A highlight export is already running.");
  }
  try {
    const clips = await loadHighlightClips(ctx, request?.id);
    const index = request?.index;
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= clips.clips.length) {
      throw new Error("Select a valid highlight suggestion to export.");
    }
    const clip = clampClipToDuration(
      {
        ...clips.clips[index as number],
        ...(typeof request?.startTime === "number" ? { startTime: request.startTime } : {}),
        ...(typeof request?.endTime === "number" ? { endTime: request.endTime } : {}),
      },
      clips.durationSeconds,
    );
    const path = await cutHighlightClip(ctx, clips, clip, index as number);
    await markHighlightExported(clips.directory, index as number, path);
    return { success: true, paths: [path], error: null };
  } finally {
    ctx.endHighlightExport();
  }
}

// Cut every persisted suggestion (or the validated edited list) from the
// ORIGINAL recording sources. Never modifies the take's original recording.
export async function exportAllHighlightClips(ctx: AiServiceHost, request: ExportAllHighlightsRequest): Promise<HighlightClipExportResult> {
  if (ctx.isRecordingActive() || ctx.hasPendingStart()) {
    throw new Error("Stop the current recording before exporting highlights.");
  }
  if (ctx.isExportProcessing() || ctx.hasPendingRetry()) {
    throw new Error("Wait for the selected layout exports to finish before exporting highlights.");
  }
  if (ctx.getAiHighlightsState().state === "ANALYZING") {
    throw new Error("Wait for highlight analysis to finish before exporting.");
  }
  if (!ctx.tryBeginHighlightExport()) {
    throw new Error("A highlight export is already running.");
  }
  try {
    const loaded = await loadHighlightClips(ctx, request?.id);
    const edited = Array.isArray(request?.clips) && request.clips.length > 0 ? request.clips : loaded.clips;
    const durationSeconds = loaded.durationSeconds;
    const paths: string[] = [];
    for (let index = 0; index < edited.length; index += 1) {
      const clip = clampClipToDuration(edited[index], durationSeconds);
      const path = await cutHighlightClip(ctx, loaded, clip, index);
      paths.push(path);
      await markHighlightExported(loaded.directory, index, path);
    }
    if (paths.length === 0) {
      throw new Error("There are no highlight suggestions to export.");
    }
    return { success: true, paths, error: null };
  } finally {
    ctx.endHighlightExport();
  }
}

function clampClipToDuration(clip: AiHighlightSuggestion, durationSeconds: number): AiHighlightSuggestion {
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
async function cutHighlightClip(
  ctx: AiServiceHost,
  loaded: { directory: string; project: ProjectMetadata; source: RecordingResult; scene: RecordingScene },
  clip: AiHighlightSuggestion,
  index: number,
): Promise<string> {
  const fileName = highlightFileName(index, clip.category);
  const outputPath = join(loaded.directory, "exports", fileName);
  const startSeconds = Math.max(0, clip.startTime);
  const lengthSeconds = Math.max(0.5, clip.endTime - clip.startTime);
  try {
    await ctx.renderLayout(loaded.source, "VERTICAL", loaded.scene, outputPath, loaded.project, () => {}, {
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
async function measureVideoDuration(videoPath: string, fallbackDurationMs: number): Promise<number> {
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

async function writeHighlightsSidecar(
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

async function loadHighlightClips(ctx: AiServiceHost, id: string): Promise<{ directory: string; clips: AiHighlightSuggestion[]; durationSeconds: number; project: ProjectMetadata; source: RecordingResult; scene: RecordingScene }> {
  if (typeof id !== "string" || !RECORDING_ID_PATTERN.test(id)) {
    throw new Error("Select a valid recording for highlight export.");
  }
  const directory = join(ctx.getRecordingsRoot(), id);
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
  ctx.setProjectContext(directory, project, source);
  return { directory, clips, durationSeconds, project, source, scene };
}

async function markHighlightExported(directory: string, index: number, path: string): Promise<void> {
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
