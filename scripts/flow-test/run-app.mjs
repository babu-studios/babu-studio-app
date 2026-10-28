import { once } from "node:events";
import { spawn } from "node:child_process";
import { fail } from "./cli.mjs";

// Boot the built app headlessly and return the RESULT it prints.
export async function runApp(context, extraEnv) {
  const { electronBinary, mainEntry, repositoryRoot, mediaCore, exportModes } = context;
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
