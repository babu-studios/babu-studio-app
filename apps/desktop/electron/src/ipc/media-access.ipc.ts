import { ipcMain, systemPreferences } from "electron";

export function registerMediaAccessIpc(): void {
  ipcMain.handle("camera-capture:request-access", async (): Promise<boolean> => {
    if (process.platform !== "darwin") {
      return true;
    }
    return systemPreferences.askForMediaAccess("camera");
  });

  ipcMain.handle("microphone-capture:request-access", async (): Promise<boolean> => {
    if (process.platform !== "darwin") {
      return true;
    }
    return systemPreferences.askForMediaAccess("microphone");
  });
}
