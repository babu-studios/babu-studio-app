import { createRequire } from "node:module";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const electronPackagePath = join(repositoryRoot, "apps/desktop/electron/package.json");
const electronBinary = createRequire(electronPackagePath)("electron");
const mainEntry = join(repositoryRoot, "apps/desktop/electron/out/main/index.js");
const mediaCore = join(repositoryRoot, "core/build/bin/creator-media-core");

function option(name, fallback) {
  const prefix = `--${name}=`;
  const equalForm = process.argv.find((argument) => argument.startsWith(prefix));
  if (equalForm) {
    return equalForm.slice(prefix.length);
  }
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const durationMs = Number(option("duration-ms", "60000"));
const exportOption = option("exports", "both").toLowerCase();
const keepOutput = process.argv.includes("--keep");
const exportModes = exportOption === "both"
  ? ["HORIZONTAL", "VERTICAL"]
  : exportOption === "horizontal"
    ? ["HORIZONTAL"]
    : exportOption === "vertical"
      ? ["VERTICAL"]
      : [];

function fail(message) {
  throw new Error(message);
}

function checkBinary(name, overrideEnv) {
  const binary = process.env[overrideEnv] || name;
  const check = spawnSync(binary, ["-version"], { encoding: "utf8" });
  if (check.error || check.status !== 0) {
    fail(`${name} is unavailable: ${check.error?.message ?? check.stderr.trim()}`);
  }
  return binary;
}

function probeMedia(ffprobe, filePath) {
  const probe = spawnSync(ffprobe, [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,width,height",
    "-of", "json",
    filePath,
  ], { encoding: "utf8" });
  if (probe.error) {
    throw probe.error;
  }
  if (probe.status !== 0) {
    fail(`ffprobe failed for ${filePath}: ${probe.stderr.trim() || "No diagnostic output."}`);
  }
  return JSON.parse(probe.stdout);
}

// Boot the built app headlessly and return the RESULT it prints.
async function runApp(extraEnv) {
  const [command, commandArgs] = process.platform === "darwin"
    ? ["caffeinate", ["-dimsu", electronBinary, mainEntry]]
    : [electronBinary, [mainEntry]];
  // A parent VS Code terminal exports ELECTRON_RUN_AS_NODE=1, which would make
  // Electron behave as plain Node. The child must run as real Electron.
  const childEnv = {
    ...process.env,
    BABU_STUDIO_MEDIA_CORE_PATH: mediaCore,
    BABU_STUDIO_SYNTHETIC_FLOW_TEST: "1",
    BABU_STUDIO_FLOW_TEST_EXPORTS: exportModes.join(","),
    ...extraEnv,
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(command, commandArgs, {
    cwd: repositoryRoot,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
    process.stderr.write(chunk);
  });
  const exited = once(child, "exit");
  const spawned = new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  await spawned;
  const [exitCode, signal] = await exited;
  const marker = output.match(/^\[recording-flow-test\] RESULT (.+)$/m);
  if (exitCode !== 0) {
    fail(`Recording flow test process exited with ${signal ? `signal ${signal}` : `code ${exitCode}`}.`);
  }
  if (!marker) {
    fail("Recording flow test did not return a result.");
  }
  return JSON.parse(marker[1]);
}

function assertDuration(actualSeconds, expectedMs, label) {
  if (!Number.isFinite(actualSeconds) || Math.abs(actualSeconds - expectedMs / 1000) > 3) {
    fail(`${label} duration mismatch: expected ~${(expectedMs / 1000).toFixed(2)}s, probed ${Number(actualSeconds).toFixed(2)}s.`);
  }
}

const EXPECTED_SOURCES = [
  { name: "Gameplay", kind: "video", file: "gameplay.mkv", width: 1920, height: 1080 },
  { name: "Webcam", kind: "video", file: "webcam.mkv", width: 1280, height: 720 },
  { name: "Game Audio", kind: "audio", file: "game-audio.m4a" },
  { name: "Microphone", kind: "audio", file: "microphone.m4a" },
];

async function verifySourceFiles(ffprobe, result, expectedDurationMs) {
  if (!Array.isArray(result.sourceFiles) || result.sourceFiles.length !== EXPECTED_SOURCES.length) {
    fail(`Expected ${EXPECTED_SOURCES.length} per-source files, received ${result.sourceFiles?.length ?? 0}.`);
  }
  const paths = {};
  for (const want of EXPECTED_SOURCES) {
    const entry = result.sourceFiles.find((candidate) => candidate.name === want.name);
    if (!entry || entry.kind !== want.kind) {
      fail(`The recording is missing the ${want.kind} source ${want.name}.`);
    }
    if (!entry.path.endsWith(`/${want.file}`)) {
      fail(`${want.name} should record to ${want.file}, reported ${entry.path}.`);
    }
    const fileStat = await stat(entry.path);
    if (fileStat.size === 0) {
      fail(`${want.name} source file is empty.`);
    }
    const info = probeMedia(ffprobe, entry.path);
    const streams = info.streams ?? [];
    if (want.kind === "video") {
      const video = streams.find((stream) => stream.codec_type === "video");
      if (!video || video.width !== want.width || video.height !== want.height) {
        fail(`${want.name} source should be ${want.width}x${want.height}, probed ${video?.width}x${video?.height}.`);
      }
    } else if (!streams.some((stream) => stream.codec_type === "audio")) {
      fail(`${want.name} source has no audio stream.`);
    }
    assertDuration(Number(info.format?.duration), expectedDurationMs, `${want.name} source`);
    console.log(`[recording-flow-test] Verified source ${want.name} (${want.file}, ${(fileStat.size / 1048576).toFixed(1)} MB).`);
    paths[want.name] = entry.path;
  }
  if (existsSync(join(dirname(paths["Gameplay"]), "master.babu"))) {
    fail("The recording wrote a legacy single master file alongside the per-source files.");
  }
  return paths;
}

async function verifyExports(ffprobe, result, expectedDurationMs) {
  if (result.exports?.length !== exportModes.length
    || result.exports.some((entry) => entry.state !== "COMPLETED")
    || result.exports.map((entry) => entry.mode).join(",") !== exportModes.join(",")) {
    fail("The generated export list does not match the selected layouts.");
  }
  for (const entry of result.exports) {
    const expectedSize = entry.mode === "HORIZONTAL" ? [1920, 1080] : [1080, 1920];
    const info = probeMedia(ffprobe, entry.path);
    const video = info.streams?.find((stream) => stream.codec_type === "video");
    const hasAudio = info.streams?.some((stream) => stream.codec_type === "audio");
    const duration = Number(info.format?.duration);
    if (!video
      || video.width !== expectedSize[0]
      || video.height !== expectedSize[1]
      || !hasAudio
      || !Number.isFinite(duration)
      || Math.abs(duration - expectedDurationMs / 1000) > 3) {
      fail(`${entry.mode} MP4 failed validation (dimensions, audio, or duration).`);
    }
    const exportStat = await stat(entry.path);
    if (exportStat.size === 0) {
      fail(`${entry.mode} MP4 is empty.`);
    }
    console.log(`[recording-flow-test] Verified ${entry.mode} ${video.width}x${video.height}, ${duration.toFixed(2)}s, audio present.`);
  }
}

// Phase 2: prove a take recorded before per-source files still exports.
// Mux the fresh per-source files back into one legacy master.babu with an
// old-style project.babu, then re-export it through the app.
async function buildLegacyFixture(ffmpeg, sourcePaths) {
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

async function writeLegacyProject(outputDirectory, fixtureDir, fixtureId, result) {
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

async function main() {
  if (!Number.isInteger(durationMs) || durationMs < 1_000 || durationMs > 3_600_000) {
    fail("--duration-ms must be between 1000 and 3600000.");
  }
  if (exportModes.length === 0) {
    fail("--exports must be both, horizontal, or vertical.");
  }
  if (!existsSync(mediaCore)) {
    fail(`Media core not found at ${mediaCore}. Build the core target before running this flow test.`);
  }
  if (!existsSync(mainEntry)) {
    fail("Electron main bundle is missing. Build the @babu-studios/electron workspace first.");
  }
  const ffprobe = checkBinary("ffprobe", "BABU_STUDIO_FFPROBE_PATH");
  const ffmpeg = checkBinary("ffmpeg", "BABU_STUDIO_FFMPEG_PATH");

  const outputDirectory = await mkdtemp(join(tmpdir(), "babu-studio-recording-flow-"));
  let succeeded = false;
  let fixtureDir = null;
  try {
    // Keep the Mac awake: sleeping pauses the media clock and truncates long recordings.
    const result = await runApp({ BABU_STUDIO_FLOW_TEST_OUTPUT_DIR: outputDirectory });
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

    await verifyExports(ffprobe, result, durationMs);

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
    const legacyResult = await runApp({
      BABU_STUDIO_FLOW_TEST_EXPORT_ID: built.fixtureId,
      BABU_STUDIO_FLOW_TEST_EXPORT_RESOLUTION: "1080p",
    });
    if (!legacyResult.success || legacyResult.postProcessingState !== "COMPLETED") {
      fail(`Legacy master.babu take did not export: ${legacyResult.error ?? "Unknown error"}`);
    }
    await verifyExports(ffprobe, legacyResult, durationMs);
    const legacyProject = JSON.parse(await readFile(join(fixtureDir, "project.babu"), "utf8"));
    if (legacyProject.exports.length !== exportModes.length
      || legacyProject.exports.some((entry) => entry.state !== "COMPLETED")) {
      fail("Legacy project metadata does not confirm completion of each selected export.");
    }
    console.log(`[recording-flow-test] PASSED phase 2: legacy master.babu take re-exported to ${legacyResult.exports.length} layout(s).`);

    const preview = await runApp({ BABU_STUDIO_FLOW_TEST_AI_PREVIEW_ID: built.fixtureId });
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
        await rm(fixtureDir, { recursive: true, force: true });
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
