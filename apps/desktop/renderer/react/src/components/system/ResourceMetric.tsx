import { levelFor } from "./resource-format";

const RING_RADIUS = 15;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

type ResourceMetricProps = {
  label: string;
  percent: number | null;
  detail?: string;
};

export function ResourceMetric({ label, percent, detail }: ResourceMetricProps) {
  const value = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className={`resource-metric resource-metric--${levelFor(percent)}`}>
      <div
        className="resource-ring"
        role="progressbar"
        aria-label={`${label} usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent === null ? undefined : Math.round(value)}
      >
        <svg viewBox="0 0 36 36" aria-hidden="true">
          <circle className="resource-ring-track" cx="18" cy="18" r={RING_RADIUS} />
          <circle
            className="resource-ring-value"
            cx="18"
            cy="18"
            r={RING_RADIUS}
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - value / 100)}
          />
        </svg>
        <span>{percent === null ? "–" : Math.round(value)}</span>
      </div>
      <div className="resource-metric-text">
        <span className="resource-metric-label">{label}</span>
        {detail && <small>{detail}</small>}
      </div>
    </div>
  );
}
