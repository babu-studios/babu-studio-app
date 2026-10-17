import { ipcMain } from "electron";
import type { StudioConfiguration } from "@shared/types/studio-config";
import type { StudioConfigService } from "../services/studio-config.service";

export function registerStudioConfigIpc(service: StudioConfigService): void {
  ipcMain.handle("studio-config:load", (): Promise<StudioConfiguration | null> => service.load());
  ipcMain.handle("studio-config:save", (_event, configuration: StudioConfiguration): Promise<void> => (
    service.save(configuration)
  ));
}
