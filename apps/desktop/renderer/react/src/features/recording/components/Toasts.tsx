import { Icon } from "@/components/common/Icon";
import type { PostProcessingState } from "@shared/types/media";
import type { InfoToast } from "../hooks/useToasts";

type ToastsProps = {
  infoToast: InfoToast | null;
  recordingErrorToast: string | null;
  postProcessingState: PostProcessingState;
  recordingBusy: boolean;
  onDismissInfo: () => void;
  onDismissError: () => void;
  onRetryExport: () => void;
};

export function Toasts({
  infoToast,
  recordingErrorToast,
  postProcessingState,
  recordingBusy,
  onDismissInfo,
  onDismissError,
  onRetryExport,
}: ToastsProps) {
  return (
    <div className="toast-stack">
      {infoToast && (
        <div className={`toast toast--${infoToast.tone}`} role="status">
          <span className="toast-icon" aria-hidden="true">{infoToast.tone === "success" ? "✓" : "!"}</span>
          <p className="toast-message">{infoToast.text}</p>
          <button className="toast-close" type="button" aria-label="Dismiss message" onClick={onDismissInfo}>
            <Icon name="close" />
          </button>
        </div>
      )}
      {recordingErrorToast && (
        <div className="toast toast--error" role="alert">
          <span className="toast-icon" aria-hidden="true">!</span>
          <p className="toast-message">{recordingErrorToast}</p>
          {postProcessingState === "ERROR" ? (
            <button className="toast-action" type="button" disabled={recordingBusy} onClick={onRetryExport}>
              Retry export
            </button>
          ) : (
            <button className="toast-close" type="button" aria-label="Dismiss error message" onClick={onDismissError}>
              <Icon name="close" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
