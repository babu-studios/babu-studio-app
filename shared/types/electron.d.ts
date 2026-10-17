import type { ExportRecordingRequest, MediaCoreStatus, RecordingResult, RecordingSummary, StartRecordingRequest } from "./media";
import type { ProcessSnapshot, SystemStats } from "./system-stats";
import type {
  YouTubeOAuthStatus,
  YouTubeVideoCategory,
  YouTubeVideoUploadChunkResult,
  YouTubeVideoUploadMetadata,
} from "./youtube";

declare global {
  interface Window {
    babuStudio: {
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
      getYouTubeOAuthStatus(): Promise<YouTubeOAuthStatus>;
      connectYouTubeAccount(): Promise<void>;
      getYouTubeVideoCategories(): Promise<YouTubeVideoCategory[]>;
      beginYouTubeVideoUpload(metadata: YouTubeVideoUploadMetadata): Promise<string>;
      uploadYouTubeVideoChunk(
        uploadId: string,
        offset: number,
        bytes: Uint8Array,
        totalBytes: number,
      ): Promise<YouTubeVideoUploadChunkResult>;
      uploadYouTubeThumbnail(videoId: string, mimeType: string, bytes: Uint8Array): Promise<void>;
    };
  }
}

export {};
