import { app, BrowserWindow, session, systemPreferences } from "electron";
import { join, resolve } from "node:path";
import { registerMediaCoreIpc } from "./ipc/media-core.ipc";
import { registerDisplayCaptureIpc } from "./ipc/display-capture.ipc";
import { MediaCoreService } from "./services/media-core.service";
import { createMainWindow } from "./services/window.service";

const mediaCore = new MediaCoreService();

app.setName("DUI Studio");

function getMediaCorePath(): string {
  const executable = process.platform === "win32" ? "creator-media-core.exe" : "creator-media-core";
  if (app.isPackaged) {
    return join(process.resourcesPath, "media-core", executable);
  }
  return resolve(app.getAppPath(), "../../../core/build/bin", executable);
}

app.whenReady().then(async () => {
  registerMediaCoreIpc(mediaCore);
  registerDisplayCaptureIpc();
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = "securityOrigin" in details
      ? details.securityOrigin ?? webContents.getURL()
      : webContents.getURL();
    const isAppOrigin = origin.startsWith("file://")
      || origin.startsWith("http://localhost:")
      || origin.startsWith("http://127.0.0.1:");
    const requestsVideo = permission === "media"
      && "mediaTypes" in details
      && details.mediaTypes?.includes("video");
    if (!isAppOrigin || !requestsVideo) {
      callback(false);
      return;
    }
    if (process.platform === "darwin") {
      void systemPreferences.askForMediaAccess("camera").then(callback).catch((error: unknown) => {
        console.error("Unable to request camera permission:", error);
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
  mediaCore.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
