import { useRef, useState } from "react";
import type { PostProcessingState, RecordingExport } from "@shared/types/media";

export type RecordingNotice = { error: boolean; text: string };

export function useRecordingState() {
  const [recordingActive, setRecordingActive] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [recordingNotice, setRecordingNotice] = useState<RecordingNotice | null>(null);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [postProcessingState, setPostProcessingState] = useState<PostProcessingState>("NOT_STARTED");
  const [recordingExports, setRecordingExports] = useState<RecordingExport[]>([]);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const exportCancelRequestedRef = useRef(false);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingActionInFlightRef = useRef(false);

  return {
    recordingActive,
    setRecordingActive,
    recordingBusy,
    setRecordingBusy,
    recordingNotice,
    setRecordingNotice,
    recordingElapsedMs,
    setRecordingElapsedMs,
    postProcessingState,
    setPostProcessingState,
    recordingExports,
    setRecordingExports,
    exportDialogOpen,
    setExportDialogOpen,
    exportCancelRequestedRef,
    recordingStartedAtRef,
    recordingActionInFlightRef,
  };
}

export type RecordingState = ReturnType<typeof useRecordingState>;
