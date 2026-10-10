import type { MediaCoreStatus, RecordingResult, StartRecordingRequest } from "./media";
import type { ProcessSnapshot, SystemStats } from "./system-stats";

declare global {
  interface Window {
    duiStudio: {
      getMediaCoreStatus(): Promise<MediaCoreStatus>;
      startRecording(request: StartRecordingRequest): Promise<RecordingResult>;
      stopRecording(): Promise<RecordingResult>;
      getRecordingStatus(): Promise<RecordingResult>;
      cancelRecordingExport(): Promise<void>;
      retryRecordingExport(): Promise<RecordingResult>;
      requestCameraAccess(): Promise<boolean>;
      requestMicrophoneAccess(): Promise<boolean>;
      getSystemStats(): Promise<SystemStats>;
      getProcessSnapshot(): Promise<ProcessSnapshot>;
    };
  }
}

export {};
