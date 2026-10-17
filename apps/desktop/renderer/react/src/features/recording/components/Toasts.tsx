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
    <>
    {infoToast && (
      <div className={`info-toast info-toast--${infoToast.tone}`} role="status">
        <span>{infoToast.text}</span>
        <button
          type="button"
          aria-label="Dismiss message"
          onClick={onDismissInfo}
        >
          <Icon name="close" />
        </button>
      </div>
    )}

    {recordingErrorToast && (
      <div className="recording-error-toast" role="alert">
        <span className="recording-error-toast-icon" aria-hidden="true">!</span>
        <p className="recording-error-toast-message">{recordingErrorToast}</p>
        {postProcessingState === "ERROR" ? (
          <button
            className="recording-error-toast-action"
            disabled={recordingBusy}
            onClick={onRetryExport}
          >
            Retry export
          </button>
        ) : (
          <button
            className="recording-error-toast-dismiss"
            aria-label="Dismiss error message"
            onClick={onDismissError}
          >
            ×
          </button>
        )}
      </div>
    )}
    </>
  );
}
