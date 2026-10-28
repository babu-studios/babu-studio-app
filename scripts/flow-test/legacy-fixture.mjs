import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { fail } from "./cli.mjs";

// Phase 2: prove a take recorded before per-source files still exports.
// Mux the fresh per-source files back into one legacy master.babu with an
// old-style project.babu, then re-export it through the app.
export async function buildLegacyFixture(ffmpeg, sourcePaths) {
  const fixtureId = `recording-legacy-compat-${Date.now()}`;
  const libraryDir = join(homedir(), process.platform === "darwin" ? "Movies" : "Videos", "Babu Studio");
  const fixtureDir = join(libraryDir, fixtureId);
  await mkdir(fixtureDir, { recursive: true });
  const mux = spawnSync(ffmpeg, [
    "-y",
    "-i", sourcePaths["Gameplay"],
    "-i", sourcePaths["Webcam"],
    "-i", sourcePaths["Game Audio"],
    "-i", sourcePaths["Microphone"],
    "-map", "0:v:0", "-map", "1:v:0", "-map", "2:a:0", "-map", "3:a:0",
    "-c", "copy",
    "-f", "matroska",
    join(fixtureDir, "master.babu"),
  ], { encoding: "utf8" });
  if (mux.error || mux.status !== 0) {
    fail(`Could not mux the legacy master.babu fixture: ${mux.error?.message ?? mux.stderr.trim()}`);
  }
  return { fixtureId, fixtureDir };
}

export async function writeLegacyProject(outputDirectory, fixtureDir, fixtureId, result) {
  const current = JSON.parse(await readFile(join(outputDirectory, "project.babu"), "utf8"));
  const legacyResult = { ...result };
  delete legacyResult.sourceFiles;
  legacyResult.filePath = join(fixtureDir, "master.babu");
  legacyResult.postProcessingState = "NOT_STARTED";
  legacyResult.exportPath = null;
  legacyResult.exportPaths = {};
  legacyResult.exports = [];
  const legacyProject = {
    ...current,
    recordingId: fixtureId,
    createdAt: new Date().toISOString(),
    status: "SOURCE_FINALIZED",
    sources: {
      master: "master.babu",
      videoTracks: result.videoTracks,
      audioTracks: result.audioTracks,
      timestamps: current.sources?.timestamps ?? {
        clock: "CoreMedia host clock, relative to recorder start",
        sourceOffsetsMs: {},
      },
    },
    recordingResult: legacyResult,
    postProcessingStatus: "NOT_STARTED",
    exportFiles: {},
    exports: [],
  };
  await writeFile(join(fixtureDir, "project.babu"), JSON.stringify(legacyProject, null, 2));
}
