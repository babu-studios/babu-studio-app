import { Icon } from "@/components/common/Icon";
import { OUTPUTS } from "@/features/studio/constants/outputs";
import type { RecordingExport } from "@shared/types/media";

const STATUS: Record<RecordingExport["state"], { label: string; className: string }> = {
  COMPLETED: { label: "Completed", className: "complete" },
  PROCESSING: { label: "Rendering", className: "active" },
  ERROR: { label: "Failed", className: "error" },
} as Record<RecordingExport["state"], { label: string; className: string }>;
const WAITING = { label: "Waiting", className: "waiting" };

type ExportOutputCardProps = {
  entry: RecordingExport;
  showPath: boolean;
};

export function ExportOutputCard({ entry, showPath }: ExportOutputCardProps) {
  const output = entry.mode === "HORIZONTAL" ? OUTPUTS[0] : OUTPUTS[1];
  const { label, className } = STATUS[entry.state] ?? WAITING;

  return (
    <div className={`export-progress-output-card export-progress-output-card--${className}`}>
      <div className="export-progress-output-main">
        <span className="export-progress-output-icon">
          <Icon name={output.icon} />
        </span>
        <span className="export-progress-output-copy">
          <strong>{output.name}</strong>
          <small>MP4</small>
        </span>
        <span className={`export-progress-badge export-progress-badge--${className}`}>{label}</span>
      </div>
      {showPath && entry.path && (
        <div className="export-progress-path">
          <span>Saved to</span>
          <code>{entry.path}</code>
        </div>
      )}
    </div>
  );
}
