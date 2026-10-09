import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { MEDIA_CORE_RECORDING_TIMEOUT_MS, MEDIA_CORE_STATUS_TIMEOUT_MS } from "@shared/constants/media.constants";
import type { MediaCoreStatus, NativeCaptureDevice, RecordingResult, StartRecordingRequest } from "@shared/types/media";

type PendingRequest = {
  resolve: (response: string) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

function isNativeCaptureDevice(value: unknown): value is NativeCaptureDevice {
  return typeof value === "object"
    && value !== null
    && "id" in value
    && typeof value.id === "string"
    && "name" in value
    && typeof value.name === "string"
    && "type" in value
    && (value.type === "video" || value.type === "audio");
}

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

  async getStatus(): Promise<MediaCoreStatus> {
    const response = await this.request("STATUS", MEDIA_CORE_STATUS_TIMEOUT_MS);
    if (response !== "READY") {
      throw new Error(`Unexpected media-core response: ${response || "(empty)"}`);
    }
    return "ready";
  }

  async listDevices(): Promise<NativeCaptureDevice[]> {
    const response = await this.request("LIST_DEVICES", MEDIA_CORE_STATUS_TIMEOUT_MS);
    const devices: unknown = JSON.parse(response);
    if (!Array.isArray(devices) || !devices.every(isNativeCaptureDevice)) {
      throw new Error("Media core returned an invalid capture-device list.");
    }
    return devices;
  }

  startRecording(outputDir: string, request: StartRecordingRequest): Promise<RecordingResult> {
    const fields = [
      "START_RECORDING",
      `mode=${request.mode}`,
      `fps=${Math.round(request.fps)}`,
      `gameVolume=${request.gameVolume}`,
      `microphoneVolume=${request.microphoneVolume}`,
      `outputDir=${outputDir}`,
      "fileName=master.mkv",
    ];
    const clean = (value: string) => value.replace(/[\t\r\n]/g, " ");
    const optional: Array<[string, string | number | undefined]> = [
      ["captureCard", request.captureCard],
      ["camera", request.camera],
      ["gameAudio", request.gameAudio],
      ["microphone", request.microphone],
      ["microphoneEnabled", request.microphoneEnabled === undefined ? undefined : request.microphoneEnabled ? 1 : 0],
      ["captureWidth", request.captureWidth],
      ["captureHeight", request.captureHeight],
    ];
    for (const [key, value] of optional) {
      if (value !== undefined && value !== "") {
        fields.push(`${key}=${clean(String(value))}`);
      }
    }
    return this.recordingRequest(fields.join("\t"));
  }

  stopRecording(): Promise<RecordingResult> {
    return this.recordingRequest("STOP_RECORDING");
  }

  getRecordingStatus(): Promise<RecordingResult> {
    return this.recordingRequest("RECORDING_STATUS");
  }

  private async recordingRequest(command: string): Promise<RecordingResult> {
    const response = await this.request(command, MEDIA_CORE_RECORDING_TIMEOUT_MS);
    return JSON.parse(response) as RecordingResult;
  }

  private request(command: string, timeoutMs: number): Promise<string> {
    const request = this.requestQueue.then(() => this.sendRequest(command, timeoutMs));
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

  private sendRequest(command: string, timeoutMs: number): Promise<string> {
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
        reject(new Error(`Media core did not respond to ${command.split("\t")[0]} within ${timeoutMs / 1000} seconds.`));
      }, timeoutMs);
      this.pendingRequest = { resolve, reject, timeout };
      child.stdin.write(`${command}\n`, (error) => {
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
    if (response === "ERROR") {
      pending.reject(new Error("Media core rejected the command."));
    } else {
      pending.resolve(response);
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
