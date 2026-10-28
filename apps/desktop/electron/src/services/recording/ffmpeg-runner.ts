import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { powerGuard } from "../power-guard.service";

export type FfmpegProcess = ChildProcessByStdio<null, null, Readable>;

/** Spawn FFmpeg with progress reporting, holding a power guard for the run. */
export function runFfmpeg(
  args: string[],
  onSpawn: (child: FfmpegProcess) => void,
  onClose: (child: FfmpegProcess) => void,
  onOutputTime: (microseconds: number) => void,
): Promise<void> {
  const ffmpegPath = process.env.BABU_STUDIO_FFMPEG_PATH || "ffmpeg";
  return new Promise((resolve, reject) => {
    const releasePowerGuard = powerGuard.acquire();
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    onSpawn(child);
    let stderr = "";
    let progressRemainder = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-12_000);
      const lines = `${progressRemainder}${chunk}`.split(/\r?\n/);
      progressRemainder = lines.pop() ?? "";
      for (const line of lines) {
        const separator = line.indexOf("=");
        if (separator < 0 || line.slice(0, separator) !== "out_time_us") {
          continue;
        }
        const microseconds = Number(line.slice(separator + 1));
        if (Number.isFinite(microseconds) && microseconds >= 0) {
          onOutputTime(microseconds);
        }
      }
    });
    child.once("error", (error) => {
      releasePowerGuard();
      reject(error);
    });
    child.once("close", (code, signal) => {
      releasePowerGuard();
      onClose(child);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}: ${stderr.trim() || "No diagnostic output."}`));
      }
    });
  });
}
