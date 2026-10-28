import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fail } from "./cli.mjs";

export function checkBinary(name, overrideEnv) {
  const binary = process.env[overrideEnv] || name;
  const check = spawnSync(binary, ["-version"], { encoding: "utf8" });
  if (check.error || check.status !== 0) {
    fail(`${name} is unavailable: ${check.error?.message ?? check.stderr.trim()}`);
  }
  return binary;
}

export function probeMedia(ffprobe, filePath) {
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

export function assertDuration(actualSeconds, expectedMs, label) {
  if (!Number.isFinite(actualSeconds) || Math.abs(actualSeconds - expectedMs / 1000) > 3) {
    fail(`${label} duration mismatch: expected ~${(expectedMs / 1000).toFixed(2)}s, probed ${Number(actualSeconds).toFixed(2)}s.`);
  }
}

export const EXPECTED_SOURCES = [
  { name: "Gameplay", kind: "video", file: "gameplay.mkv", width: 1920, height: 1080 },
  { name: "Webcam", kind: "video", file: "webcam.mkv", width: 1280, height: 720 },
  { name: "Game Audio", kind: "audio", file: "game-audio.m4a" },
  { name: "Microphone", kind: "audio", file: "microphone.m4a" },
];

export async function verifySourceFiles(ffprobe, result, expectedDurationMs) {
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

export async function verifyExports(ffprobe, result, expectedDurationMs, exportModes) {
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
