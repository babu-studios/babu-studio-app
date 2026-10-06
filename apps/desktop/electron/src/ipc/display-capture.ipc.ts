import { desktopCapturer, ipcMain, systemPreferences } from "electron";
import type { DesktopCaptureSourcesResult } from "@shared/types/capture";

export function registerDisplayCaptureIpc(): void {
  ipcMain.handle("camera-capture:request-access", async (): Promise<boolean> => {
    if (process.platform !== "darwin") {
      return true;
    }
    return systemPreferences.askForMediaAccess("camera");
  });

  ipcMain.handle("desktop-capture:get-sources", async (): Promise<DesktopCaptureSourcesResult> => {
    const permissionStatus = process.platform === "darwin"
      ? systemPreferences.getMediaAccessStatus("screen")
      : "unknown";
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 0, height: 0 },
      });
      let screenIndex = 0;
      return {
        sources: sources.map(({ id, name }) => {
          if (!id.startsWith("screen:")) {
            return { id, name };
          }
          screenIndex += 1;
          return { id, name: screenIndex === 1 ? "Entire Screen" : `Display ${screenIndex}` };
        }),
        permissionStatus,
        error: null,
      };
    } catch (error) {
      console.error("Unable to enumerate desktop capture sources:", error);
      return {
        sources: [],
        permissionStatus,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
