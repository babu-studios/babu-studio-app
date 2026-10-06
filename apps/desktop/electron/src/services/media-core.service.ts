import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { MEDIA_CORE_STATUS_TIMEOUT_MS } from "@shared/constants/media.constants";
import type { MediaCoreStatus } from "@shared/types/media";

type PendingRequest = {
  resolve: (status: MediaCoreStatus) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class MediaCoreService {
  private process?: ChildProcessWithoutNullStreams;
  private pendingRequest?: PendingRequest;
  private outputBuffer = "";
  private requestQueue: Promise<void> = Promise.resolve();
  private startupError?: Error;

  async start(executablePath: string): Promise<void> {
    const child = spawn(executablePath, [], { stdio: "pipe" });
    this.process = child;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.handleOutput(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => console.error(`[media-core] ${chunk.trimEnd()}`));
    child.on("error", (error) => {
      this.startupError = error;
      this.rejectPending(error);
    });
    child.on("close", (code, signal) => {
      this.process = undefined;
      const error = new Error(`Media core exited (code ${code ?? "unknown"}, signal ${signal ?? "none"}).`);
      this.startupError = error;
      this.rejectPending(error);
    });

    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => {
        child.removeListener("error", onError);
        resolve();
      };
      const onError = (error: Error) => {
        child.removeListener("spawn", onSpawn);
        reject(error);
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
    });
  }

  getStatus(): Promise<MediaCoreStatus> {
    const request = this.requestQueue.then(() => this.sendStatusRequest());
    this.requestQueue = request.then(
      () => undefined,
      () => undefined,
    );
    return request;
  }

  stop(): void {
    this.process?.stdin.end();
    this.process?.kill();
    this.process = undefined;
  }

  private sendStatusRequest(): Promise<MediaCoreStatus> {
    const child = this.process;
    if (!child || child.killed || child.stdin.destroyed) {
      return Promise.reject(this.startupError ?? new Error("Media core process is not running."));
    }
    if (this.pendingRequest) {
      return Promise.reject(new Error("A media-core request is already in progress."));
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequest = undefined;
        reject(new Error("Media core did not respond to the status request within 5 seconds."));
      }, MEDIA_CORE_STATUS_TIMEOUT_MS);
      this.pendingRequest = { resolve, reject, timeout };
      child.stdin.write("STATUS\n", (error) => {
        if (error) {
          this.rejectPending(error);
        }
      });
    });
  }

  private handleOutput(chunk: string): void {
    this.outputBuffer += chunk;
    let newlineIndex = this.outputBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.outputBuffer.slice(0, newlineIndex).trim();
      this.outputBuffer = this.outputBuffer.slice(newlineIndex + 1);
      this.resolveResponse(line);
      newlineIndex = this.outputBuffer.indexOf("\n");
    }
  }

  private resolveResponse(response: string): void {
    const pending = this.pendingRequest;
    if (!pending) {
      console.error(`Unexpected response from media core: ${response}`);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequest = undefined;
    if (response === "READY") {
      pending.resolve("ready");
    } else {
      pending.reject(new Error(`Unexpected media-core response: ${response || "(empty)"}`));
    }
  }

  private rejectPending(error: Error): void {
    const pending = this.pendingRequest;
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequest = undefined;
    pending.reject(error);
  }
}
