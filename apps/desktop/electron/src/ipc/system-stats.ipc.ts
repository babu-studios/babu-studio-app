import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ipcMain, shell } from "electron";
import type { ProcessSnapshot, SystemStats } from "@shared/types/system-stats";
import { SystemStatsService } from "../services/system-stats.service";

const run = promisify(execFile);

export function registerSystemStatsIpc(): void {
  const service = new SystemStatsService();
  ipcMain.handle("system-stats:get", (): Promise<SystemStats> => service.sample());
  ipcMain.handle("system-stats:get-processes", (): Promise<ProcessSnapshot> => service.sampleProcesses());
  ipcMain.handle("system-stats:open-activity-monitor", async (): Promise<boolean> => {
    const failure = await shell.openPath("/System/Applications/Utilities/Activity Monitor.app");
    if (!failure) {
      return true;
    }
    try {
      await run("/usr/bin/open", ["-a", "Activity Monitor"]);
      return true;
    } catch (error) {
      console.error("Unable to open Activity Monitor:", failure, error);
      return false;
    }
  });
}
