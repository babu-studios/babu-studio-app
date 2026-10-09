import { app, BrowserWindow, dialog, session, systemPreferences } from "electron";
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

let allowQuit = false;
let preparingToQuit = false;

app.on("before-quit", (event) => {
  if (allowQuit) {
    recording.stopPostProcessing();
    mediaCore.stop();
    return;
  }

  event.preventDefault();
  if (preparingToQuit) {
    return;
  }
  preparingToQuit = true;

  void recording.finishForShutdown().then(() => {
    allowQuit = true;
    app.quit();
  }).catch(async (error: unknown) => {
    console.error("Unable to safely finish recording before quitting:", error);
    const result = await dialog.showMessageBox({
      type: "warning",
      title: "Recording or export could not be finished",
      message: "DUI Studio could not safely finalize the recording or complete both exports.",
      detail: `${error instanceof Error ? error.message : String(error)}\n\nKeep the app open to retry or inspect the recording. Quitting anyway may leave an incomplete recording or export.`,
      buttons: ["Keep DUI Studio Open", "Quit Anyway"],
      defaultId: 0,
      cancelId: 0,
    });
    preparingToQuit = false;
    if (result.response === 1) {
      allowQuit = true;
      app.quit();
    } else if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  }).catch((error: unknown) => {
    preparingToQuit = false;
    console.error("Unable to show the recording shutdown warning:", error);
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
