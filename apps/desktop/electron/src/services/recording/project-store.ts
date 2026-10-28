import { app } from "electron";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  PostProcessingState,
  RecordingResult,
  RecordingSourceFile,
} from "@shared/types/media";

export const RECORDING_ID_PATTERN = /^recording-[0-9A-Za-z-]+$/;

// Custom extensions so the OS has no app to open these internal files.
export const MASTER_FILE = "master.babu";
export const PROJECT_FILE = "project.babu";

export type ProjectMetadata = Record<string, unknown> & {
  status: string;
  postProcessingStatus: PostProcessingState;
};

export type ProjectSourceFile = {
  name: string;
  kind: "video" | "audio";
  file: string;
};

export function isProjectSourceFile(value: unknown): value is ProjectSourceFile {
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
export function projectSources(project: ProjectMetadata, directory: string): RecordingSourceFile[] | null {
  const sources = project.sources as { files?: unknown } | undefined;
  if (!sources || !Array.isArray(sources.files)) {
    return null;
  }
  return sources.files
    .filter(isProjectSourceFile)
    .map((entry) => ({ name: entry.name, kind: entry.kind, path: join(directory, entry.file) }));
}

export function resultSourceFiles(result: RecordingResult): RecordingSourceFile[] | null {
  return Array.isArray(result.sourceFiles) && result.sourceFiles.length > 0 ? result.sourceFiles : null;
}

export async function assertSourcesExist(sources: RecordingSourceFile[] | null, directory: string): Promise<void> {
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

export function recordingsRoot(): string {
  return join(app.getPath("videos"), "Babu Studio");
}

export async function writeProjectFile(projectFile: string | undefined, projectMetadata: ProjectMetadata | undefined): Promise<void> {
  if (projectFile && projectMetadata) {
    await writeFile(projectFile, JSON.stringify(projectMetadata, null, 2));
  }
}
