import { useEffect, useState } from "react";
import { Dropdown } from "@/components/common/Dropdown";
import { Icon } from "@/components/common/Icon";
import { formatRecordingLabel } from "@/features/studio/utils/recording-format";
import type { AiDialogProps } from "../types/export.types";

type StepTone = "idle" | "active" | "done" | "error" | "locked";

function stepTone(busy: boolean, path: string | null, error: string | null, locked: boolean): StepTone {
  if (busy) {
    return "active";
  }
  if (error) {
    return "error";
  }
  if (path) {
    return "done";
  }
  return locked ? "locked" : "idle";
}

function StatusPill({ tone, label }: { tone: StepTone; label: string }) {
  return <span className={`ai-step-pill ai-step-pill--${tone}`}>{label}</span>;
}

function AiProgress({ label, value, ariaLabel }: { label: string; value: number; ariaLabel: string }) {
  return (
    <div className="ai-progress">
      <div className="ai-progress-head">
        <span>{label}</span>
        <strong>{value}%</strong>
      </div>
      <div
        className="ai-progress-track"
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
      >
        <span style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function AiDialog({ dialog }: { dialog: AiDialogProps }) {
  const {
    open,
    setOpen,
    busy,
    loading,
    recordings,
    selectedRecordingId,
    setSelectedRecordingId,
    aiShotExportBusy,
    aiShotExportProgress,
    aiShotExportPath,
    aiShotExportError,
    onAiShotExport,
    onCancelAiShotExport,
    aiSourceFiles,
    selectedAiSourceFile,
    onSelectAiSourceFile,
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
    keySource,
    keyBusy,
    keyError,
    onRefreshKeyStatus,
    onSaveAiKey,
    onClearAiKey,
    onFindHighlights,
    onCancelFindHighlights,
    onUpdateHighlightTime,
    onExportHighlightClip,
    onExportAllHighlights,
  } = dialog;
  const highlightsExportBusy = exportingIndex !== null || exportingAll;
  // One AI job at a time: any running export, analysis, or clip export locks
  // every other AI button in this popup.
  const anyAiTaskBusy = aiShotExportBusy || highlightsBusy || highlightsExportBusy;
  const highlightsLocked = !selectedAiSourceFile;
  const [keyInput, setKeyInput] = useState("");
  useEffect(() => {
    if (open) {
      setKeyInput("");
      void onRefreshKeyStatus();
    }
  }, [open, onRefreshKeyStatus]);
  if (!open) {
    return null;
  }

  const step1Tone = stepTone(aiShotExportBusy, aiShotExportPath, aiShotExportError, false);
  const step1Progress = aiShotExportBusy ? aiShotExportProgress : aiShotExportPath ? 100 : 0;
  const step2Tone = stepTone(highlightsBusy, highlightsClips.length > 0 ? aiShotExportPath : null, highlightsError, highlightsLocked);

  return (
    <div className="export-progress-backdrop">
      <section
        className="export-progress-dialog ai-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-dialog-title"
        aria-describedby="ai-dialog-subtitle"
      >
        <div className="export-progress-heading ai-dialog-head">
          <div className="ai-dialog-title">
            <span className="ai-dialog-badge" aria-hidden="true">
              <Icon name="sparkle" />
            </span>
            <div>
              <span className="export-progress-kicker">AI</span>
              <h2 id="ai-dialog-title">AI clips</h2>
              <p id="ai-dialog-subtitle" className="ai-dialog-subtitle">
                Turn a recording into a short vertical clip in two steps.
              </p>
            </div>
          </div>
          <button
            className="export-progress-cancel"
            type="button"
            aria-label="Close AI dialog"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            <Icon name="close" />
          </button>
        </div>

        {loading ? (
          <p className="export-progress-description">Loading recordings…</p>
        ) : recordings.length === 0 ? (
          <p className="export-progress-description">No saved recordings found. Record something first.</p>
        ) : (
          <label className="export-resolution ai-dialog-recording">
            <span>Recording</span>
            <Dropdown
              value={selectedRecordingId}
              aria-label="Recording for AI"
              disabled={busy}
              onChange={(event) => setSelectedRecordingId(event.target.value)}
            >
              {recordings.map((entry) => (
                <option key={entry.id} value={entry.id}>{formatRecordingLabel(entry)}</option>
              ))}
            </Dropdown>
          </label>
        )}

        <section className="ai-key" aria-label="Model API key">
          <div className="ai-step-head">
            <div className="ai-step-copy">
              <strong>Model API key</strong>
              <small>
                {keyConfigured
                  ? keySource === "environment"
                    ? "Configured via the MODEL_API_KEY environment variable"
                    : "Stored encrypted in the OS keychain"
                  : "Stored encrypted in the OS keychain — never in the project"}
              </small>
            </div>
            <StatusPill tone={keyConfigured ? "done" : "idle"} label={keyConfigured ? "Saved" : "Missing"} />
          </div>
          {!keyConfigured && (
            <>
              <div className="ai-key-row">
                <input
                  className="ai-key-input"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Paste Model API key (LLM_…)"
                  aria-label="Model API key"
                  value={keyInput}
                  disabled={busy || keyBusy}
                  onChange={(event) => setKeyInput(event.target.value)}
                />
                <button
                  className="ai-step-button ai-key-save"
                  type="button"
                  disabled={busy || keyBusy || keyInput.trim().length === 0}
                  onClick={() => void onSaveAiKey(keyInput).then(() => setKeyInput(""))}
                >
                  {keyBusy ? "Saving…" : "Save"}
                </button>
              </div>
              {keyError && <p className="export-picker-error" role="alert">{keyError}</p>}
            </>
          )}
          {keyConfigured && keySource === "secure-storage" && (
            <div className="ai-step-actions">
              <button
                className="ai-step-button ai-step-button--ghost"
                type="button"
                disabled={busy || keyBusy}
                onClick={() => void onClearAiKey()}
              >
                {keyBusy ? "Removing…" : "Remove key"}
              </button>
            </div>
          )}
          {keyConfigured && keyError && (
            <p className="export-picker-error" role="alert">{keyError}</p>
          )}
        </section>

        {recordings.length > 0 && (
          <ol className="ai-steps">
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

            <li className={`ai-step ai-step--${step2Tone}`} aria-label="Step 2: AI highlight suggestions">
              <div className="ai-step-head">
                <span className="ai-step-number" aria-hidden="true">2</span>
                <div className="ai-step-copy">
                  <strong>Find highlights</strong>
                  <small>Cut from the original recording at full quality · each at least 30 seconds · labelled as AI suggestions</small>
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
                            <span className="ai-highlight-confidence">{Math.round(clip.confidence * 100)}%</span>
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
          </ol>
        )}
      </section>
    </div>
  );
}
