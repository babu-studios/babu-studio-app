import { useEffect, useState } from "react";

export function useMicWav(selectedRecordingId: string, recordingBusy: boolean) {
  const [micWavBusy, setMicWavBusy] = useState(false);
  const [micWavPath, setMicWavPath] = useState<string | null>(null);
  const [micWavError, setMicWavError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    setMicWavBusy(false);
    setMicWavPath(null);
    setMicWavError(null);
    setPreviewUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
    setPreviewLoading(false);
    setPreviewError(null);
    if (!selectedRecordingId) {
      return;
    }
    // A wav converted earlier already unlocks the next step: show its path
    // with a re-generate option instead of demanding a fresh conversion.
    if (typeof window.babuStudio.micWavStatus !== "function") {
      return;
    }
    let cancelled = false;
    window.babuStudio.micWavStatus({ id: selectedRecordingId }).then((status) => {
      if (!cancelled && status.path) {
        setMicWavPath(status.path);
      }
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedRecordingId]);

  useEffect(() => () => {
    setPreviewUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
  }, []);

  async function convertMicWav(): Promise<void> {
    if (recordingBusy || micWavBusy || !selectedRecordingId) {
      return;
    }
    setMicWavBusy(true);
    setMicWavError(null);
    try {
      const result = await window.babuStudio.convertMicWav({ id: selectedRecordingId });
      if (result.success && result.path) {
        setMicWavPath(result.path);
      } else {
        setMicWavError(result.error ?? "Unable to convert microphone audio.");
      }
    } catch (error) {
      setMicWavError(error instanceof Error ? error.message : "Unable to convert microphone audio.");
    } finally {
      setMicWavBusy(false);
    }
  }

  async function loadPreview(): Promise<void> {
    if (recordingBusy || previewLoading || previewUrl || !selectedRecordingId) {
      return;
    }
    if (typeof window.babuStudio.micWavPreview !== "function") {
      setPreviewError("Audio preview needs the latest app build. Restart the app and try again.");
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await window.babuStudio.micWavPreview({ id: selectedRecordingId });
      if (result.success && result.data) {
        const bytes = new Uint8Array(result.data.byteLength);
        bytes.set(result.data);
        const blob = new Blob([bytes], { type: "audio/wav" });
        setPreviewUrl(URL.createObjectURL(blob));
      } else {
        setPreviewError(result.error ?? "Unable to load audio preview.");
      }
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Unable to load audio preview.");
    } finally {
      setPreviewLoading(false);
    }
  }

  return { micWavBusy, micWavPath, micWavError, convertMicWav, previewUrl, previewLoading, previewError, loadPreview };
}

export type MicWav = ReturnType<typeof useMicWav>;
