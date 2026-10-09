import { app, BrowserWindow, session, systemPreferences } from "electron";
import { join, resolve } from "node:path";
import { registerMediaCoreIpc } from "./ipc/media-core.ipc";
import { registerDisplayCaptureIpc } from "./ipc/display-capture.ipc";
import { MediaCoreService } from "./services/media-core.service";
import { RecordingService } from "./services/recording.service";
import { createMainWindow } from "./services/window.service";

const mediaCore = new MediaCoreService();
const recording = new RecordingService(mediaCore);

app.setName("DUI Studio");

function getMediaCorePath(): string {
  const executable = process.platform === "win32" ? "creator-media-core.exe" : "creator-media-core";
  if (app.isPackaged) {
    return join(process.resourcesPath, "media-core", executable);
  }
  return resolve(app.getAppPath(), "../../../core/build/bin", executable);
}

app.whenReady().then(async () => {
  registerMediaCoreIpc(mediaCore, recording);
  registerDisplayCaptureIpc();
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = "securityOrigin" in details
      ? details.securityOrigin ?? webContents.getURL()
      : webContents.getURL();
    const isAppOrigin = origin.startsWith("file://")
      || origin.startsWith("http://localhost:")
      || origin.startsWith("http://127.0.0.1:");
    const requestsMedia = permission === "media"
      && "mediaTypes" in details
      && details.mediaTypes?.some((mediaType) => mediaType === "audio" || mediaType === "video");
    if (!isAppOrigin || !requestsMedia) {
      callback(false);
      return;
    }
    if (process.platform === "darwin") {
      const mediaTypes = details.mediaTypes ?? [];
      void Promise.all([
        ...(mediaTypes.includes("audio")
          ? [systemPreferences.askForMediaAccess("microphone")]
          : []),
        ...(mediaTypes.includes("video")
          ? [systemPreferences.askForMediaAccess("camera")]
          : []),
      ]).then((permissions) => callback(permissions.every(Boolean))).catch((error: unknown) => {
        console.error("Unable to request media permission:", error);
        callback(false);
      });
      return;
    }
    callback(true);
  });

  try {
    await mediaCore.start(getMediaCorePath());
  } catch (error) {
    console.error("Unable to start the C++ media core:", error);
  }

  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  recording.stopPostProcessing();
  mediaCore.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
