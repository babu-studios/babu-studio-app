import { Icon } from "@/components/common/Icon";
import { formatRecordingTime } from "@/features/studio/utils/recording-format";
import type { PostProcessingState } from "@shared/types/media";

type RecordingControlsProps = {
  recordingActive: boolean;
  recordingBusy: boolean;
  recordingElapsedMs: number;
  postProcessingState: PostProcessingState;
  exportLocked: boolean;
  onOpenExport: () => void;
  onOpenAi: () => void;
  onStart: () => void;
  onStop: () => void;
};

export function RecordingControls({
  recordingActive,
  recordingBusy,
  recordingElapsedMs,
  postProcessingState,
  exportLocked,
  onOpenExport,
  onOpenAi,
  onStart,
  onStop,
}: RecordingControlsProps) {
  const exporting = postProcessingState === "PROCESSING";
  return (
    <>
      <button
        className="action-button action-button--export"
        disabled={recordingBusy || recordingActive || exporting || exportLocked}
        title={exportLocked ? "Wait for the highlight export to finish" : "Choose a saved recording to export"}
        onClick={onOpenExport}
      >
        <Icon name="export" />
        Export
      </button>
      <button
        className="action-button action-button--ai"
        disabled={recordingBusy || recordingActive || exporting}
        title="Open AI clips for a saved recording"
        onClick={onOpenAi}
      >
        <Icon name="sparkle" />
        AI
      </button>
      <button
        className={`action-button action-button--record${recordingActive ? " action-button--recording" : ""}`}
        disabled={recordingBusy || exporting}
        title={recordingActive ? "Stop the current recording" : "Record the shared scene"}
        onClick={recordingActive ? onStop : onStart}
      >
        <Icon name="record" />
        {recordingActive ? "Stop Recording" : "Start Recording"}
        {recordingActive && (
          <span className="recording-timer" aria-live="off">{formatRecordingTime(recordingElapsedMs)}</span>
        )}
      </button>
    </>
  );
}
