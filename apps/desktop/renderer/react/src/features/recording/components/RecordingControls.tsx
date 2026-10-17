import { Icon } from "@/components/common/Icon";
import { formatRecordingTime } from "@/features/studio/utils/recording-format";
import type { PostProcessingState } from "@shared/types/media";
import type { RecordingNotice } from "../hooks/useRecordingState";

type RecordingControlsProps = {
  recordingActive: boolean;
  recordingBusy: boolean;
  recordingNotice: RecordingNotice | null;
  recordingElapsedMs: number;
  postProcessingState: PostProcessingState;
  onOpenExport: () => void;
  onStart: () => void;
  onStop: () => void;
};

export function RecordingControls({
  recordingActive,
  recordingBusy,
  recordingNotice,
  recordingElapsedMs,
  postProcessingState,
  onOpenExport,
  onStart,
  onStop,
}: RecordingControlsProps) {
  const exporting = postProcessingState === "PROCESSING";
  const showNotice = Boolean(
    recordingNotice && !recordingNotice.error && !exporting && postProcessingState !== "COMPLETED",
  );

  return (
    <>
      <button
        className="action-button action-button--export"
        disabled={recordingBusy || recordingActive || exporting}
        title="Choose a saved recording to export"
        onClick={onOpenExport}
      >
        <Icon name="export" />
        Export
      </button>
      <button
        className={`action-button action-button--record${recordingActive ? " action-button--recording" : ""}`}
        disabled={recordingBusy || exporting}
        title={recordingActive ? "Stop the current recording" : "Record the shared scene"}
        onClick={recordingActive ? onStop : onStart}
      >
        <Icon name="record" />
        {recordingActive ? "Stop Recording" : "Start Recording"}
      </button>
      {(recordingActive || showNotice) && (
        <div className="recording-inline-status" aria-live="polite">
          {recordingActive && <strong className="recording-timer">{formatRecordingTime(recordingElapsedMs)}</strong>}
          {showNotice && recordingNotice && <span className="record-notice">{recordingNotice.text}</span>}
        </div>
      )}
    </>
  );
}
