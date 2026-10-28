import { ipcMain } from "electron";
import type { AiArtifactsRequest, ConvertMicWavRequest, ExportAiPreviewRequest, ExportAllHighlightsRequest, ExportHighlightClipRequest, ExportRecordingRequest, FindHighlightsRequest, ListSubtitlesRequest, StartRecordingRequest, StartSubtitlesRequest } from "@shared/types/media";
import type { MediaCoreService } from "../services/media-core.service";
import type { RecordingService } from "../services/recording.service";

export function registerMediaCoreIpc(mediaCore: MediaCoreService, recording: RecordingService): void {
  ipcMain.handle("media-core:get-status", () => mediaCore.getStatus());
  ipcMain.handle("recording:start", (_event, request: StartRecordingRequest) => recording.start(request));
  ipcMain.handle("recording:stop", () => recording.stop());
  ipcMain.handle("recording:status", () => recording.getStatus());
  ipcMain.handle("recording:list", () => recording.listRecordings());
  ipcMain.handle("recording:export", (_event, request: ExportRecordingRequest) => recording.exportRecording(request));
  ipcMain.handle("recording:retry-export", () => recording.retryPostProcessing());
  ipcMain.handle("recording:cancel-export", () => recording.cancelPostProcessing());
  ipcMain.handle("recording:export-ai-preview", (_event, request: ExportAiPreviewRequest) => recording.exportAiPreview(request));
  ipcMain.handle("recording:ai-artifacts", (_event, request: AiArtifactsRequest) => recording.getAiArtifacts(request));
  ipcMain.handle("recording:cancel-ai-preview", () => recording.cancelAiPreview());
  ipcMain.handle("recording:export-ai-shot", (_event, request: ExportAiPreviewRequest) => recording.exportAiShotClip(request));
  ipcMain.handle("recording:cancel-ai-shot", () => recording.cancelAiShotClipExport());
  ipcMain.handle("recording:generate-ai-short-clip", (_event, request: ExportAiPreviewRequest) => recording.generateAiShortClip(request));
  ipcMain.handle("recording:cancel-ai-short-clip", () => recording.cancelAiShortClip());
  ipcMain.handle("recording:find-highlights", (_event, request: FindHighlightsRequest) => recording.findHighlights(request));
  ipcMain.handle("recording:cancel-find-highlights", () => recording.cancelFindHighlights());
  ipcMain.handle("recording:convert-mic-wav", (_event, request: ConvertMicWavRequest) => recording.convertMicrophoneWav(request));
  ipcMain.handle("recording:mic-wav-preview", (_event, request: ConvertMicWavRequest) => recording.readMicrophoneWavPreview(request));
  ipcMain.handle("recording:mic-wav-status", (_event, request: ConvertMicWavRequest) => recording.getMicrophoneWavStatus(request));
  ipcMain.handle("recording:export-highlight-clip", (_event, request: ExportHighlightClipRequest) => recording.exportHighlightClip(request));
  ipcMain.handle("recording:export-all-highlights", (_event, request: ExportAllHighlightsRequest) => recording.exportAllHighlightClips(request));
  ipcMain.handle("recording:subtitles-start", (_event, request: StartSubtitlesRequest) => recording.startSubtitles(request));
  ipcMain.handle("recording:subtitles-cancel", () => recording.cancelSubtitles());
  ipcMain.handle("recording:subtitles-list", (_event, request: ListSubtitlesRequest) => recording.listSubtitles(request));
}
