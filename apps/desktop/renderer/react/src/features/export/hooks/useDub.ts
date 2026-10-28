import { useEffect, useState } from "react";
import type { AiDubResult, AiSubtitleLanguage } from "@shared/types/media";

export function useDub(selectedRecordingId: string, recordingBusy: boolean) {
  const [dubBusy, setDubBusy] = useState(false);
  const [dubStage, setDubStage] = useState<string | null>(null);
  const [dubProgress, setDubProgress] = useState<number | null>(null);
  const [dubResults, setDubResults] = useState<AiDubResult[]>([]);
  const [dubError, setDubError] = useState<string | null>(null);

  useEffect(() => {
    setDubBusy(false);
    setDubStage(null);
    setDubProgress(null);
    setDubResults([]);
    setDubError(null);
    if (!selectedRecordingId || typeof window.babuStudio.listDubs !== "function") {
      return;
    }
    // Show every dubbed track already saved in the take, not just the last run.
    let cancelled = false;
    window.babuStudio.listDubs({ id: selectedRecordingId }).then((languages) => {
      if (!cancelled) {
        setDubResults(languages.map((language) => ({ ...language })));
      }
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedRecordingId]);

  // While the job runs the main process reports stage labels and per-cue
  // progress; poll them here (timeline assembly stays indeterminate).
  useEffect(() => {
    if (!dubBusy) {
      return;
    }
    let cancelled = false;
    const timer = window.setInterval(() => {
      window.babuStudio.getRecordingStatus().then((status) => {
        if (cancelled) {
          return;
        }
        const dub = status.aiDub;
        if (!dub) {
          return;
        }
        if (typeof dub.stage === "string") {
          setDubStage(dub.stage);
        }
        if (typeof dub.progress === "number") {
          setDubProgress(dub.progress);
        } else {
          setDubProgress(null);
        }
        if (dub.languages.length > 0) {
          setDubResults(dub.languages.map((language) => ({ ...language })));
        }
      }).catch(() => {});
    }, 500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [dubBusy]);

  async function startDub(languages: AiSubtitleLanguage[]): Promise<void> {
    if (recordingBusy || dubBusy || !selectedRecordingId || languages.length === 0) {
      return;
    }
    if (typeof window.babuStudio.startDub !== "function") {
      setDubError("Dubbed audio needs the latest app build. Restart the app and try again.");
      return;
    }
    setDubBusy(true);
    setDubStage("Starting dubbing…");
    setDubProgress(null);
    setDubResults([]);
    setDubError(null);
    try {
      const result = await window.babuStudio.startDub({ id: selectedRecordingId, languages });
      await refreshResults(result.languages);
      if (!result.success) {
        setDubError(result.error ?? "Unable to generate dubbed audio.");
      } else if (result.error) {
        setDubError(result.error);
      }
    } catch (error) {
      await refreshResults([]);
      setDubError(error instanceof Error ? error.message : "Unable to generate dubbed audio.");
    } finally {
      setDubBusy(false);
    }
  }

  // Disk is the source of truth: merge this run's rows (which may carry
  // per-language errors) over every dubbed wav already saved in the folder.
  async function refreshResults(runResults: AiDubResult[]): Promise<void> {
    if (typeof window.babuStudio.listDubs === "function") {
      try {
        const existing = await window.babuStudio.listDubs({ id: selectedRecordingId });
        const merged = new Map(existing.map((language) => [language.code, { ...language }]));
        for (const result of runResults) {
          merged.set(result.code, { ...result });
        }
        setDubResults([...merged.values()].sort((a, b) => a.code.localeCompare(b.code)));
        return;
      } catch {
        // Fall back to this run's rows when the folder cannot be read.
      }
    }
    setDubResults([...runResults].sort((a, b) => a.code.localeCompare(b.code)));
  }

  function cancelDub(): void {
    if (typeof window.babuStudio.cancelDub === "function") {
      void window.babuStudio.cancelDub().catch(() => {});
    }
  }

  return {
    dubBusy,
    dubStage,
    dubProgress,
    dubResults,
    dubError,
    startDub,
    cancelDub,
  };
}

export type Dub = ReturnType<typeof useDub>;
