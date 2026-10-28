import { useEffect, useRef, useState } from "react";
import { Dropdown } from "@/components/common/Dropdown";
import { Icon } from "@/components/common/Icon";
import { formatRecordingLabel } from "@/features/studio/utils/recording-format";
import type { AiDialogProps } from "../types/export.types";

type StepTone = "idle" | "active" | "done" | "error" | "locked";
type AiStepId = "setup" | "clip" | "highlights" | "micwav" | "audio";

const STEPS: Array<{ id: AiStepId; label: string }> = [
  { id: "setup", label: "Setup" },
  { id: "clip", label: "AI clip" },
  { id: "highlights", label: "Highlights" },
  { id: "micwav", label: "Mic WAV" },
  { id: "audio", label: "Audio" },
];

const AUDIO_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "ru", label: "Russian" },
  { code: "zh", label: "Chinese (Mandarin)" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "ar", label: "Arabic" },
  { code: "tr", label: "Turkish" },
  { code: "pl", label: "Polish" },
  { code: "sv", label: "Swedish" },
  { code: "no", label: "Norwegian" },
  { code: "da", label: "Danish" },
  { code: "fi", label: "Finnish" },
  { code: "el", label: "Greek" },
  { code: "cs", label: "Czech" },
  { code: "sk", label: "Slovak" },
  { code: "ro", label: "Romanian" },
  { code: "hu", label: "Hungarian" },
  { code: "bg", label: "Bulgarian" },
  { code: "hr", label: "Croatian" },
  { code: "sr", label: "Serbian" },
  { code: "uk", label: "Ukrainian" },
  { code: "be", label: "Belarusian" },
  { code: "he", label: "Hebrew" },
  { code: "th", label: "Thai" },
  { code: "vi", label: "Vietnamese" },
  { code: "id", label: "Indonesian" },
  { code: "ms", label: "Malay" },
  { code: "fil", label: "Filipino" },
  { code: "bn", label: "Bengali" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "mr", label: "Marathi" },
  { code: "gu", label: "Gujarati" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
  { code: "pa", label: "Punjabi" },
  { code: "ur", label: "Urdu" },
  { code: "fa", label: "Persian" },
  { code: "ps", label: "Pashto" },
  { code: "ku", label: "Kurdish" },
  { code: "ne", label: "Nepali" },
  { code: "si", label: "Sinhala" },
  { code: "km", label: "Khmer" },
  { code: "lo", label: "Lao" },
  { code: "my", label: "Burmese" },
  { code: "mn", label: "Mongolian" },
  { code: "kk", label: "Kazakh" },
  { code: "uz", label: "Uzbek" },
  { code: "az", label: "Azerbaijani" },
  { code: "ka", label: "Georgian" },
  { code: "hy", label: "Armenian" },
  { code: "lt", label: "Lithuanian" },
  { code: "lv", label: "Latvian" },
  { code: "et", label: "Estonian" },
  { code: "sl", label: "Slovenian" },
  { code: "ca", label: "Catalan" },
  { code: "cy", label: "Welsh" },
  { code: "ga", label: "Irish" },
  { code: "mt", label: "Maltese" },
  { code: "is", label: "Icelandic" },
  { code: "sq", label: "Albanian" },
  { code: "mk", label: "Macedonian" },
  { code: "sw", label: "Swahili" },
  { code: "zu", label: "Zulu" },
  { code: "af", label: "Afrikaans" },
  { code: "am", label: "Amharic" },
  { code: "ha", label: "Hausa" },
  { code: "yo", label: "Yoruba" },
  { code: "ig", label: "Igbo" },
  { code: "so", label: "Somali" },
].sort((a, b) => a.label.localeCompare(b.label));

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

function formatClipLength(startTime: number, endTime: number): string {
  const total = Math.max(0, endTime - startTime);
  const rounded = Math.round(total * 10) / 10;
  if (rounded >= 60) {
    const minutes = Math.floor(rounded / 60);
    const seconds = Math.floor(rounded % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}s`;
}

function AiProgress({ label, value, ariaLabel, indeterminate = false }: {
  label: string;
  value: number;
  ariaLabel: string;
  indeterminate?: boolean;
}) {
  return (
    <div className={indeterminate ? "ai-progress ai-progress--indeterminate" : "ai-progress"}>
      <div className="ai-progress-head">
        <span role="status">{label}</span>
        {!indeterminate && <strong>{value}%</strong>}
      </div>
      <div
        className="ai-progress-track"
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : value}
      >
        <span style={indeterminate ? undefined : { width: `${value}%` }} />
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
    highlightsProgress,
    highlightsClips,
    highlightsError,
    highlightsTimeError,
    onErrorToast,
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
    micWavBusy,
    micWavPath,
    micWavError,
    onConvertMicWav,
    micPreviewUrl,
    micPreviewLoading,
    micPreviewError,
    onLoadMicPreview,
    subtitlesBusy,
    subtitlesStage,
    subtitlesProgress,
    subtitlesResults,
    subtitlesError,
    onStartSubtitles,
    onCancelSubtitles,
  } = dialog;
  const highlightsExportBusy = exportingIndex !== null || exportingAll;
  // One AI job at a time: any running export, analysis, or clip export locks
  // every other AI button in this popup.
  const anyAiTaskBusy = aiShotExportBusy || highlightsBusy || highlightsExportBusy || micWavBusy || subtitlesBusy;
  const clipReady = aiShotExportPath !== null || selectedAiSourceFile !== null;
  const highlightsLocked = !clipReady;
  const [activeStep, setActiveStep] = useState<AiStepId>("setup");
  const [keyInput, setKeyInput] = useState("");
  const [keyEditing, setKeyEditing] = useState(false);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(["en"]);
  const rowAudioRef = useRef<HTMLAudioElement | null>(null);
  const [playingCode, setPlayingCode] = useState<string | null>(null);
  const pendingPlayCode = useRef<string | null>(null);
  useEffect(() => {
    if (open) {
      setKeyInput("");
      setKeyEditing(false);
      setActiveStep("setup");
      void onRefreshKeyStatus();
    }
  }, [open, onRefreshKeyStatus]);
  // AI errors always surface as toasts (once per distinct message), never inline.
  const toastedErrors = useRef<Set<string>>(new Set());
  useEffect(() => {
    const texts = [aiShotExportError, highlightsError, highlightsTimeError, keyError, micWavError, subtitlesError, micPreviewError]
      .filter((text): text is string => typeof text === "string" && text.length > 0);
    if (texts.length === 0) {
      toastedErrors.current.clear();
      return;
    }
    for (const text of texts) {
      if (!toastedErrors.current.has(text)) {
        toastedErrors.current.add(text);
        onErrorToast(text);
      }
    }
  }, [aiShotExportError, highlightsError, highlightsTimeError, keyError, micWavError, subtitlesError, micPreviewError, onErrorToast]);
  if (!open) {
    return null;
  }

  const micWavTone = stepTone(micWavBusy, micWavPath, micWavError, false);
  const audioTone = stepTone(subtitlesBusy, subtitlesResults.length > 0 ? "done" : null, subtitlesError, false);
  const step1Tone = stepTone(aiShotExportBusy, aiShotExportPath, aiShotExportError, false);
  const step1Progress = aiShotExportBusy ? aiShotExportProgress : aiShotExportPath ? 100 : 0;
  const step2Tone = stepTone(highlightsBusy, highlightsClips.length > 0 ? aiShotExportPath : null, highlightsError, highlightsLocked);

  function isStepLocked(step: AiStepId): boolean {
    if (step === "clip" || step === "micwav") {
      return recordings.length === 0;
    }
    if (step === "highlights") {
      return highlightsLocked;
    }
    if (step === "audio") {
      return !micWavPath;
    }
    return false;
  }

  function stepState(step: AiStepId): StepTone {
    if (isStepLocked(step)) {
      return "locked";
    }
    if (step === "setup") {
      return selectedRecordingId ? "done" : "idle";
    }
    if (step === "clip") {
      return step1Tone;
    }
    if (step === "highlights") {
      return step2Tone;
    }
    if (step === "micwav") {
      return micWavTone;
    }
    if (step === "audio") {
      return audioTone;
    }
    return "idle";
  }

  function goToStep(step: AiStepId): void {
    if (!isStepLocked(step)) {
      setActiveStep(step);
    }
  }

  const activeIndex = STEPS.findIndex((step) => step.id === activeStep);
  const nextStep = STEPS.slice(activeIndex + 1).find((step) => !isStepLocked(step.id)) ?? null;
  const prevStep = [...STEPS.slice(0, activeIndex)].reverse().find((step) => !isStepLocked(step.id)) ?? null;

  function toggleLanguage(code: string): void {
    setSelectedLanguages((current) => (
      current.includes(code) ? current.filter((entry) => entry !== code) : [...current, code]
    ));
  }

  // One shared element previews the take's microphone audio behind every
  // subtitle row; loading happens on first play.
  useEffect(() => {
    if (!micPreviewUrl) {
      pendingPlayCode.current = null;
      setPlayingCode(null);
      return;
    }
    const code = pendingPlayCode.current;
    pendingPlayCode.current = null;
    if (code && rowAudioRef.current) {
      rowAudioRef.current.play().then(() => {
        setPlayingCode(code);
      }).catch(() => {});
    }
  }, [micPreviewUrl]);

  async function toggleRowAudio(code: string): Promise<void> {
    const element = rowAudioRef.current;
    if (playingCode === code) {
      element?.pause();
      setPlayingCode(null);
      return;
    }
    if (!micPreviewUrl) {
      pendingPlayCode.current = code;
      await onLoadMicPreview();
      return;
    }
    if (element) {
      try {
        await element.play();
        setPlayingCode(code);
      } catch {
        // Playback was interrupted; the pause handler clears the state.
      }
    }
  }

  function closeKeyEditor(): void {
    setKeyInput("");
    setKeyEditing(false);
  }

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
              <h2 id="ai-dialog-title">AI clips</h2>
              <p id="ai-dialog-subtitle" className="ai-dialog-subtitle">
                Turn a recording into short clips in five guided steps.
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

        <div className="ai-stepper-bar">
          <button
            className="icon-button"
            type="button"
            aria-label="Previous step"
            disabled={prevStep === null}
            onClick={() => prevStep && setActiveStep(prevStep.id)}
          >
            <Icon name="chevron-left" />
          </button>
          <ol className="ai-wizard-steps" aria-label="AI setup steps">
          {STEPS.map((step, index) => {
            const tone = stepState(step.id);
            const locked = isStepLocked(step.id);
            return (
              <li key={step.id}>
                <button
                  className={`ai-wizard-step ai-wizard-step--${tone}${activeStep === step.id ? " ai-wizard-step--current" : ""}`}
                  type="button"
                  disabled={locked}
                  aria-current={activeStep === step.id ? "step" : undefined}
                  onClick={() => goToStep(step.id)}
                >
                  <span className="ai-step-number" aria-hidden="true">{index + 1}</span>
                  <span className="ai-wizard-label">{step.label}</span>
                </button>
                {index < STEPS.length - 1 && (
                  <span className="ai-wizard-sep" aria-hidden="true">
                    <span className="ai-wizard-sep-line" />
                    <Icon name="chevron-right" />
                  </span>
                )}
              </li>
            );
          })}
        </ol>

          {nextStep ? (
            <button
              className="icon-button"
              type="button"
              aria-label={`Next step: ${nextStep.label}`}
              title={`Next: ${nextStep.label}`}
              onClick={() => setActiveStep(nextStep.id)}
            >
              <Icon name="chevron-right" />
            </button>
          ) : (
            <button
              className="icon-button"
              type="button"
              aria-label="Done, close dialog"
              title="Done"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              <Icon name="check" />
            </button>
          )}
        </div>

        {activeStep === "setup" && (
          <div className="ai-step">
            <div className="ai-step-head">
              <div className="ai-step-copy">
                <strong>Recording and model key</strong>
                <small>Pick the recording, then add your Model API key to unlock analysis.</small>
              </div>
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

            <div className="ai-key" aria-label="Model API key">
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
              {!keyConfigured || keyEditing ? (
                <div className="ai-key-row">
                  <input
                    className="ai-key-input"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={keyConfigured ? "Paste a new Model API key (LLM_…)" : "Paste Model API key (LLM_…)"}
                    aria-label="Model API key"
                    value={keyInput}
                    disabled={busy || keyBusy}
                    onChange={(event) => setKeyInput(event.target.value)}
                  />
                  <div className="ai-key-buttons">
                    <button
                      className="ai-step-button ai-key-save"
                      type="button"
                      disabled={busy || keyBusy || keyInput.trim().length === 0}
                      onClick={() => void onSaveAiKey(keyInput).then(() => closeKeyEditor())}
                    >
                      {keyBusy ? "Saving…" : keyConfigured ? "Update" : "Add"}
                    </button>
                    {keyEditing && (
                      <button
                        className="ai-step-button ai-step-button--ghost"
                        type="button"
                        disabled={busy || keyBusy}
                        onClick={closeKeyEditor}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="ai-key-row">
                  <span className="ai-key-masked" aria-label="Saved API key">••••••••••</span>
                  <div className="ai-key-buttons">
                    {keySource !== "environment" && (
                      <button
                        className="ai-step-button ai-step-button--ghost"
                        type="button"
                        disabled={busy || keyBusy}
                        onClick={() => setKeyEditing(true)}
                      >
                        Update
                      </button>
                    )}
                    {keySource === "secure-storage" && (
                      <button
                        className="ai-step-button ai-step-button--ghost"
                        type="button"
                        disabled={busy || keyBusy}
                        onClick={() => void onClearAiKey()}
                      >
                        {keyBusy ? "Removing…" : "Remove"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeStep === "clip" && (
          <div className={`ai-step ai-step--${step1Tone}`} aria-label="Step 2: clip for AI">
            <div className="ai-step-head">
              <span className="ai-step-number" aria-hidden="true">2</span>
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
          </div>
        )}

        {activeStep === "highlights" && (
          <div className={`ai-step ai-step--${step2Tone}`} aria-label="Step 3: AI highlight suggestions">
            <div className="ai-step-head">
              <span className="ai-step-number" aria-hidden="true">3</span>
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
              <p className="ai-step-hint">Complete step 2 to unlock this step.</p>
            )}
            {!highlightsLocked && !keyConfigured && !anyAiTaskBusy && (
              <p className="ai-step-hint">Add your Model API key in step 1 to unlock analysis.</p>
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
                      ? "Add your Model API key in step 1 first"
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
            {highlightsBusy && highlightsProgress !== null && (
              <AiProgress
                label={highlightsStage ?? "Uploading clip"}
                value={highlightsProgress}
                ariaLabel="Clip upload progress"
              />
            )}
            {highlightsBusy && highlightsProgress === null && (
              <AiProgress
                label={highlightsStage ?? "Working…"}
                value={0}
                ariaLabel={highlightsStage ?? "Highlight analysis"}
                indeterminate
              />
            )}

            {highlightsClips.length > 0 && (
              <div className="ai-highlights">
                <div className="ai-highlights-head">
                  <strong>AI suggestions</strong>
                  <span className="ai-step-pill ai-step-pill--done">{highlightsClips.length} found</span>
                  <span className="ai-scroll-hint">
                    <Icon name="chevron-down" />
                    Scroll for more
                  </span>
                </div>
                <ol className="ai-highlight-list">
                  {highlightsClips.map((clip, index) => {
                    return (
                      <li key={`${clip.startTime.toFixed(3)}-${clip.endTime.toFixed(3)}-${index}`} className="ai-highlight">
                        <div className="ai-highlight-head">
                          <strong>{clip.title}</strong>
                          <span className="ai-highlight-category">{clip.category}</span>
                          <span className="ai-highlight-confidence" title="Model confidence — estimated accuracy of this suggestion">
                            Confidence · {Math.round(clip.confidence * 100)}%
                          </span>
                          <span className="ai-highlight-duration" title="Suggested clip length (end minus start)">
                            {formatClipLength(clip.startTime, clip.endTime)}
                          </span>
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
          </div>
        )}

        {activeStep === "micwav" && (
          <div className={`ai-step ai-step--${micWavTone}`} aria-label="Step 4: microphone to WAV">
            <div className="ai-step-head">
              <span className="ai-step-number" aria-hidden="true">4</span>
              <div className="ai-step-copy">
                <strong>Microphone to WAV</strong>
                <small>Convert microphone.m4a to 16 kHz mono microphone.wav for AI audio</small>
              </div>
              <StatusPill
                tone={micWavTone}
                label={
                  micWavBusy
                    ? "Working…"
                    : micWavError
                      ? "Failed"
                      : micWavPath
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
                onClick={() => void onConvertMicWav()}
              >
                {micWavBusy
                  ? "Converting…"
                  : micWavPath
                    ? "Convert again"
                    : "Convert to WAV"}
              </button>
            </div>
            {micWavBusy && (
              <AiProgress
                label="Converting microphone audio"
                value={0}
                ariaLabel="Microphone conversion"
                indeterminate
              />
            )}
            {micWavPath && (
              <p className="export-progress-path ai-step-path">
                <span>Saved to</span>
                <code>{micWavPath}</code>
              </p>
            )}
            {micWavPath && !micPreviewUrl && (
              <div className="ai-step-actions">
                <button
                  className="ai-step-button ai-step-button--ghost"
                  type="button"
                  disabled={busy || loading || micPreviewLoading || anyAiTaskBusy}
                  onClick={() => void onLoadMicPreview()}
                >
                  {micPreviewLoading ? "Loading audio…" : "Preview audio"}
                </button>
              </div>
            )}
            {micPreviewUrl && (
              <audio className="ai-audio-player" controls src={micPreviewUrl}>
                Your browser does not support audio preview.
              </audio>
            )}
          </div>
        )}

        {activeStep === "audio" && (
          <div className="ai-step" aria-label="Step 5: multi-language audio">
            <div className="ai-step-head">
              <span className="ai-step-number" aria-hidden="true">5</span>
              <div className="ai-step-copy">
                <strong>Multi-language subtitles</strong>
                <small>Transcribe the microphone track once, then save one .srt per language. Skippable.</small>
              </div>
              <StatusPill
                tone={audioTone}
                label={
                  subtitlesBusy
                    ? "Working…"
                    : subtitlesError
                      ? "Failed"
                      : subtitlesResults.length > 0
                        ? `${subtitlesResults.length} saved`
                        : "Skippable"
                }
              />
            </div>
            {!keyConfigured && !anyAiTaskBusy && (
              <p className="ai-step-hint">Add your Model API key in step 1 to unlock subtitles.</p>
            )}
            <div className="ai-step-actions">
              <button
                className="ai-step-button"
                type="button"
                disabled={busy || loading || !selectedRecordingId || anyAiTaskBusy || selectedLanguages.length === 0 || !keyConfigured}
                title={!keyConfigured ? "Add your Model API key in step 1 first" : "Transcribe and translate subtitles"}
                onClick={() => void onStartSubtitles(selectedLanguages.map((code) => {
                  const found = AUDIO_LANGUAGES.find((language) => language.code === code);
                  return { code, name: found ? found.label : code };
                }))}
              >
                {subtitlesBusy
                  ? "Generating subtitles…"
                  : subtitlesResults.length > 0
                    ? "Generate subtitles again"
                    : "Generate subtitles"}
              </button>
              {subtitlesBusy && (
                <button
                  className="ai-step-button ai-step-button--ghost"
                  type="button"
                  onClick={onCancelSubtitles}
                >
                  Cancel
                </button>
              )}
            </div>
            {subtitlesBusy && subtitlesProgress !== null && (
              <AiProgress
                label={subtitlesStage ?? "Uploading audio"}
                value={subtitlesProgress}
                ariaLabel="Audio upload progress"
              />
            )}
            {subtitlesBusy && subtitlesProgress === null && (
              <AiProgress
                label={subtitlesStage ?? "Working…"}
                value={0}
                ariaLabel={subtitlesStage ?? "Subtitle generation"}
                indeterminate
              />
            )}
            {subtitlesResults.length > 0 && (
              <ul className="ai-srt-list">
                {subtitlesResults.map((result) => (
                  <li key={result.code} className="ai-highlight">
                    <div className="ai-highlight-head">
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={playingCode === result.code ? `Pause ${result.name} preview` : `Play ${result.name} preview`}
                        title={playingCode === result.code ? "Pause" : "Play microphone audio"}
                        onClick={() => void toggleRowAudio(result.code)}
                      >
                        <Icon name={playingCode === result.code ? "pause" : "play"} />
                      </button>
                      <strong>{AUDIO_LANGUAGES.find((language) => language.code === result.code)?.label ?? result.name}</strong>
                      <span className={`ai-step-pill ${result.srtPath ? "ai-step-pill--done" : result.error ? "ai-step-pill--error" : "ai-step-pill--active"}`}>
                        {result.srtPath ? "Saved" : result.error ? "Failed" : "Working…"}
                      </span>
                    </div>
                    {result.srtPath ? (
                      <p className="export-progress-path ai-step-path">
                        <span>Saved to</span>
                        <code>{result.srtPath}</code>
                      </p>
                    ) : result.error ? (
                      <p className="ai-highlight-reason">{result.error}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <audio
              ref={rowAudioRef}
              className="ai-row-audio"
              src={micPreviewUrl ?? undefined}
              onPause={() => setPlayingCode(null)}
            />
            <div className="ai-step-actions">
              <button
                className="ai-step-button ai-step-button--ghost"
                type="button"
                onClick={() => setSelectedLanguages(AUDIO_LANGUAGES.map((language) => language.code))}
              >
                Select all
              </button>
              <button
                className="ai-step-button ai-step-button--ghost"
                type="button"
                onClick={() => setSelectedLanguages([])}
              >
                Clear
              </button>
            </div>
            <ul className="ai-lang-list">
              {AUDIO_LANGUAGES.map((language) => (
                <li key={language.code}>
                  <label className="ai-lang-option">
                    <input
                      type="checkbox"
                      checked={selectedLanguages.includes(language.code)}
                      onChange={() => toggleLanguage(language.code)}
                    />
                    <span>{language.label}</span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="ai-note">
              {selectedLanguages.length === 0
                ? "No language selected — subtitles will be skipped."
                : `Selected: ${selectedLanguages.length} language${selectedLanguages.length === 1 ? "" : "s"}. Files save as subtitles-<code>.srt next to the recording.`}
            </p>
          </div>
        )}

      </section>
    </div>
  );
}
