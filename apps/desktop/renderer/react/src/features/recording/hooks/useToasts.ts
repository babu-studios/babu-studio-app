import { useEffect, useState } from "react";
import type { PostProcessingState } from "@shared/types/media";
import type { RecordingNotice } from "./useRecordingState";

export type InfoToast = { text: string; tone: "success" | "error" };

export function useToasts(recordingNotice: RecordingNotice | null, postProcessingState: PostProcessingState) {
  const [infoToast, setInfoToast] = useState<InfoToast | null>(null);
  const [recordingErrorToast, setRecordingErrorToast] = useState<string | null>(null);

  useEffect(() => {
    if (!infoToast) {
      return;
    }
    const timer = window.setTimeout(() => setInfoToast(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [infoToast]);

  useEffect(() => {
    if (!recordingNotice?.error) {
      setRecordingErrorToast(null);
      return;
    }

    setRecordingErrorToast(recordingNotice.text);
    if (postProcessingState === "ERROR") {
      return;
    }

    const timer = window.setTimeout(() => setRecordingErrorToast(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [recordingNotice, postProcessingState]);


  return { infoToast, setInfoToast, recordingErrorToast, setRecordingErrorToast };
}
