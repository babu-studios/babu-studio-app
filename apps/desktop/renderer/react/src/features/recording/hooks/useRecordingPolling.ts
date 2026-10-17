import { useEffect } from "react";
import { formatRecordingExports } from "@/features/studio/utils/recording-format";
import type { InfoToast } from "./useToasts";
import type { RecordingState } from "./useRecordingState";

export function useRecordingPolling(
  state: RecordingState,
  setInfoToast: (toast: InfoToast | null) => void,
  stopRecording: () => Promise<void>,
) {
  const {
    recordingActive: isRecordingActive,
    postProcessingState,
    setPostProcessingState,
    setRecordingExports,
    setRecordingNotice,
    setExportDialogOpen,
    setRecordingElapsedMs,
    exportCancelRequestedRef,
    recordingStartedAtRef,
  } = state;

  useEffect(() => {
    if (!isRecordingActive && postProcessingState !== "PROCESSING") {
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const status = await window.babuStudio.getRecordingStatus();
        if (cancelled) {
          return;
        }
        if (status.postProcessingState) {
          setPostProcessingState(status.postProcessingState);
          if (status.postProcessingState === "PROCESSING" && !exportCancelRequestedRef.current) {
            setExportDialogOpen(true);
          }
          if (status.postProcessingState !== "PROCESSING") {
            exportCancelRequestedRef.current = false;
          }
          if (status.exports) {
            setRecordingExports(status.exports);
          }
          if (status.postProcessingState === "PROCESSING") {
            const currentExport = status.exports?.find((entry) => entry.state === "PROCESSING");
            setRecordingNotice({
              error: false,
              text: currentExport
                ? `Exporting ${currentExport.mode === "HORIZONTAL" ? "horizontal" : "vertical"} layout…`
                : "Preparing selected layout exports…",
            });
          } else if (status.postProcessingState === "COMPLETED") {
            setRecordingNotice({
              error: Boolean(status.error),
              text: status.error
                ? `${status.error} ${formatRecordingExports(status.exports)}`
                : `Selected layout exports saved: ${formatRecordingExports(status.exports)}`,
            });
          } else if (status.postProcessingState === "ERROR") {
            if (status.error?.includes("Export cancelled")) {
              setRecordingNotice(null);
              setInfoToast({ text: "Export cancelled. The source recording and project file were kept.", tone: "success" });
            } else {
              setRecordingNotice({
                error: true,
                text: `Export failed. The source recording was preserved. ${status.error ?? ""} ${formatRecordingExports(status.exports)}`.trim(),
              });
            }
          }
        }
        if (status.state === "ERROR" && isRecordingActive) {
          setRecordingNotice({ error: true, text: status.error ?? "Recording stopped unexpectedly." });
          await stopRecording();
        }
      } catch (error) {
        if (!cancelled) {
          setRecordingNotice({
            error: true,
            text: error instanceof Error ? `Unable to read recording status: ${error.message}` : "Unable to read recording status.",
          });
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isRecordingActive, postProcessingState]);

  useEffect(() => {
    if (!isRecordingActive || recordingStartedAtRef.current === null) {
      return;
    }
    const updateElapsed = () => {
      const startedAt = recordingStartedAtRef.current;
      if (startedAt !== null) {
        setRecordingElapsedMs(performance.now() - startedAt);
      }
    };
    const timer = window.setInterval(updateElapsed, 1000);
    updateElapsed();
    return () => window.clearInterval(timer);
  }, [isRecordingActive]);

}
