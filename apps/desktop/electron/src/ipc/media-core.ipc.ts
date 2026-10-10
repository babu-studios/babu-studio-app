import { ipcMain } from "electron";
import type { StartRecordingRequest } from "@shared/types/media";
import type { MediaCoreService } from "../services/media-core.service";
import type { RecordingService } from "../services/recording.service";

export function registerMediaCoreIpc(mediaCore: MediaCoreService, recording: RecordingService): void {
  ipcMain.handle("media-core:get-status", () => mediaCore.getStatus());
  ipcMain.handle("recording:start", (_event, request: StartRecordingRequest) => recording.start(request));
  ipcMain.handle("recording:stop", () => recording.stop());
  ipcMain.handle("recording:status", () => recording.getStatus());
  ipcMain.handle("recording:retry-export", () => recording.retryPostProcessing());
  ipcMain.handle("recording:cancel-export", () => recording.cancelPostProcessing());
}
