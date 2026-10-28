import { StatusPill, stepTone } from "./AiStatus";
import type { AiDialogProps } from "../../types/export.types";

type AiHighlightsStepProps = Pick<
  AiDialogProps,
  "busy" | "loading" | "selectedAiSourceFile" | "aiShotExportPath"
  | "highlightsBusy" | "highlightsStage" | "highlightsClips" | "highlightsError"
  | "highlightsModel" | "highlightsAnalyzedAt" | "highlightsTimeError"
  | "exportingIndex" | "exportingAll" | "keyConfigured"
  | "onFindHighlights" | "onCancelFindHighlights" | "onUpdateHighlightTime"
  | "onExportHighlightClip" | "onExportAllHighlights"
> & {
  anyAiTaskBusy: boolean;
  highlightsExportBusy: boolean;
};

export function AiHighlightsStep(props: AiHighlightsStepProps) {
  const {
    busy,
    loading,
    selectedAiSourceFile,
    aiShotExportPath,
    highlightsBusy,
    highlightsStage,
    highlightsClips,
    highlightsError,
    highlightsModel,
    highlightsAnalyzedAt,
    highlightsTimeError,
    exportingIndex,
    exportingAll,
    keyConfigured,
    onFindHighlights,
    onCancelFindHighlights,
    onUpdateHighlightTime,
    onExportHighlightClip,
    onExportAllHighlights,
    anyAiTaskBusy,
    highlightsExportBusy,
  } = props;

  const highlightsLocked = !selectedAiSourceFile;
  const step2Tone = stepTone(highlightsBusy, highlightsClips.length > 0 ? aiShotExportPath : null, highlightsError, highlightsLocked);

  return (
    <li className={`ai-step ai-step--${step2Tone}`} aria-label="Step 2: AI highlight suggestions">
      <div className="ai-step-head">
        <span className="ai-step-number" aria-hidden="true">2</span>
        <div className="ai-step-copy">
          <strong>Find highlights</strong>
          <small>Cut from the original recording at full quality · each at least 30 seconds · confidence 70%+ · labelled as AI suggestions</small>
        </div>
        <StatusPill
          tone={step2Tone}
          label={
            highlightsBusy
              ? "Working…"
              : highlightsError
                ? "Failed"
                : highlightsClips.length > 0
                  ? `${highlightsClips.length} found`
                  : highlightsLocked
                    ? "Locked"
                    : "Ready"
          }
        />
      </div>
      {highlightsLocked && !anyAiTaskBusy && (
        <p className="ai-step-hint">Complete step 1 to unlock this step.</p>
      )}
      {!highlightsLocked && !keyConfigured && !anyAiTaskBusy && (
        <p className="ai-step-hint">Add your Model API key above to unlock analysis.</p>
      )}
      <div className="ai-step-actions">
        <button
          className="ai-step-button"
          type="button"
          disabled={busy || loading || highlightsLocked || anyAiTaskBusy || highlightsExportBusy || !keyConfigured}
          title={
            highlightsLocked
              ? "Generate the AI clip first"
              : !keyConfigured
                ? "Add your Model API key above first"
                : "Ask the model for highlight moments"
          }
          onClick={() => void onFindHighlights(selectedAiSourceFile)}
        >
          {highlightsBusy
            ? "Finding highlights…"
            : highlightsClips.length > 0
              ? "Find highlights again"
              : "Find highlights"}
        </button>
        {highlightsBusy && (
          <button
            className="ai-step-button ai-step-button--ghost"
            type="button"
            onClick={onCancelFindHighlights}
          >
            Cancel
          </button>
        )}
      </div>
      {highlightsBusy && highlightsStage && (
        <p className="ai-step-stage" role="status">{highlightsStage}</p>
      )}
      {highlightsModel && highlightsAnalyzedAt && highlightsClips.length > 0 && (
        <p className="ai-step-meta">
          <span>AI suggestion · {highlightsModel} · {new Date(highlightsAnalyzedAt).toLocaleString()}</span>
        </p>
      )}
      {highlightsError && <p className="export-picker-error" role="alert">{highlightsError}</p>}
      {highlightsTimeError && <p className="export-picker-error" role="alert">{highlightsTimeError}</p>}
      {highlightsClips.length > 0 && (
        <div className="ai-highlights">
          <ol className="ai-highlight-list">
            {highlightsClips.map((clip, index) => {
              return (
                <li key={`${clip.startTime.toFixed(3)}-${clip.endTime.toFixed(3)}-${index}`} className="ai-highlight">
                  <div className="ai-highlight-head">
                    <strong>{clip.title}</strong>
                    <span className="ai-highlight-category">{clip.category}</span>
                    <span className="ai-highlight-confidence" title="AI confidence score for this suggestion">Confidence {Math.round(clip.confidence * 100)}%</span>
                  </div>
                  <p className="ai-highlight-reason">{clip.reason}</p>
                  <div className="ai-highlight-times">
                    <label>
                      <span>Start (s)</span>
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        defaultValue={clip.startTime}
                        key={`start-${clip.startTime}`}
                        aria-label={`Highlight ${index + 1} start time in seconds`}
                        disabled={busy || highlightsBusy || highlightsExportBusy}
                        onBlur={(event) => onUpdateHighlightTime(index, "startTime", event.target.value)}
                      />
                    </label>
                    <label>
                      <span>End (s)</span>
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        defaultValue={clip.endTime}
                        key={`end-${clip.endTime}`}
                        aria-label={`Highlight ${index + 1} end time in seconds`}
                        disabled={busy || highlightsBusy || highlightsExportBusy}
                        onBlur={(event) => onUpdateHighlightTime(index, "endTime", event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="ai-step-actions">
                    <button
                      className="ai-step-button ai-step-button--ghost"
                      type="button"
                      disabled={busy || highlightsBusy || highlightsExportBusy}
                      onClick={() => void onExportHighlightClip(index)}
                    >
                      {exportingIndex === index ? "Exporting…" : clip.exportPath ? "Re-export clip" : "Export clip"}
                    </button>
                  </div>
                  {clip.exportPath && (
                    <p className="export-progress-path ai-step-path">
                      <span>Saved to</span>
                      <code>{clip.exportPath}</code>
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="ai-step-actions">
            <button
              className="ai-step-button"
              type="button"
              disabled={busy || highlightsBusy || highlightsExportBusy}
              onClick={() => void onExportAllHighlights()}
            >
              {exportingAll ? "Exporting all…" : "Export all highlights"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
