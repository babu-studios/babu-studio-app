import type { AiArtifactsRequest, AiArtifactsResult, AiDubResult, AiKeyStatus, AiPreviewResult, AiSubtitleLanguage, AiSubtitleResult, ConvertMicWavRequest, DubPreviewRequest, ExportAiPreviewRequest, ExportAllHighlightsRequest, ExportHighlightClipRequest, ExportRecordingRequest, FindHighlightsRequest, FindHighlightsResult, HighlightClipExportResult, ListSubtitlesRequest, MediaCoreStatus, MicWavPreviewResult, MicWavResult, MicWavStatusResult, RecordingResult, RecordingSummary, StartDubRequest, StartDubResult, StartRecordingRequest, StartSubtitlesRequest, StartSubtitlesResult } from "./media";
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
      exportAiPreview(request: ExportAiPreviewRequest): Promise<AiPreviewResult>;
      getAiArtifacts(request: AiArtifactsRequest): Promise<AiArtifactsResult>;
      cancelAiPreview(): Promise<void>;
      exportAiShotClip(request: ExportAiPreviewRequest): Promise<AiPreviewResult>;
      cancelAiShotClipExport(): Promise<void>;
      generateAiShortClip(request: ExportAiPreviewRequest): Promise<AiPreviewResult>;
      cancelAiShortClip(): Promise<void>;
      findHighlights(request: FindHighlightsRequest): Promise<FindHighlightsResult>;
      cancelFindHighlights(): Promise<void>;
      exportHighlightClip(request: ExportHighlightClipRequest): Promise<HighlightClipExportResult>;
      exportAllHighlights(request: ExportAllHighlightsRequest): Promise<HighlightClipExportResult>;
      convertMicWav(request: ConvertMicWavRequest): Promise<MicWavResult>;
      micWavPreview(request: ConvertMicWavRequest): Promise<MicWavPreviewResult>;
      micWavStatus(request: ConvertMicWavRequest): Promise<MicWavStatusResult>;
      startSubtitles(request: StartSubtitlesRequest): Promise<StartSubtitlesResult>;
      cancelSubtitles(): Promise<void>;
      listSubtitles(request: ListSubtitlesRequest): Promise<AiSubtitleResult[]>;
      startDub(request: StartDubRequest): Promise<StartDubResult>;
      cancelDub(): Promise<void>;
      listDubs(request: ListSubtitlesRequest): Promise<AiDubResult[]>;
      dubPreview(request: DubPreviewRequest): Promise<MicWavPreviewResult>;
      getAiKeyStatus(): Promise<AiKeyStatus>;
      setAiKey(key: string): Promise<void>;
      clearAiKey(): Promise<void>;
      requestCameraAccess(): Promise<boolean>;
      requestMicrophoneAccess(): Promise<boolean>;
      getSystemStats(): Promise<SystemStats>;
      getProcessSnapshot(): Promise<ProcessSnapshot>;
      openActivityMonitor(): Promise<boolean>;
    };
  }
}

export {};
