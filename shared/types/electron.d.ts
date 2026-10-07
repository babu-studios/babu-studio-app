import type { MediaCoreStatus } from "./media";
import type { DesktopCaptureSourcesResult } from "./capture";

declare global {
  interface Window {
    duiStudio: {
      getMediaCoreStatus(): Promise<MediaCoreStatus>;
      getDesktopCaptureSources(): Promise<DesktopCaptureSourcesResult>;
      requestCameraAccess(): Promise<boolean>;
      requestMicrophoneAccess(): Promise<boolean>;
    };
  }
}

export {};
