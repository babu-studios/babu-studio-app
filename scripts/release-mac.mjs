#!/usr/bin/env node
// Usage: npm run release:mac -- [patch|minor|major|x.y.z]   (default: patch)
import { execSync } from "node:child_process";
import { readFileSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (command) => execSync(command, { cwd: root, stdio: "inherit" });

const current = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const bump = process.argv[2] ?? "patch";

function nextVersion(version, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const [major, minor, patch] = version.split(".").map(Number);
  switch (kind) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Invalid version argument "${kind}". Use patch, minor, major or x.y.z.`);
  }
}

const version = nextVersion(current, bump);
console.log(`\n==> Updating version ${current} -> ${version}`);
run(`npm version ${version} --no-git-tag-version --allow-same-version --workspaces --include-workspace-root`);

console.log("\n==> Removing old release and build outputs");
for (const dir of ["release", "core/build", "apps/desktop/electron/out"]) {
  rmSync(join(root, dir), { recursive: true, force: true });
}
mkdirSync(join(root, "release"), { recursive: true });

console.log("\n==> Building new release");
run("npm run package:mac");

console.log(`\nDone. Release ${version} is in ${join(root, "release")}`);
