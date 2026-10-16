import { createRequire } from "node:module";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
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

function probeMedia(filePath) {
  const ffprobe = process.env.BABU_STUDIO_FFPROBE_PATH || "ffprobe";
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
  const ffprobe = process.env.BABU_STUDIO_FFPROBE_PATH || "ffprobe";
  const ffprobeCheck = spawnSync(ffprobe, ["-version"], { encoding: "utf8" });
  if (ffprobeCheck.error || ffprobeCheck.status !== 0) {
    fail(`ffprobe is unavailable: ${ffprobeCheck.error?.message ?? ffprobeCheck.stderr.trim()}`);
  }

  const outputDirectory = await mkdtemp(join(tmpdir(), "babu-studio-recording-flow-"));
  let succeeded = false;
  try {
    const child = spawn(electronBinary, [mainEntry], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        BABU_STUDIO_MEDIA_CORE_PATH: mediaCore,
        BABU_STUDIO_SYNTHETIC_FLOW_TEST: "1",
        BABU_STUDIO_FLOW_TEST_DURATION_MS: String(durationMs),
        BABU_STUDIO_FLOW_TEST_EXPORTS: exportModes.join(","),
        BABU_STUDIO_FLOW_TEST_OUTPUT_DIR: outputDirectory,
      },
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
      fail(`Recording flow test process exited with ${signal ? `signal ${signal}` : `code ${exitCode}`}. Outputs retained at ${outputDirectory}`);
    }
    if (!marker) {
      fail(`Recording flow test did not return a result. Outputs retained at ${outputDirectory}`);
    }

    const result = JSON.parse(marker[1]);
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
    if (result.exports?.length !== exportModes.length
      || result.exports.some((entry) => entry.state !== "COMPLETED")
      || result.exports.map((entry) => entry.mode).join(",") !== exportModes.join(",")) {
      fail("The generated export list does not match the selected layouts.");
    }

    const masterInfo = probeMedia(result.filePath);
    const masterStat = await stat(result.filePath);
    if (masterStat.size === 0
      || Number(masterInfo.format?.duration) < durationMs / 1000 * 0.95) {
      fail("The finalized master recording is empty or shorter than expected.");
    }
    const project = JSON.parse(await readFile(join(outputDirectory, "project.json"), "utf8"));
    if (project.exportModes?.join(",") !== exportModes.join(",")
      || project.exports.length !== exportModes.length
      || project.exports.some((entry) => entry.state !== "COMPLETED")) {
      fail("Project metadata does not confirm completion of each selected export.");
    }

    for (const entry of result.exports) {
      const expectedSize = entry.mode === "HORIZONTAL" ? [1920, 1080] : [1080, 1920];
      const info = probeMedia(entry.path);
      const video = info.streams?.find((stream) => stream.codec_type === "video");
      const hasAudio = info.streams?.some((stream) => stream.codec_type === "audio");
      const duration = Number(info.format?.duration);
      if (!video
        || video.width !== expectedSize[0]
        || video.height !== expectedSize[1]
        || !hasAudio
        || !Number.isFinite(duration)
        || Math.abs(duration - durationMs / 1000) > 3) {
        fail(`${entry.mode} MP4 failed validation (dimensions, audio, or duration).`);
      }
      const exportStat = await stat(entry.path);
      if (exportStat.size === 0) {
        fail(`${entry.mode} MP4 is empty.`);
      }
      console.log(`[recording-flow-test] Verified ${entry.mode} ${video.width}x${video.height}, ${duration.toFixed(2)}s, audio present.`);
    }

    succeeded = true;
    console.log(`[recording-flow-test] PASSED: ${Math.round(result.durationMs / 1000)}s recorded; ${result.exports.length} selected export(s) verified.`);
    console.log(`[recording-flow-test] Master size: ${(masterStat.size / 1048576).toFixed(1)} MB; dropped video frames: ${result.droppedVideoFrames}; dropped audio frames: ${result.droppedAudioFrames}.`);
    for (const track of syntheticVideoStats) {
      console.log(`[recording-flow-test] ${track.name}: ${track.actualFps.toFixed(1)}fps observed; ${track.expectedFps}fps configured.`);
    }
    if (syntheticVideoStats.some((track) => track.actualFps < track.expectedFps * 0.75)) {
      console.warn("[recording-flow-test] Synthetic software encoding ran below the configured frame rate; this is a flow test, not a hardware capture performance benchmark.");
    }
    if (keepOutput) {
      console.log(`[recording-flow-test] Outputs retained at ${outputDirectory}`);
    }
  } finally {
    if (succeeded && !keepOutput) {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(`[recording-flow-test] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
