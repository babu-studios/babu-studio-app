import { useEffect, useState } from "react";
import { describeExportSelection } from "@/features/studio/utils/recording-format";
import type { useStudioConfiguration } from "@/features/studio/hooks/useStudioConfiguration";
import type { RecordingSummary } from "@shared/types/media";
import type { RecordingState } from "@/features/recording/hooks/useRecordingState";

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
  const [exportFreeBytes, setExportFreeBytes] = useState<number | null>(null);
  const [aiPreviewBusy, setAiPreviewBusy] = useState(false);
  const [aiPreviewProgress, setAiPreviewProgress] = useState(0);
  const [aiPreviewPath, setAiPreviewPath] = useState<string | null>(null);
  const [aiPreviewError, setAiPreviewError] = useState<string | null>(null);
  const [aiShotExportBusy, setAiShotExportBusy] = useState(false);
  const [aiShotExportProgress, setAiShotExportProgress] = useState(0);
  const [aiShotExportPath, setAiShotExportPath] = useState<string | null>(null);
  const [aiShotExportError, setAiShotExportError] = useState<string | null>(null);
  const [aiShortClipBusy, setAiShortClipBusy] = useState(false);
  const [aiShortClipProgress, setAiShortClipProgress] = useState(0);
  const [aiShortClipPath, setAiShortClipPath] = useState<string | null>(null);
  const [aiShortClipError, setAiShortClipError] = useState<string | null>(null);
  useEffect(() => {
    if (!exportPickerOpen) {
      return;
    }
    let cancelled = false;
    window.babuStudio.getSystemStats()
      .then((stats) => {
        if (!cancelled) {
          setExportFreeBytes(stats.disk.totalBytes > 0 ? stats.disk.freeBytes : null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExportFreeBytes(null);
        }
      });
    return () => { cancelled = true; };
  }, [exportPickerOpen]);

  useEffect(() => {
    setAiPreviewProgress(0);
    setAiPreviewPath(null);
    setAiPreviewError(null);
    setAiShotExportProgress(0);
    setAiShotExportPath(null);
    setAiShotExportError(null);
    setAiShortClipProgress(0);
    setAiShortClipPath(null);
    setAiShortClipError(null);
    setAiSourceFiles([]);
    setSelectedAiSourceFile(null);
  }, [selectedRecordingId]);

  const anyAiTaskBusy = aiPreviewBusy || aiShotExportBusy || aiShortClipBusy;
  const anyAiDialogOpen = exportPickerOpen || aiDialogOpen;
  useEffect(() => {
    if (!anyAiDialogOpen || !anyAiTaskBusy) {
      return;
    }
    let cancelled = false;
    const timer = window.setInterval(() => {
      window.babuStudio.getRecordingStatus().then((status) => {
        if (cancelled) {
          return;
        }
        if (typeof status.aiPreview?.progress === "number") {
          setAiPreviewProgress(status.aiPreview.progress);
        }
        if (typeof status.aiShotExport?.progress === "number") {
          setAiShotExportProgress(status.aiShotExport.progress);
        }
        if (typeof status.aiShortClip?.progress === "number") {
          setAiShortClipProgress(status.aiShortClip.progress);
        }
      }).catch(() => {});
    }, 500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [anyAiDialogOpen, anyAiTaskBusy]);

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

  // Restore Done state from files already on disk so a recording that was
  // exported before does not force a re-export when the dialog reopens.
  // Also restores the selectable AI source list and picks ai-360p.mp4 first.
  const [aiSourceFiles, setAiSourceFiles] = useState<string[]>([]);
  const [selectedAiSourceFile, setSelectedAiSourceFile] = useState<string | null>(null);

  async function refreshAiShotPath(): Promise<void> {
    if (!selectedRecordingId) {
      return;
    }
    try {
      const artifacts = await window.babuStudio.getAiArtifacts({ id: selectedRecordingId });
      setAiSourceFiles(artifacts.shotFiles);
      setSelectedAiSourceFile((current) => {
        if (current && artifacts.shotFiles.includes(current)) {
          return current;
        }
        return artifacts.shotFiles[0] ?? null;
      });
      if (artifacts.shotPath) {
        setAiShotExportPath(artifacts.shotPath);
        setAiShotExportProgress(100);
        setAiShotExportError(null);
      }
    } catch {
      // Keep the current in-memory state when the take cannot be read.
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

  async function startAiPreview(): Promise<void> {
    if (recordingActionInFlightRef.current || recordingBusy || aiPreviewBusy || !selectedRecordingId) {
      return;
    }
    recordingActionInFlightRef.current = true;
    setRecordingBusy(true);
    setAiPreviewBusy(true);
    setAiPreviewError(null);
    setAiPreviewPath(null);
    setAiPreviewProgress(0);
    try {
      const preview = await window.babuStudio.exportAiPreview({ id: selectedRecordingId });
      if (preview.success && preview.path) {
        setAiPreviewProgress(100);
        setAiPreviewPath(preview.path);
        setRecordingNotice({ error: false, text: `AI preview saved: ${preview.path}` });
      } else {
        setAiPreviewError(preview.error ?? "Unable to render the AI preview.");
      }
    } catch (error) {
      setAiPreviewError(error instanceof Error ? error.message : "Unable to render the AI preview.");
    } finally {
      recordingActionInFlightRef.current = false;
      setRecordingBusy(false);
      setAiPreviewBusy(false);
    }
  }

  function cancelAiPreview(): void {
    if (typeof window.babuStudio.cancelAiPreview === "function") {
      void window.babuStudio.cancelAiPreview().catch(() => {});
    }
  }

  async function startAiShotExport(): Promise<void> {
    if (recordingActionInFlightRef.current || recordingBusy || aiShotExportBusy || !selectedRecordingId) {
      return;
    }
    recordingActionInFlightRef.current = true;
    setRecordingBusy(true);
    setAiShotExportBusy(true);
    setAiShotExportError(null);
    setAiShotExportPath(null);
    setAiShotExportProgress(0);
    try {
      const shot = await window.babuStudio.exportAiShotClip({ id: selectedRecordingId });
      if (shot.success && shot.path) {
        setAiShotExportProgress(100);
        setAiShotExportPath(shot.path);
        setSelectedAiSourceFile("ai-360p.mp4");
        setAiSourceFiles((current) => (current.includes("ai-360p.mp4") ? current : ["ai-360p.mp4", ...current]));
        setRecordingNotice({ error: false, text: `AI 360p file saved: ${shot.path}` });
      } else {
        setAiShotExportError(shot.error ?? "Unable to export the AI 360p file.");
      }
    } catch (error) {
      setAiShotExportError(error instanceof Error ? error.message : "Unable to export the AI 360p file.");
    } finally {
      recordingActionInFlightRef.current = false;
      setRecordingBusy(false);
      setAiShotExportBusy(false);
    }
  }

  function cancelAiShotExport(): void {
    if (typeof window.babuStudio.cancelAiShotClipExport === "function") {
      void window.babuStudio.cancelAiShotClipExport().catch(() => {});
    }
  }

  async function startAiShortClip(): Promise<void> {
    if (recordingActionInFlightRef.current || recordingBusy || aiShortClipBusy || !selectedRecordingId) {
      return;
    }
    if (!aiShotExportPath) {
      setAiShortClipError("Export the AI 360p file first, then generate the short clip.");
      return;
    }
    recordingActionInFlightRef.current = true;
    setRecordingBusy(true);
    setAiShortClipBusy(true);
    setAiShortClipError(null);
    setAiShortClipPath(null);
    setAiShortClipProgress(0);
    try {
      const clip = await window.babuStudio.generateAiShortClip({ id: selectedRecordingId });
      if (clip.success && clip.path) {
        setAiShortClipProgress(100);
        setAiShortClipPath(clip.path);
        setRecordingNotice({ error: false, text: `AI short clip saved: ${clip.path}` });
      } else {
        setAiShortClipError(clip.error ?? "Unable to generate the AI short clip.");
      }
    } catch (error) {
      setAiShortClipError(error instanceof Error ? error.message : "Unable to generate the AI short clip.");
    } finally {
      recordingActionInFlightRef.current = false;
      setRecordingBusy(false);
      setAiShortClipBusy(false);
    }
  }

  function cancelAiShortClip(): void {
    if (typeof window.babuStudio.cancelAiShortClip === "function") {
      void window.babuStudio.cancelAiShortClip().catch(() => {});
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
    refreshAiShotPath,
    aiSourceFiles,
    selectedAiSourceFile,
    setSelectedAiSourceFile,
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
    aiPreviewBusy,
    aiPreviewProgress,
    aiPreviewPath,
    aiPreviewError,
    startAiPreview,
    cancelAiPreview,
    aiShotExportBusy,
    aiShotExportProgress,
    aiShotExportPath,
    aiShotExportError,
    startAiShotExport,
    cancelAiShotExport,
    aiShortClipBusy,
    aiShortClipProgress,
    aiShortClipPath,
    aiShortClipError,
    startAiShortClip,
    cancelAiShortClip,
  };
}
