export type StepTone = "idle" | "active" | "done" | "error" | "locked";

export function stepTone(busy: boolean, path: string | null, error: string | null, locked: boolean): StepTone {
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

export function StatusPill({ tone, label }: { tone: StepTone; label: string }) {
  return <span className={`ai-step-pill ai-step-pill--${tone}`}>{label}</span>;
}

export function AiProgress({ label, value, ariaLabel }: { label: string; value: number; ariaLabel: string }) {
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
