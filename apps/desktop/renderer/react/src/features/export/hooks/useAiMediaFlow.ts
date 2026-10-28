import { useEffect, useState } from "react";
import type { RecordingState } from "@/features/recording/hooks/useRecordingState";

export function useAiMediaFlow(args: {
  selectedRecordingId: string;
  recordingBusy: boolean;
  setRecordingBusy: RecordingState["setRecordingBusy"];
  recordingActionInFlightRef: RecordingState["recordingActionInFlightRef"];
  setRecordingNotice: RecordingState["setRecordingNotice"];
  exportPickerOpen: boolean;
  aiDialogOpen: boolean;
  onShotComplete: () => void;
}) {
  const {
    selectedRecordingId,
    recordingBusy,
    setRecordingBusy,
    recordingActionInFlightRef,
    setRecordingNotice,
    exportPickerOpen,
    aiDialogOpen,
    onShotComplete,
  } = args;
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
    setAiPreviewProgress(0);
    setAiPreviewPath(null);
    setAiPreviewError(null);
    setAiShotExportProgress(0);
    setAiShotExportPath(null);
    setAiShotExportError(null);
    setAiShortClipProgress(0);
    setAiShortClipPath(null);
    setAiShortClipError(null);
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

  function restoreShotExport(shotPath: string): void {
    setAiShotExportPath(shotPath);
    setAiShotExportProgress(100);
    setAiShotExportError(null);
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
        onShotComplete();
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

  return {
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
    restoreShotExport,
  };
}
