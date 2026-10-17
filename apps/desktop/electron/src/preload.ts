import { contextBridge, ipcRenderer } from "electron";
import type { ProcessSnapshot, SystemStats } from "@shared/types/system-stats";
import type { ExportRecordingRequest, MediaCoreStatus, RecordingResult, RecordingSummary, StartRecordingRequest } from "@shared/types/media";
import type {
  YouTubeOAuthStatus,
  YouTubeVideoCategory,
  YouTubeVideoUploadChunkResult,
  YouTubeVideoUploadMetadata,
} from "@shared/types/youtube";

contextBridge.exposeInMainWorld("babuStudio", {
  getMediaCoreStatus: (): Promise<MediaCoreStatus> => ipcRenderer.invoke("media-core:get-status"),
  startRecording: (request: StartRecordingRequest): Promise<RecordingResult> => ipcRenderer.invoke("recording:start", request),
  stopRecording: (): Promise<RecordingResult> => ipcRenderer.invoke("recording:stop"),
  getRecordingStatus: (): Promise<RecordingResult> => ipcRenderer.invoke("recording:status"),
  listRecordings: (): Promise<RecordingSummary[]> => ipcRenderer.invoke("recording:list"),
  exportRecording: (request: ExportRecordingRequest): Promise<RecordingResult> => ipcRenderer.invoke("recording:export", request),
  cancelRecordingExport: (): Promise<void> => ipcRenderer.invoke("recording:cancel-export"),
  retryRecordingExport: (): Promise<RecordingResult> => ipcRenderer.invoke("recording:retry-export"),
  requestCameraAccess: (): Promise<boolean> => ipcRenderer.invoke("camera-capture:request-access"),
  requestMicrophoneAccess: (): Promise<boolean> => ipcRenderer.invoke("microphone-capture:request-access"),
  getSystemStats: (): Promise<SystemStats> => ipcRenderer.invoke("system-stats:get"),
  getProcessSnapshot: (): Promise<ProcessSnapshot> => ipcRenderer.invoke("system-stats:get-processes"),
  getYouTubeOAuthStatus: (): Promise<YouTubeOAuthStatus> => ipcRenderer.invoke("youtube:get-oauth-status"),
  connectYouTubeAccount: (): Promise<void> => ipcRenderer.invoke("youtube:connect-account"),
  getYouTubeVideoCategories: (): Promise<YouTubeVideoCategory[]> => ipcRenderer.invoke("youtube:video-categories"),
  beginYouTubeVideoUpload: (metadata: YouTubeVideoUploadMetadata): Promise<string> =>
    ipcRenderer.invoke("youtube:begin-video-upload", metadata),
  uploadYouTubeVideoChunk: (
    uploadId: string,
    offset: number,
    bytes: Uint8Array,
    totalBytes: number,
  ): Promise<YouTubeVideoUploadChunkResult> =>
    ipcRenderer.invoke("youtube:upload-video-chunk", uploadId, offset, bytes, totalBytes),
  uploadYouTubeThumbnail: (videoId: string, mimeType: string, bytes: Uint8Array): Promise<void> =>
    ipcRenderer.invoke("youtube:upload-thumbnail", videoId, mimeType, bytes),
});
