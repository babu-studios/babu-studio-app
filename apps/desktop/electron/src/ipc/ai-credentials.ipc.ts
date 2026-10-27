import { ipcMain } from "electron";
import type { AiCredentialsService } from "../services/ai-credentials.service";

export function registerAiCredentialsIpc(credentials: AiCredentialsService): void {
  ipcMain.handle("ai-key:status", () => credentials.getStatus());
  ipcMain.handle("ai-key:set", (_event, key: unknown) => credentials.setKey(key as string));
  ipcMain.handle("ai-key:clear", () => credentials.clearKey());
}
