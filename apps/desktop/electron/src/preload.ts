import { contextBridge, ipcRenderer } from "electron";
import type { DesktopCaptureSourcesResult } from "@shared/types/capture";
import type { MediaCoreStatus } from "@shared/types/media";

contextBridge.exposeInMainWorld("duiStudio", {
  getMediaCoreStatus: (): Promise<MediaCoreStatus> => ipcRenderer.invoke("media-core:get-status"),
  getDesktopCaptureSources: (): Promise<DesktopCaptureSourcesResult> => ipcRenderer.invoke("desktop-capture:get-sources"),
  requestCameraAccess: (): Promise<boolean> => ipcRenderer.invoke("camera-capture:request-access"),
  requestMicrophoneAccess: (): Promise<boolean> => ipcRenderer.invoke("microphone-capture:request-access"),
});
