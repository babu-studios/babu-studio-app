import { ipcMain } from "electron";
import type { ProcessSnapshot, SystemStats } from "@shared/types/system-stats";
import { SystemStatsService } from "../services/system-stats.service";

export function registerSystemStatsIpc(): void {
  const service = new SystemStatsService();
  ipcMain.handle("system-stats:get", (): Promise<SystemStats> => service.sample());
  ipcMain.handle("system-stats:get-processes", (): Promise<ProcessSnapshot> => service.sampleProcesses());
}
