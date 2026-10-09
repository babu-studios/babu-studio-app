import type { MediaCoreStatus, RecordingResult, StartRecordingRequest } from "./media";
import type { DesktopCaptureSourcesResult } from "./capture";

declare global {
  interface Window {
    duiStudio: {
      getMediaCoreStatus(): Promise<MediaCoreStatus>;
      startRecording(request: StartRecordingRequest): Promise<RecordingResult>;
      stopRecording(): Promise<RecordingResult>;
      getRecordingStatus(): Promise<RecordingResult>;
      retryRecordingExport(): Promise<RecordingResult>;
      getDesktopCaptureSources(): Promise<DesktopCaptureSourcesResult>;
      requestCameraAccess(): Promise<boolean>;
      requestMicrophoneAccess(): Promise<boolean>;
    };
  }
}

export {};
