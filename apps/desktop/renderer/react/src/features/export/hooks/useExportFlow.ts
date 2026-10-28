import { useState } from "react";
import { describeExportSelection } from "@/features/studio/utils/recording-format";
import type { useStudioConfiguration } from "@/features/studio/hooks/useStudioConfiguration";
import type { RecordingSummary } from "@shared/types/media";
import type { RecordingState } from "@/features/recording/hooks/useRecordingState";
import { useAiMediaFlow } from "./useAiMediaFlow";
import { useAiSourceFiles } from "./useAiSourceFiles";
import { useExportDiskSpace } from "./useExportDiskSpace";

export function useExportFlow(
  state: RecordingState,
  config: ReturnType<typeof useStudioConfiguration>,
) {
  const {
    recordingBusy,
    setRecordingBusy,
    setRecordingNotice,
    postProcessingState,
    setPostProcessingState,
    recordingExports,
    setRecordingExports,
    setExportDialogOpen,
    exportCancelRequestedRef,
    recordingActionInFlightRef,
  } = state;
  const { exportModes, exportResolution } = config;
  const [exportPickerOpen, setExportPickerOpen] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [exportPickerLoading, setExportPickerLoading] = useState(false);
  const [exportPickerError, setExportPickerError] = useState<string | null>(null);
  const [savedRecordings, setSavedRecordings] = useState<RecordingSummary[]>([]);
  const [selectedRecordingId, setSelectedRecordingId] = useState("");
  const media = useAiMediaFlow({
    selectedRecordingId,
    recordingBusy,
    setRecordingBusy,
    recordingActionInFlightRef,
    setRecordingNotice,
    exportPickerOpen,
    aiDialogOpen,
    onShotComplete: () => sources.markShotExported(),
  });
  const sources = useAiSourceFiles({
    selectedRecordingId,
    onRestoreShotExport: media.restoreShotExport,
  });
  const { exportFreeBytes } = useExportDiskSpace(exportPickerOpen);

  function cancelExport(): void {
    exportCancelRequestedRef.current = true;
    setExportDialogOpen(false);
    const failCancel = () => {
      exportCancelRequestedRef.current = false;
      setExportDialogOpen(true);
      setRecordingNotice({
        error: true,
        text: "Cancel is unavailable in this running session. Restart Babu Studio to load the latest version.",
      });
    };
    if (typeof window.babuStudio.cancelRecordingExport !== "function") {
      failCancel();
      return;
    }
    void window.babuStudio.cancelRecordingExport().catch(failCancel);
  }


  const activeExport = recordingExports.find((entry) => entry.state === "PROCESSING");
  const exportsCompleted = postProcessingState === "COMPLETED";
  const overallExportProgress = exportsCompleted
    ? 100
    : recordingExports.length > 0
      ? Math.round(recordingExports.reduce((total, entry) => {
        const progress = entry.state === "COMPLETED"
          ? 100
          : entry.state === "PROCESSING"
            ? Math.max(0, Math.min(100, entry.progress ?? 0))
            : 0;
        return total + progress;
      }, 0) / recordingExports.length)
      : 0;

  async function refreshRecordings(): Promise<void> {
    const recordings = await window.babuStudio.listRecordings();
    setSavedRecordings(recordings);
    setSelectedRecordingId((current) => (
      recordings.some((entry) => entry.id === current) ? current : recordings[0]?.id ?? ""
    ));
  }

  async function openExportPicker(): Promise<void> {
    setExportPickerOpen(true);
    setExportPickerLoading(true);
    setExportPickerError(null);
    try {
      await refreshRecordings();
    } catch (error) {
      setExportPickerError(error instanceof Error ? error.message : "Unable to load recordings.");
    } finally {
      setExportPickerLoading(false);
    }
  }

  async function openAiDialog(): Promise<void> {
    setAiDialogOpen(true);
    setExportPickerLoading(true);
    setExportPickerError(null);
    try {
      await refreshRecordings();
    } catch (error) {
      setExportPickerError(error instanceof Error ? error.message : "Unable to load recordings.");
    } finally {
      setExportPickerLoading(false);
    }
  }

  async function startSelectedExport(): Promise<void> {
    if (recordingActionInFlightRef.current || recordingBusy || !selectedRecordingId) {
      return;
    }
    recordingActionInFlightRef.current = true;
    setRecordingBusy(true);
    setExportPickerError(null);
    try {
      exportCancelRequestedRef.current = false;
      const result = await window.babuStudio.exportRecording({
        id: selectedRecordingId,
        exportModes,
        exportResolution,
      });
      setPostProcessingState(result.postProcessingState ?? "PROCESSING");
      setRecordingExports(result.exports ?? []);
      setExportPickerOpen(false);
      setExportDialogOpen(true);
      setRecordingNotice({ error: false, text: `Exporting ${describeExportSelection(exportModes)}...` });
    } catch (error) {
      setExportPickerError(error instanceof Error ? error.message : "Unable to start the export.");
    } finally {
      recordingActionInFlightRef.current = false;
      setRecordingBusy(false);
    }
  }

  async function retryRecordingExport(): Promise<void> {
    if (recordingActionInFlightRef.current || recordingBusy || postProcessingState !== "ERROR") {
      return;
    }
    recordingActionInFlightRef.current = true;
    setRecordingBusy(true);
    try {
      const result = await window.babuStudio.retryRecordingExport();
      setPostProcessingState(result.postProcessingState ?? "PROCESSING");
      setRecordingExports(result.exports ?? []);
      setExportDialogOpen(true);
      setRecordingNotice({ error: false, text: "Export retry started. Your source recording remains available." });
    } catch (error) {
      setRecordingNotice({ error: true, text: error instanceof Error ? error.message : "Unable to retry the export." });
    } finally {
      recordingActionInFlightRef.current = false;
      setRecordingBusy(false);
    }
  }


  return {
    exportPickerOpen,
    setExportPickerOpen,
    aiDialogOpen,
    setAiDialogOpen,
    openAiDialog,
    refreshAiShotPath: sources.refreshAiShotPath,
    aiSourceFiles: sources.aiSourceFiles,
    selectedAiSourceFile: sources.selectedAiSourceFile,
    setSelectedAiSourceFile: sources.setSelectedAiSourceFile,
    exportPickerLoading,
    exportPickerError,
    savedRecordings,
    selectedRecordingId,
    setSelectedRecordingId,
    exportFreeBytes,
    activeExport,
    exportsCompleted,
    overallExportProgress,
    cancelExport,
    openExportPicker,
    startSelectedExport,
    retryRecordingExport,
    aiPreviewBusy: media.aiPreviewBusy,
    aiPreviewProgress: media.aiPreviewProgress,
    aiPreviewPath: media.aiPreviewPath,
    aiPreviewError: media.aiPreviewError,
    startAiPreview: media.startAiPreview,
    cancelAiPreview: media.cancelAiPreview,
    aiShotExportBusy: media.aiShotExportBusy,
    aiShotExportProgress: media.aiShotExportProgress,
    aiShotExportPath: media.aiShotExportPath,
    aiShotExportError: media.aiShotExportError,
    startAiShotExport: media.startAiShotExport,
    cancelAiShotExport: media.cancelAiShotExport,
    aiShortClipBusy: media.aiShortClipBusy,
    aiShortClipProgress: media.aiShortClipProgress,
    aiShortClipPath: media.aiShortClipPath,
    aiShortClipError: media.aiShortClipError,
    startAiShortClip: media.startAiShortClip,
    cancelAiShortClip: media.cancelAiShortClip,
  };
}
