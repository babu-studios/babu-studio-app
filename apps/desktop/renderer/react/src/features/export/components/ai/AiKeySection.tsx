import { useEffect, useState } from "react";
import { StatusPill } from "./AiStatus";
import type { AiDialogProps } from "../../types/export.types";

type AiKeySectionProps = Pick<
  AiDialogProps,
  "open" | "busy" | "keyConfigured" | "keySource" | "keyBusy" | "keyError" | "onRefreshKeyStatus" | "onSaveAiKey" | "onClearAiKey"
>;

export function AiKeySection(props: AiKeySectionProps) {
  const {
    open,
    busy,
    keyConfigured,
    keySource,
    keyBusy,
    keyError,
    onRefreshKeyStatus,
    onSaveAiKey,
    onClearAiKey,
  } = props;
  const [keyInput, setKeyInput] = useState("");
  useEffect(() => {
    if (open) {
      setKeyInput("");
      void onRefreshKeyStatus();
    }
  }, [open, onRefreshKeyStatus]);

  return (
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
  );
}
