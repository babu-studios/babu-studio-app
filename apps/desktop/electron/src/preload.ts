import { contextBridge, ipcRenderer } from "electron";
import type { ProcessSnapshot, SystemStats } from "@shared/types/system-stats";
import type { AiArtifactsRequest, AiArtifactsResult, AiKeyStatus, AiPreviewResult, ExportAiPreviewRequest, ExportAllHighlightsRequest, ExportHighlightClipRequest, ExportRecordingRequest, FindHighlightsRequest, FindHighlightsResult, HighlightClipExportResult, MediaCoreStatus, RecordingResult, RecordingSummary, StartRecordingRequest } from "@shared/types/media";
import type { StudioConfiguration } from "@shared/types/studio-config";

contextBridge.exposeInMainWorld("babuStudio", {
  loadStudioConfig: (): Promise<StudioConfiguration | null> => ipcRenderer.invoke("studio-config:load"),
  saveStudioConfig: (configuration: StudioConfiguration): Promise<void> => ipcRenderer.invoke("studio-config:save", configuration),
  getMediaCoreStatus: (): Promise<MediaCoreStatus> => ipcRenderer.invoke("media-core:get-status"),
  startRecording: (request: StartRecordingRequest): Promise<RecordingResult> => ipcRenderer.invoke("recording:start", request),
  stopRecording: (): Promise<RecordingResult> => ipcRenderer.invoke("recording:stop"),
  getRecordingStatus: (): Promise<RecordingResult> => ipcRenderer.invoke("recording:status"),
  listRecordings: (): Promise<RecordingSummary[]> => ipcRenderer.invoke("recording:list"),
  exportRecording: (request: ExportRecordingRequest): Promise<RecordingResult> => ipcRenderer.invoke("recording:export", request),
  cancelRecordingExport: (): Promise<void> => ipcRenderer.invoke("recording:cancel-export"),
  retryRecordingExport: (): Promise<RecordingResult> => ipcRenderer.invoke("recording:retry-export"),
  exportAiPreview: (request: ExportAiPreviewRequest): Promise<AiPreviewResult> => ipcRenderer.invoke("recording:export-ai-preview", request),
  getAiArtifacts: (request: AiArtifactsRequest): Promise<AiArtifactsResult> => ipcRenderer.invoke("recording:ai-artifacts", request),
  cancelAiPreview: (): Promise<void> => ipcRenderer.invoke("recording:cancel-ai-preview"),
  exportAiShotClip: (request: ExportAiPreviewRequest): Promise<AiPreviewResult> => ipcRenderer.invoke("recording:export-ai-shot", request),
  cancelAiShotClipExport: (): Promise<void> => ipcRenderer.invoke("recording:cancel-ai-shot"),
  generateAiShortClip: (request: ExportAiPreviewRequest): Promise<AiPreviewResult> => ipcRenderer.invoke("recording:generate-ai-short-clip", request),
  cancelAiShortClip: (): Promise<void> => ipcRenderer.invoke("recording:cancel-ai-short-clip"),
  findHighlights: (request: FindHighlightsRequest): Promise<FindHighlightsResult> => ipcRenderer.invoke("recording:find-highlights", request),
  cancelFindHighlights: (): Promise<void> => ipcRenderer.invoke("recording:cancel-find-highlights"),
  exportHighlightClip: (request: ExportHighlightClipRequest): Promise<HighlightClipExportResult> => ipcRenderer.invoke("recording:export-highlight-clip", request),
  exportAllHighlights: (request: ExportAllHighlightsRequest): Promise<HighlightClipExportResult> => ipcRenderer.invoke("recording:export-all-highlights", request),
  getAiKeyStatus: (): Promise<AiKeyStatus> => ipcRenderer.invoke("ai-key:status"),
  setAiKey: (key: string): Promise<void> => ipcRenderer.invoke("ai-key:set", key),
  clearAiKey: (): Promise<void> => ipcRenderer.invoke("ai-key:clear"),
  requestCameraAccess: (): Promise<boolean> => ipcRenderer.invoke("camera-capture:request-access"),
  requestMicrophoneAccess: (): Promise<boolean> => ipcRenderer.invoke("microphone-capture:request-access"),
  getSystemStats: (): Promise<SystemStats> => ipcRenderer.invoke("system-stats:get"),
  getProcessSnapshot: (): Promise<ProcessSnapshot> => ipcRenderer.invoke("system-stats:get-processes"),
  openActivityMonitor: (): Promise<boolean> => ipcRenderer.invoke("system-stats:open-activity-monitor"),
});
