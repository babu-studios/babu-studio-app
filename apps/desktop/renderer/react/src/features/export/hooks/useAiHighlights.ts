import { useCallback, useEffect, useState } from "react";
import type { AiHighlightSuggestion, AiKeyStatus } from "@shared/types/media";

export type EditableHighlight = AiHighlightSuggestion & {
  exportPath: string | null;
};

function toEditable(clips: AiHighlightSuggestion[]): EditableHighlight[] {
  return clips.map((clip) => ({ ...clip, exportPath: null }));
}

function parseTimeInput(raw: string): number | null {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function useAiHighlights(selectedRecordingId: string, recordingBusy: boolean) {
  const [highlightsBusy, setHighlightsBusy] = useState(false);
  const [highlightsStage, setHighlightsStage] = useState<string | null>(null);
  const [highlightsProgress, setHighlightsProgress] = useState<number | null>(null);
  const [highlightsClips, setHighlightsClips] = useState<EditableHighlight[]>([]);
  const [highlightsError, setHighlightsError] = useState<string | null>(null);
  const [highlightsModel, setHighlightsModel] = useState<string | null>(null);
  const [highlightsAnalyzedAt, setHighlightsAnalyzedAt] = useState<string | null>(null);
  const [highlightsTimeError, setHighlightsTimeError] = useState<string | null>(null);
  const [exportingIndex, setExportingIndex] = useState<number | null>(null);
  const [exportingAll, setExportingAll] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [exportCurrent, setExportCurrent] = useState(0);
  const [exportTotal, setExportTotal] = useState(0);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [keyStatus, setKeyStatus] = useState<AiKeyStatus | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    setHighlightsBusy(false);
    setHighlightsStage(null);
    setHighlightsProgress(null);
    setHighlightsClips([]);
    setHighlightsError(null);
    setHighlightsModel(null);
    setHighlightsAnalyzedAt(null);
    setHighlightsTimeError(null);
    setExportingIndex(null);
    setExportingAll(false);
    setExportProgress(null);
    setExportCurrent(0);
    setExportTotal(0);
    setPreviewIndex(null);
  }, [selectedRecordingId]);

  // While the model call is opaque the main process reports stage labels;
  // poll them here (indeterminate — no fabricated percentages).
  useEffect(() => {
    if (!highlightsBusy) {
      return;
    }
    let cancelled = false;
    const timer = window.setInterval(() => {
      window.babuStudio.getRecordingStatus().then((status) => {
        if (cancelled) {
          return;
        }
        const highlights = status.aiHighlights;
        if (highlights && typeof highlights.stage === "string") {
          setHighlightsStage(highlights.stage);
        }
        if (highlights && typeof highlights.progress === "number") {
          setHighlightsProgress(highlights.progress);
        } else {
          setHighlightsProgress(null);
        }
      }).catch(() => {});
    }, 500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [highlightsBusy]);

  async function findHighlights(sourceFile?: string | null): Promise<void> {
    if (recordingBusy || highlightsBusy || !selectedRecordingId) {
      return;
    }
    setHighlightsBusy(true);
    setHighlightsStage("Starting analysis…");
    setHighlightsProgress(null);
    setHighlightsError(null);
    setHighlightsTimeError(null);
    try {
      const result = await window.babuStudio.findHighlights({
        id: selectedRecordingId,
        ...(sourceFile ? { sourceFile } : {}),
      });
      if (result.success) {
        setHighlightsClips(toEditable(result.clips));
        setHighlightsModel(result.model);
        setHighlightsAnalyzedAt(result.analyzedAt);
        setHighlightsStage(null);
      } else {
        setHighlightsError(result.error ?? "Unable to find highlights.");
        setHighlightsStage(null);
      }
    } catch (error) {
      setHighlightsError(error instanceof Error ? error.message : "Unable to find highlights.");
      setHighlightsStage(null);
    } finally {
      setHighlightsBusy(false);
    }
  }

  function cancelFindHighlights(): void {
    if (typeof window.babuStudio.cancelFindHighlights === "function") {
      void window.babuStudio.cancelFindHighlights().catch(() => {});
    }
  }

  // Stable identity: AiDialog refetches status in an on-open effect, so a new
  // function every render would re-trigger the fetch (and clear the key input)
  // in an endless loop.
  const refreshKeyStatus = useCallback(async (): Promise<void> => {
    try {
      setKeyStatus(await window.babuStudio.getAiKeyStatus());
    } catch {
      setKeyStatus(null);
    }
  }, []);

  async function saveAiKey(key: string): Promise<void> {
    if (recordingBusy || keyBusy) {
      return;
    }
    const trimmed = key.trim();
    if (trimmed.length === 0) {
      setKeyError("Paste your Model API key first.");
      return;
    }
    setKeyBusy(true);
    setKeyError(null);
    try {
      await window.babuStudio.setAiKey(trimmed);
      await refreshKeyStatus();
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : "Unable to save the key.");
    } finally {
      setKeyBusy(false);
    }
  }

  // Restore persisted analysis (sidecar + verified export files) so a
  // recording analyzed before shows its suggestions without re-running AI.
  async function refreshPersistedHighlights(): Promise<void> {
    if (!selectedRecordingId) {
      return;
    }
    try {
      const artifacts = await window.babuStudio.getAiArtifacts({ id: selectedRecordingId });
      const saved = artifacts.highlights;
      if (saved && saved.clips.length > 0) {
        setHighlightsClips(saved.clips.map((clip) => ({ ...clip })));
        setHighlightsModel(saved.model);
        setHighlightsAnalyzedAt(saved.analyzedAt);
        setHighlightsError(null);
      }
    } catch {
      // Keep the current in-memory state when the take cannot be read.
    }
  }

  async function clearAiKey(): Promise<void> {
    if (recordingBusy || keyBusy) {
      return;
    }
    setKeyBusy(true);
    setKeyError(null);
    try {
      await window.babuStudio.clearAiKey();
      await refreshKeyStatus();
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : "Unable to remove the key.");
    } finally {
      setKeyBusy(false);
    }
  }

  function updateClipTime(index: number, field: "startTime" | "endTime", raw: string): void {
    const parsed = parseTimeInput(raw);
    if (parsed === null) {
      setHighlightsTimeError("Times must be numbers in seconds, 0 or greater.");
      return;
    }
    setHighlightsTimeError(null);
    setHighlightsClips((current) => current.map((clip, clipIndex) => {
      if (clipIndex !== index) {
        return clip;
      }
      const next = { ...clip, [field]: parsed };
      if (!(next.startTime < next.endTime)) {
        setHighlightsTimeError("The end time must be after the start time.");
        return clip;
      }
      return next;
    }));
  }

  // While an export runs the main process reports real FFmpeg percent per
  // clip; poll it here so the row shows a live bar instead of a dead label.
  const exportActive = exportingIndex !== null || exportingAll;
  useEffect(() => {
    if (!exportActive) {
      return;
    }
    let cancelled = false;
    const timer = window.setInterval(() => {
      window.babuStudio.getRecordingStatus().then((status) => {
        if (cancelled) {
          return;
        }
        const exporting = status.aiHighlightExport;
        if (!exporting) {
          return;
        }
        if (typeof exporting.progress === "number") {
          setExportProgress(exporting.progress);
        } else {
          setExportProgress(null);
        }
        setExportCurrent(exporting.current);
        setExportTotal(exporting.total);
      }).catch(() => {});
    }, 500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [exportActive]);

  async function exportHighlightClip(index: number): Promise<void> {
    const clip = highlightsClips[index];
    if (recordingBusy || exportingIndex !== null || exportingAll || !clip || !selectedRecordingId) {
      return;
    }
    setExportingIndex(index);
    setExportProgress(0);
    setExportCurrent(1);
    setExportTotal(1);
    setHighlightsError(null);
    try {
      const result = await window.babuStudio.exportHighlightClip({
        id: selectedRecordingId,
        index,
        startTime: clip.startTime,
        endTime: clip.endTime,
      });
      const path = result.paths[0] ?? null;
      setHighlightsClips((current) => current.map((entry, entryIndex) => (
        entryIndex === index ? { ...entry, exportPath: path } : entry
      )));
    } catch (error) {
      setHighlightsError(error instanceof Error ? error.message : "Unable to export the highlight.");
    } finally {
      setExportingIndex(null);
      setExportProgress(null);
    }
  }

  async function exportAllHighlights(): Promise<void> {
    if (recordingBusy || exportingIndex !== null || exportingAll || highlightsClips.length === 0 || !selectedRecordingId) {
      return;
    }
    setExportingAll(true);
    setExportProgress(0);
    setExportCurrent(0);
    setExportTotal(highlightsClips.length);
    setHighlightsError(null);
    try {
      const result = await window.babuStudio.exportAllHighlights({
        id: selectedRecordingId,
        clips: highlightsClips.map(({ exportPath: _ignored, ...clip }) => clip),
      });
      setHighlightsClips((current) => current.map((clip, index) => ({
        ...clip,
        exportPath: result.paths[index] ?? clip.exportPath,
      })));
    } catch (error) {
      setHighlightsError(error instanceof Error ? error.message : "Unable to export the highlights.");
    } finally {
      setExportingAll(false);
      setExportProgress(null);
    }
  }

  return {
    highlightsBusy,
    highlightsStage,
    highlightsProgress,
    highlightsClips,
    highlightsError,
    highlightsModel,
    highlightsAnalyzedAt,
    highlightsTimeError,
    exportingIndex,
    exportingAll,
    exportProgress,
    exportCurrent,
    exportTotal,
    previewIndex,
    setPreviewIndex,
    keyStatus,
    keyBusy,
    keyError,
    refreshKeyStatus,
    saveAiKey,
    clearAiKey,
    refreshPersistedHighlights,
    findHighlights,
    cancelFindHighlights,
    updateClipTime,
    exportHighlightClip,
    exportAllHighlights,
  };
}

export type AiHighlights = ReturnType<typeof useAiHighlights>;
