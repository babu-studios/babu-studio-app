#!/usr/bin/env node
// Collects creator-media-core, ffmpeg and every non-system dylib they need into
// core/build/bundle so the packaged app runs without Homebrew or a system FFmpeg.
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundleDir = join(root, "core/build/bundle");
const binDir = join(bundleDir, "bin");
const libDir = join(bundleDir, "lib");

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function fail(message) {
  console.error(`bundle-media-tools: ${message}`);
  process.exit(1);
}

if (process.platform !== "darwin") {
  fail("only macOS is supported.");
}

const coreBinary = join(root, "core/build/bin/creator-media-core");
if (!existsSync(coreBinary)) {
  fail("core/build/bin/creator-media-core is missing. Run `npm run build:core` first.");
}

const ffmpegSource = process.env.BABU_STUDIO_FFMPEG_SOURCE
  || run("/usr/bin/which", ["ffmpeg"]).trim();
if (!ffmpegSource) {
  fail("ffmpeg was not found. Install it on the build machine or set BABU_STUDIO_FFMPEG_SOURCE.");
}

const isSystemPath = (path) => path.startsWith("/usr/lib/") || path.startsWith("/System/");

function linkedLibraries(file) {
  return run("otool", ["-L", file]).split("\n").slice(1)
    .map((line) => line.trim().split(" (")[0])
    .filter(Boolean);
}

function rpaths(file) {
  const lines = run("otool", ["-l", file]).split("\n");
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("cmd LC_RPATH")) {
      const match = /path (.+) \(offset/.exec(lines[i + 2] ?? "");
      if (match) result.push(match[1]);
    }
  }
  return result;
}

function resolveDependency(dependency, owner) {
  const ownerDir = dirname(owner);
  const candidates = [];
  if (dependency.startsWith("@rpath/")) {
    const name = dependency.slice("@rpath/".length);
    for (const rpath of rpaths(owner)) {
      candidates.push(join(rpath.replace("@loader_path", ownerDir).replace("@executable_path", ownerDir), name));
    }
    candidates.push(join(ownerDir, name), join("/opt/homebrew/lib", name), join("/usr/local/lib", name));
  } else if (dependency.startsWith("@loader_path/") || dependency.startsWith("@executable_path/")) {
    candidates.push(join(ownerDir, dependency.replace(/^@\w+\//, "")));
  } else {
    candidates.push(dependency);
  }
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) fail(`cannot resolve ${dependency} required by ${owner}`);
  return realpathSync(found);
}

rmSync(bundleDir, { recursive: true, force: true });
mkdirSync(binDir, { recursive: true });
mkdirSync(libDir, { recursive: true });

// source path of the original file -> path of its copy in the bundle
const copies = new Map();
const queue = [];

function addExecutable(source, name) {
  const target = join(binDir, name);
  copyFileSync(realpathSync(source), target);
  chmodSync(target, 0o755);
  copies.set(realpathSync(source), target);
  queue.push({ original: realpathSync(source), copy: target, executable: true });
}

addExecutable(coreBinary, "creator-media-core");
addExecutable(ffmpegSource, "ffmpeg");
const ffprobeSource = join(dirname(ffmpegSource), "ffprobe");
if (existsSync(ffprobeSource)) addExecutable(ffprobeSource, "ffprobe");

const usedNames = new Map();
function copyLibrary(original) {
  if (copies.has(original)) return copies.get(original);
  const name = basename(original);
  if (usedNames.has(name) && usedNames.get(name) !== original) {
    fail(`two different libraries share the name ${name}`);
  }
  usedNames.set(name, original);
  const target = join(libDir, name);
  copyFileSync(original, target);
  chmodSync(target, 0o755);
  copies.set(original, target);
  queue.push({ original, copy: target, executable: false });
  return target;
}

while (queue.length > 0) {
  const { original, copy, executable } = queue.shift();
  if (!executable) {
    run("install_name_tool", ["-id", `@rpath/${basename(copy)}`, copy]);
  }
  const prefix = executable ? "@loader_path/../lib" : "@loader_path";
  for (const dependency of linkedLibraries(original)) {
    if (isSystemPath(dependency) || dependency === original) continue;
    // Skip the library's own install name entry.
    if (!executable && basename(dependency) === basename(original)) continue;
    const resolved = resolveDependency(dependency, original);
    if (isSystemPath(resolved)) continue;
    const copied = copyLibrary(resolved);
    run("install_name_tool", ["-change", dependency, `${prefix}/${basename(copied)}`, copy]);
  }
  // Remove rpaths that point at the build machine.
  for (const rpath of rpaths(copy)) {
    if (!rpath.startsWith("@")) {
      run("install_name_tool", ["-delete_rpath", rpath, copy]);
    }
  }
}

// Modifying load commands invalidates signatures; Apple Silicon refuses unsigned code.
for (const file of copies.values()) {
  run("codesign", ["--force", "--sign", "-", file]);
}

for (const file of copies.values()) {
  const leaks = linkedLibraries(file).filter((library) => library.startsWith("/opt/") || library.startsWith("/usr/local/"));
  if (leaks.length > 0) fail(`${file} still links to build-machine paths: ${leaks.join(", ")}`);
}

console.log(`Bundled ${copies.size} files into ${bundleDir}`);
