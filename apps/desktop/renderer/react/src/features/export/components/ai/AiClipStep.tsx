import { Dropdown } from "@/components/common/Dropdown";
import { AiProgress, StatusPill, stepTone } from "./AiStatus";
import type { AiDialogProps } from "../../types/export.types";

type AiClipStepProps = Pick<
  AiDialogProps,
  "busy" | "loading" | "selectedRecordingId"
  | "aiShotExportBusy" | "aiShotExportProgress" | "aiShotExportPath" | "aiShotExportError"
  | "onAiShotExport" | "onCancelAiShotExport"
  | "aiSourceFiles" | "selectedAiSourceFile" | "onSelectAiSourceFile"
> & {
  anyAiTaskBusy: boolean;
};

export function AiClipStep(props: AiClipStepProps) {
  const {
    busy,
    loading,
    selectedRecordingId,
    aiShotExportBusy,
    aiShotExportProgress,
    aiShotExportPath,
    aiShotExportError,
    onAiShotExport,
    onCancelAiShotExport,
    aiSourceFiles,
    selectedAiSourceFile,
    onSelectAiSourceFile,
    anyAiTaskBusy,
  } = props;

  const step1Tone = stepTone(aiShotExportBusy, aiShotExportPath, aiShotExportError, false);
  const step1Progress = aiShotExportBusy ? aiShotExportProgress : aiShotExportPath ? 100 : 0;

  return (
    <li className={`ai-step ai-step--${step1Tone}`} aria-label="Step 1: clip for AI">
      <div className="ai-step-head">
        <span className="ai-step-number" aria-hidden="true">1</span>
        <div className="ai-step-copy">
          <strong>Generate clip for AI</strong>
          <small>Lightweight 360p vertical file for AI handoff · 360 × 640, 30 fps</small>
        </div>
        <StatusPill
          tone={step1Tone}
          label={
            aiShotExportBusy
              ? `${aiShotExportProgress}%`
              : aiShotExportError
                ? "Failed"
                : aiShotExportPath
                  ? "Done"
                  : "Ready"
          }
        />
      </div>
      <div className="ai-step-actions">
        <button
          className="ai-step-button"
          type="button"
          disabled={busy || loading || !selectedRecordingId || anyAiTaskBusy}
          onClick={() => void onAiShotExport()}
        >
          {aiShotExportBusy
            ? "Generating AI clip…"
            : aiShotExportPath
              ? "Regenerate clip for AI (360p)"
              : "Generate clip for AI (360p)"}
        </button>
        {aiShotExportBusy && (
          <button
            className="ai-step-button ai-step-button--ghost"
            type="button"
            onClick={onCancelAiShotExport}
          >
            Cancel
          </button>
        )}
      </div>
      {(aiShotExportBusy || aiShotExportPath) && (
        <AiProgress label="AI 360p file" value={step1Progress} ariaLabel="AI 360p export progress" />
      )}
      {aiShotExportPath && (
        <p className="export-progress-path ai-step-path">
          <span>Saved to</span>
          <code>{aiShotExportPath}</code>
        </p>
      )}
      {aiShotExportError && <p className="export-picker-error" role="alert">{aiShotExportError}</p>}
      {aiSourceFiles.length > 0 && (
        <label className="export-resolution ai-source-select">
          <span>Or select a generated clip</span>
          <Dropdown
            value={selectedAiSourceFile ?? ""}
            aria-label="Generated clip for AI"
            disabled={busy || loading || anyAiTaskBusy}
            onChange={(event) => onSelectAiSourceFile(event.target.value)}
          >
            {aiSourceFiles.map((file) => (
              <option key={file} value={file}>{file}</option>
            ))}
          </Dropdown>
        </label>
      )}
    </li>
  );
}
