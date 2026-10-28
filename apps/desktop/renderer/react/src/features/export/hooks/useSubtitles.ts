import { useEffect, useState } from "react";
import type { AiSubtitleLanguage, AiSubtitleResult } from "@shared/types/media";

export function useSubtitles(selectedRecordingId: string, recordingBusy: boolean) {
  const [subtitlesBusy, setSubtitlesBusy] = useState(false);
  const [subtitlesStage, setSubtitlesStage] = useState<string | null>(null);
  const [subtitlesProgress, setSubtitlesProgress] = useState<number | null>(null);
  const [subtitlesResults, setSubtitlesResults] = useState<AiSubtitleResult[]>([]);
  const [subtitlesError, setSubtitlesError] = useState<string | null>(null);

  useEffect(() => {
    setSubtitlesBusy(false);
    setSubtitlesStage(null);
    setSubtitlesProgress(null);
    setSubtitlesResults([]);
    setSubtitlesError(null);
    if (!selectedRecordingId || typeof window.babuStudio.listSubtitles !== "function") {
      return;
    }
    // Show everything already generated for this take, not just the last run.
    let cancelled = false;
    window.babuStudio.listSubtitles({ id: selectedRecordingId }).then((languages) => {
      if (!cancelled) {
        setSubtitlesResults(languages.map((language) => ({ ...language })));
      }
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedRecordingId]);

  // While the job runs the main process reports stage labels and upload
  // progress; poll them here (analysis and translation stay indeterminate).
  useEffect(() => {
    if (!subtitlesBusy) {
      return;
    }
    let cancelled = false;
    const timer = window.setInterval(() => {
      window.babuStudio.getRecordingStatus().then((status) => {
        if (cancelled) {
          return;
        }
        const subtitles = status.aiSubtitles;
        if (!subtitles) {
          return;
        }
        if (typeof subtitles.stage === "string") {
          setSubtitlesStage(subtitles.stage);
        }
        if (typeof subtitles.progress === "number") {
          setSubtitlesProgress(subtitles.progress);
        } else {
          setSubtitlesProgress(null);
        }
        if (subtitles.languages.length > 0) {
          setSubtitlesResults(subtitles.languages.map((language) => ({ ...language })));
        }
      }).catch(() => {});
    }, 500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [subtitlesBusy]);

  async function startSubtitles(languages: AiSubtitleLanguage[]): Promise<void> {
    if (recordingBusy || subtitlesBusy || !selectedRecordingId || languages.length === 0) {
      return;
    }
    setSubtitlesBusy(true);
    setSubtitlesStage("Starting subtitles…");
    setSubtitlesProgress(null);
    setSubtitlesResults([]);
    setSubtitlesError(null);
    try {
      const result = await window.babuStudio.startSubtitles({ id: selectedRecordingId, languages });
      await refreshResults(result.languages);
      if (!result.success) {
        setSubtitlesError(result.error ?? "Unable to generate subtitles.");
      } else if (result.error) {
        setSubtitlesError(result.error);
      }
    } catch (error) {
      await refreshResults([]);
      setSubtitlesError(error instanceof Error ? error.message : "Unable to generate subtitles.");
    } finally {
      setSubtitlesBusy(false);
    }
  }

  // Disk is the source of truth: merge this run's rows (which may carry
  // per-language errors) over every .srt already saved in the take folder.
  async function refreshResults(runResults: AiSubtitleResult[]): Promise<void> {
    if (typeof window.babuStudio.listSubtitles === "function") {
      try {
        const existing = await window.babuStudio.listSubtitles({ id: selectedRecordingId });
        const merged = new Map(existing.map((language) => [language.code, { ...language }]));
        for (const result of runResults) {
          merged.set(result.code, { ...result });
        }
        setSubtitlesResults([...merged.values()].sort((a, b) => a.code.localeCompare(b.code)));
        return;
      } catch {
        // Fall back to this run's rows when the folder cannot be read.
      }
    }
    setSubtitlesResults([...runResults].sort((a, b) => a.code.localeCompare(b.code)));
  }

  function cancelSubtitles(): void {
    if (typeof window.babuStudio.cancelSubtitles === "function") {
      void window.babuStudio.cancelSubtitles().catch(() => {});
    }
  }

  return {
    subtitlesBusy,
    subtitlesStage,
    subtitlesProgress,
    subtitlesResults,
    subtitlesError,
    startSubtitles,
    cancelSubtitles,
  };
}

export type Subtitles = ReturnType<typeof useSubtitles>;
