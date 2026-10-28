// Offline subtitle dubbing: synthesizes each .srt cue with a macOS voice and
// places the clips on the original timeline, so the dubbed track keeps the
// source timing. Never shells out: argv only, matching recording.service.ts.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSrt, type SubtitleTurn } from "./subtitles-srt.js";

export type DubProgress = {
  phase: "synthesizing" | "assembling";
  cueIndex: number;
  cueTotal: number;
  percent: number;
};

export type SynthesizeDubOptions = {
  srtPath: string;
  voice: string;
  outPath: string;
  onProgress?: (progress: DubProgress) => void;
  signal?: AbortSignal;
};

export type DubResult = {
  wavPath: string;
  cueCount: number;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Dubbing cancelled.");
  }
}

function runProcess(command: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const onAbort = (): void => {
      child.kill("SIGKILL");
      reject(new Error("Dubbing cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.once("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code ?? "unknown"}${stderr ? `: ${stderr.slice(-300)}` : ""}`));
      }
    });
  });
}

function measureWavSeconds(filePath: string, fallbackSeconds: number): Promise<number> {
  const ffprobePath = process.env.BABU_STUDIO_FFPROBE_PATH || "ffprobe";
  return new Promise((resolve) => {
    const child = spawn(
      ffprobePath,
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.once("error", () => resolve(fallbackSeconds));
    child.once("close", (code) => {
      if (code !== 0) {
        resolve(fallbackSeconds);
        return;
      }
      const seconds = Number(stdout.trim());
      resolve(Number.isFinite(seconds) && seconds > 0 ? seconds : fallbackSeconds);
    });
  });
}

/**
 * Builds the ffmpeg filter_complex that places each cue wav at its subtitle
 * start time. Overlong cues are sped up (max 2x) then trimmed to their slot;
 * gaps stay silent. Output is a single mixed stream ending at totalMs.
 */
export function buildDubTimeline(turns: SubtitleTurn[], cueSeconds: number[], totalMs: number): string {
  const totalSeconds = Math.max(0.1, totalMs / 1000);
  const chains = turns.map((turn, index) => {
    const slotSeconds = Math.max(0.1, (turn.endMs - turn.startMs) / 1000);
    const spokenSeconds = Math.max(0.1, cueSeconds[index] ?? slotSeconds);
    const rate = Math.min(2, Math.max(1, spokenSeconds / slotSeconds));
    const delayMs = Math.max(0, Math.round(turn.startMs));
    return (
      `[${index}:a]` +
      `atempo=${rate.toFixed(3)}` +
      `,atrim=0:${slotSeconds.toFixed(3)}` +
      `,adelay=${delayMs}|${delayMs}` +
      `,apad=whole_dur=${totalSeconds.toFixed(3)}` +
      `[c${index}]`
    );
  });
  const mixInputs = turns.map((_, index) => `[c${index}]`).join("");
  return `${chains.join(";")};${mixInputs}amix=inputs=${turns.length}:normalize=0,atrim=0:${totalSeconds.toFixed(3)}[dub]`;
}

export async function synthesizeDubbedTrack(options: SynthesizeDubOptions): Promise<DubResult> {
  if (process.platform !== "darwin") {
    throw new Error("Offline dubbing needs macOS voices (say).");
  }
  const ffmpegPath = process.env.BABU_STUDIO_FFMPEG_PATH || "ffmpeg";
  const turns = parseSrt(await readFile(options.srtPath, "utf8"));
  if (turns.length === 0) {
    throw new Error("No subtitle cues to dub.");
  }
  const totalMs = Math.max(...turns.map((turn) => turn.endMs));
  const workDir = await mkdtemp(join(tmpdir(), "babu-dub-"));
  try {
    const cueFiles: string[] = [];
    const cueSeconds: number[] = [];
    for (let index = 0; index < turns.length; index += 1) {
      throwIfAborted(options.signal);
      const turn = turns[index];
      const aiffPath = join(workDir, `cue-${index}.aiff`);
      const wavPath = join(workDir, `cue-${index}.wav`);
      try {
        await runProcess("say", ["-v", options.voice, "-o", aiffPath, "--", turn.text.replace(/\s+/g, " ").trim()], options.signal);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("ENOENT")) {
          throw new Error("macOS voice synthesis (say) is unavailable.");
        }
        throw new Error(`Voice synthesis failed for cue ${turn.id}: ${message}`);
      }
      await runProcess(
        ffmpegPath,
        ["-v", "error", "-y", "-i", aiffPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavPath],
        options.signal,
      );
      const slotSeconds = Math.max(0.1, (turn.endMs - turn.startMs) / 1000);
      cueFiles.push(wavPath);
      cueSeconds.push(await measureWavSeconds(wavPath, slotSeconds));
      options.onProgress?.({
        phase: "synthesizing",
        cueIndex: index + 1,
        cueTotal: turns.length,
        percent: Math.round(((index + 1) / (turns.length + 1)) * 100),
      });
    }
    throwIfAborted(options.signal);
    options.onProgress?.({ phase: "assembling", cueIndex: turns.length, cueTotal: turns.length, percent: 95 });
    const filter = buildDubTimeline(turns, cueSeconds, totalMs);
    const inputs = cueFiles.flatMap((file) => ["-i", file]);
    await runProcess(
      ffmpegPath,
      ["-v", "error", "-y", ...inputs, "-filter_complex", filter, "-map", "[dub]", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "-t", (totalMs / 1000).toFixed(3), options.outPath],
      options.signal,
    );
    options.onProgress?.({ phase: "assembling", cueIndex: turns.length, cueTotal: turns.length, percent: 100 });
    return { wavPath: options.outPath, cueCount: turns.length };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
