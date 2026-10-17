import type { ExportRecordingRequest, MediaCoreStatus, RecordingResult, RecordingSummary, StartRecordingRequest } from "./media";
import type { ProcessSnapshot, SystemStats } from "./system-stats";
import type { StudioConfiguration } from "./studio-config";

declare global {
  interface Window {
    babuStudio: {
      loadStudioConfig(): Promise<StudioConfiguration | null>;
      saveStudioConfig(configuration: StudioConfiguration): Promise<void>;
      getMediaCoreStatus(): Promise<MediaCoreStatus>;
      startRecording(request: StartRecordingRequest): Promise<RecordingResult>;
      stopRecording(): Promise<RecordingResult>;
      getRecordingStatus(): Promise<RecordingResult>;
      listRecordings(): Promise<RecordingSummary[]>;
      exportRecording(request: ExportRecordingRequest): Promise<RecordingResult>;
      cancelRecordingExport(): Promise<void>;
      retryRecordingExport(): Promise<RecordingResult>;
      requestCameraAccess(): Promise<boolean>;
      requestMicrophoneAccess(): Promise<boolean>;
      getSystemStats(): Promise<SystemStats>;
      getProcessSnapshot(): Promise<ProcessSnapshot>;
      openActivityMonitor(): Promise<boolean>;
    };
  }
}

export {};
