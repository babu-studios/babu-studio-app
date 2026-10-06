import { ipcMain } from "electron";
import type { MediaCoreService } from "../services/media-core.service";

export function registerMediaCoreIpc(mediaCore: MediaCoreService): void {
  ipcMain.handle("media-core:get-status", () => mediaCore.getStatus());
}
