import { app, BrowserWindow, dialog, session, systemPreferences } from "electron";
import { join, resolve } from "node:path";
import { registerMediaCoreIpc } from "./ipc/media-core.ipc";
import { registerAiCredentialsIpc } from "./ipc/ai-credentials.ipc";
import { registerMediaAccessIpc } from "./ipc/media-access.ipc";
import { registerSystemStatsIpc } from "./ipc/system-stats.ipc";
import { AiCredentialsService } from "./services/ai-credentials.service";
import { setModelApiKeyResolver } from "./services/ai-highlights.provider";
import { MediaCoreService } from "./services/media-core.service";
import { RecordingService } from "./services/recording.service";
import { registerStudioConfigIpc } from "./ipc/studio-config.ipc";
import { StudioConfigService } from "./services/studio-config.service";
import { createMainWindow } from "./services/window.service";
import { EXPORT_RESOLUTIONS } from "@shared/constants/media.constants";

const mediaCore = new MediaCoreService();
const recording = new RecordingService(mediaCore);

app.setName("Babu Studio");

if (app.isPackaged) {
  const bundledBin = join(process.resourcesPath, "media-core", "bin");
  process.env.BABU_STUDIO_FFMPEG_PATH ??= join(bundledBin, "ffmpeg");
  process.env.BABU_STUDIO_FFPROBE_PATH ??= join(bundledBin, "ffprobe");
}

function getMediaCorePath(): string {
  const configuredPath = process.env.BABU_STUDIO_MEDIA_CORE_PATH;
  if (configuredPath) {
    return configuredPath;
  }
  const executable = process.platform === "win32" ? "creator-media-core.exe" : "creator-media-core";
  if (app.isPackaged) {
    return join(process.resourcesPath, "media-core", "bin", executable);
  }
  return resolve(app.getAppPath(), "../../../core/build/bin", executable);
}

app.whenReady().then(async () => {
  registerMediaCoreIpc(mediaCore, recording);
  registerMediaAccessIpc();
  registerSystemStatsIpc();
  registerStudioConfigIpc(new StudioConfigService(join(app.getPath("userData"), "studio-config.json")));
  const aiCredentials = new AiCredentialsService(join(app.getPath("userData"), "ai-credentials.json"));
  registerAiCredentialsIpc(aiCredentials);
  setModelApiKeyResolver(() => aiCredentials.resolveKey());
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

  let mediaCoreReady = false;
  try {
    await mediaCore.start(getMediaCorePath());
    mediaCoreReady = true;
  } catch (error) {
    console.error("Unable to start the C++ media core:", error);
  }

  if (process.env.BABU_STUDIO_SYNTHETIC_FLOW_TEST === "1") {
    try {
      if (!mediaCoreReady) {
        throw new Error("The media core did not start; cannot run the synthetic flow test.");
      }
      const exportModes = (process.env.BABU_STUDIO_FLOW_TEST_EXPORTS ?? "HORIZONTAL,VERTICAL")
        .split(",")
        .map((mode) => mode.trim())
        .filter((mode): mode is "HORIZONTAL" | "VERTICAL" => mode === "HORIZONTAL" || mode === "VERTICAL");
      const aiPreviewOnlyId = process.env.BABU_STUDIO_FLOW_TEST_AI_PREVIEW_ID;
      const aiShotOnlyId = process.env.BABU_STUDIO_FLOW_TEST_AI_SHOT_ID;
      const logAiShotProgress = async (tag: string): Promise<void> => {
        const status = await recording.getStatus();
        console.log(`[recording-flow-test] ${tag} shot=${status.aiShotExport?.state}:${status.aiShotExport?.progress} clip=${status.aiShortClip?.state}:${status.aiShortClip?.progress}`);
      };
      if (aiShotOnlyId) {
        // Step 1: forced-360p AI export, then step 2: short clip cut from it,
        // polling status so progress is visible across frames like the UI does.
        const shotPoll = setInterval(() => {
          void logAiShotProgress("exporting").catch((error: unknown) => console.error("[recording-flow-test] status poll failed", error));
        }, 500);
        let shot;
        try {
          shot = await recording.exportAiShotClip({ id: aiShotOnlyId });
        } finally {
          clearInterval(shotPoll);
        }
        console.log(`[recording-flow-test] SHOT-EXPORT RESULT ${JSON.stringify(shot)}`);
        if (!shot.success) {
          throw new Error(shot.error || "AI 360p flow-test export failed.");
        }
        const clipPoll = setInterval(() => {
          void logAiShotProgress("generating").catch((error: unknown) => console.error("[recording-flow-test] status poll failed", error));
        }, 500);
        let clip;
        try {
          clip = await recording.generateAiShortClip({ id: aiShotOnlyId });
        } finally {
          clearInterval(clipPoll);
        }
        console.log(`[recording-flow-test] SHORT-CLIP RESULT ${JSON.stringify(clip)}`);
        if (!clip.success) {
          throw new Error(clip.error || "AI short-clip flow-test generation failed.");
        }
      } else if (aiPreviewOnlyId) {
        // Render only the small vertical AI preview for an existing take.
        const preview = await recording.exportAiPreview({ id: aiPreviewOnlyId });
        console.log(`[recording-flow-test] RESULT ${JSON.stringify(preview)}`);
      } else {
        const exportOnlyId = process.env.BABU_STUDIO_FLOW_TEST_EXPORT_ID;
        if (exportOnlyId) {
          // Re-export an existing take without recording. The flow test uses this
          // to prove takes recorded before per-source files still export.
          const exportResolution = process.env.BABU_STUDIO_FLOW_TEST_EXPORT_RESOLUTION ?? "1080p";
          if (!(exportResolution in EXPORT_RESOLUTIONS)) {
            throw new Error(`BABU_STUDIO_FLOW_TEST_EXPORT_RESOLUTION must be one of ${Object.keys(EXPORT_RESOLUTIONS).join(", ")}.`);
          }
          const started = await recording.exportRecording({
            id: exportOnlyId,
            exportModes,
            exportResolution: exportResolution as keyof typeof EXPORT_RESOLUTIONS,
          });
          if (!started.success) {
            throw new Error(started.error || "Export-only flow test could not start.");
          }
          const deadline = Date.now() + 600_000;
          let status = await recording.getStatus();
          while (status.postProcessingState === "PROCESSING") {
            if (Date.now() > deadline) {
              throw new Error("Export-only flow test timed out waiting for post-processing.");
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
            status = await recording.getStatus();
          }
          console.log(`[recording-flow-test] RESULT ${JSON.stringify(status)}`);
      } else {
        const durationMs = Number(process.env.BABU_STUDIO_FLOW_TEST_DURATION_MS ?? 60_000);
        const outputDirectory = process.env.BABU_STUDIO_FLOW_TEST_OUTPUT_DIR;
        if (!outputDirectory) {
          throw new Error("BABU_STUDIO_FLOW_TEST_OUTPUT_DIR must point to a unique test output directory.");
        }
        const result = await recording.runSyntheticFlowTest(
          durationMs,
          outputDirectory,
          exportModes,
          (elapsedMs) => console.log(`[recording-flow-test] Recording ${Math.floor(elapsedMs / 1000)}s/${Math.ceil(durationMs / 1000)}s`),
        );
        console.log(`[recording-flow-test] RESULT ${JSON.stringify(result)}`);
        }
      }
    } catch (error) {
      console.error("[recording-flow-test] FAILED", error);
      try {
        await recording.finishForShutdown();
      } catch (shutdownError) {
        console.error("[recording-flow-test] Cleanup failed", shutdownError);
      }
      process.exitCode = 1;
    } finally {
      allowQuit = true;
      app.quit();
    }
    return;
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
      message: "Babu Studio could not safely finalize the recording or complete both exports.",
      detail: `${error instanceof Error ? error.message : String(error)}\n\nKeep the app open to retry or inspect the recording. Quitting anyway may leave an incomplete recording or export.`,
      buttons: ["Keep Babu Studio Open", "Quit Anyway"],
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
  // Packaged macOS apps stay alive after the last window closes; dev runs must not linger as orphans.
  if (process.platform !== "darwin" || !app.isPackaged) {
    app.quit();
  }
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => app.quit());
}
