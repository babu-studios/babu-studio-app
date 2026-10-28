import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fail, getCliConfig } from "./flow-test/cli.mjs";
import { runApp } from "./flow-test/run-app.mjs";
import { EXPECTED_SOURCES, assertDuration, checkBinary, probeMedia, verifyExports, verifySourceFiles } from "./flow-test/verify.mjs";
import { buildLegacyFixture, writeLegacyProject } from "./flow-test/legacy-fixture.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const electronPackagePath = join(repositoryRoot, "apps/desktop/electron/package.json");
const electronBinary = createRequire(electronPackagePath)("electron");
const mainEntry = join(repositoryRoot, "apps/desktop/electron/out/main/index.js");
const mediaCore = join(repositoryRoot, "core/build/bin/creator-media-core");

async function main() {
  const { durationMs, exportModes, keepOutput } = getCliConfig();
  if (!existsSync(mediaCore)) {
    fail(`Media core not found at ${mediaCore}. Build the core target before running this flow test.`);
  }
  if (!existsSync(mainEntry)) {
    fail("Electron main bundle is missing. Build the @babu-studios/electron workspace first.");
  }
  const ffprobe = checkBinary("ffprobe", "BABU_STUDIO_FFPROBE_PATH");
  const ffmpeg = checkBinary("ffmpeg", "BABU_STUDIO_FFMPEG_PATH");
  const appContext = { electronBinary, mainEntry, repositoryRoot, mediaCore, exportModes };

  const outputDirectory = await mkdtemp(join(tmpdir(), "babu-studio-recording-flow-"));
  let succeeded = false;
  let fixtureDir = null;
  try {
    // Keep the Mac awake: sleeping pauses the media clock and truncates long recordings.
    const result = await runApp(appContext, { BABU_STUDIO_FLOW_TEST_OUTPUT_DIR: outputDirectory });
    if (!result.success || result.postProcessingState !== "COMPLETED") {
      fail(`Recording or export did not complete successfully: ${result.error ?? "Unknown error"}`);
    }
    if (result.durationMs < durationMs * 0.95) {
      fail(`Recording was too short: expected at least ${durationMs}ms, received ${result.durationMs}ms.`);
    }
    for (const track of ["Gameplay", "Webcam"]) {
      if (!result.videoTracks.includes(track)) {
        fail(`The master recording is missing the ${track} track.`);
      }
    }
    for (const track of ["Game Audio", "Microphone"]) {
      if (!result.audioTracks.includes(track)) {
        fail(`The master recording is missing the ${track} track.`);
      }
    }
    const syntheticVideoStats = [];
    for (const [name, expectedFps] of [["Gameplay", 60], ["Webcam", 30]]) {
      const track = result.trackStats?.find((candidate) => candidate.name === name);
      if (!track || track.frames <= 0 || track.actualFps <= 0) {
        fail(`${name} did not produce video frames.`);
      }
      syntheticVideoStats.push({ name, expectedFps, actualFps: track.actualFps });
    }

    const sourcePaths = await verifySourceFiles(ffprobe, result, durationMs);
    const totalSourceBytes = (await Promise.all(
      Object.values(sourcePaths).map(async (path) => (await stat(path)).size),
    )).reduce((sum, size) => sum + size, 0);
    if (result.fileSizeBytes !== totalSourceBytes) {
      fail(`Reported size ${result.fileSizeBytes} does not match the per-source files (${totalSourceBytes}).`);
    }

    const project = JSON.parse(await readFile(join(outputDirectory, "project.babu"), "utf8"));
    if (project.exportModes?.join(",") !== exportModes.join(",")
      || project.exports.length !== exportModes.length
      || project.exports.some((entry) => entry.state !== "COMPLETED")) {
      fail("Project metadata does not confirm completion of each selected export.");
    }
    for (const want of EXPECTED_SOURCES) {
      if (!project.sources?.files?.some((entry) => entry.name === want.name && entry.file === want.file)) {
        fail(`Project metadata does not list the ${want.name} source file.`);
      }
    }

    await verifyExports(ffprobe, result, durationMs, exportModes);

    console.log(`[recording-flow-test] PASSED phase 1: ${Math.round(result.durationMs / 1000)}s recorded to per-source files; ${result.exports.length} selected export(s) verified.`);
    console.log(`[recording-flow-test] Sources size: ${(totalSourceBytes / 1048576).toFixed(1)} MB; dropped video frames: ${result.droppedVideoFrames}; dropped audio frames: ${result.droppedAudioFrames}.`);
    for (const track of syntheticVideoStats) {
      console.log(`[recording-flow-test] ${track.name}: ${track.actualFps.toFixed(1)}fps observed; ${track.expectedFps}fps configured.`);
    }
    if (syntheticVideoStats.some((track) => track.actualFps < track.expectedFps * 0.75)) {
      console.warn("[recording-flow-test] Synthetic software encoding ran below the configured frame rate; this is a flow test, not a hardware capture performance benchmark.");
    }

    const built = await buildLegacyFixture(ffmpeg, sourcePaths);
    fixtureDir = built.fixtureDir;
    await writeLegacyProject(outputDirectory, fixtureDir, built.fixtureId, result);
    const legacyResult = await runApp(appContext, {
      BABU_STUDIO_FLOW_TEST_EXPORT_ID: built.fixtureId,
      BABU_STUDIO_FLOW_TEST_EXPORT_RESOLUTION: "1080p",
    });
    if (!legacyResult.success || legacyResult.postProcessingState !== "COMPLETED") {
      fail(`Legacy master.babu take did not export: ${legacyResult.error ?? "Unknown error"}`);
    }
    await verifyExports(ffprobe, legacyResult, durationMs, exportModes);
    const legacyProject = JSON.parse(await readFile(join(fixtureDir, "project.babu"), "utf8"));
    if (legacyProject.exports.length !== exportModes.length
      || legacyProject.exports.some((entry) => entry.state !== "COMPLETED")) {
      fail("Legacy project metadata does not confirm completion of each selected export.");
    }
    console.log(`[recording-flow-test] PASSED phase 2: legacy master.babu take re-exported to ${legacyResult.exports.length} layout(s).`);

    const preview = await runApp(appContext, { BABU_STUDIO_FLOW_TEST_AI_PREVIEW_ID: built.fixtureId });
    if (!preview.success || !preview.path?.endsWith("/ai-preview.mp4")) {
      fail(`AI preview did not render: ${preview.error ?? "Unknown error"}`);
    }
    const previewStat = await stat(preview.path);
    const previewInfo = probeMedia(ffprobe, preview.path);
    const previewVideo = previewInfo.streams?.find((stream) => stream.codec_type === "video");
    const previewHasAudio = previewInfo.streams?.some((stream) => stream.codec_type === "audio");
    if (!previewVideo || previewVideo.width !== 540 || previewVideo.height !== 960 || !previewHasAudio) {
      fail(`AI preview should be 540x960 vertical with audio, probed ${previewVideo?.width}x${previewVideo?.height}.`);
    }
    assertDuration(Number(previewInfo.format?.duration), durationMs, "AI preview");
    const exportBytes = await Promise.all(legacyResult.exports.map(async (entry) => (await stat(entry.path)).size));
    const smallestExportBytes = Math.min(...exportBytes);
    if (!(previewStat.size > 0) || previewStat.size >= smallestExportBytes) {
      fail(`AI preview (${previewStat.size} bytes) should be smaller than the layout exports (${smallestExportBytes} bytes).`);
    }
    console.log(`[recording-flow-test] PASSED phase 3: AI preview 540x960 verified (${(previewStat.size / 1048576).toFixed(1)} MB vs ${(smallestExportBytes / 1048576).toFixed(1)} MB smallest layout export).`);

    succeeded = true;
    console.log(`[recording-flow-test] PASSED: per-source recording, legacy export, and AI preview verified.`);
    if (keepOutput) {
      console.log(`[recording-flow-test] Outputs retained at ${outputDirectory} and ${fixtureDir}`);
    }
  } finally {
    if (succeeded && !keepOutput) {
      await rm(outputDirectory, { recursive: true, force: true });
      if (fixtureDir) {
        await rm(fixtureDir, { force: true, recursive: true });
      }
    } else if (!succeeded) {
      console.log(`[recording-flow-test] Outputs retained at ${outputDirectory}${fixtureDir ? ` and ${fixtureDir}` : ""}`);
    }
  }
}

main().catch((error) => {
  console.error(`[recording-flow-test] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
