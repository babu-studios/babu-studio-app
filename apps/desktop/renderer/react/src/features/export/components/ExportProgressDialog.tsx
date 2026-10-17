import { Icon } from "@/components/common/Icon";
import type { ExportProgressProps } from "../types/export.types";
import { ExportOutputCard } from "./ExportOutputCard";

export function ExportProgressDialog({ progress }: { progress: ExportProgressProps }) {
  const { open, setOpen, state, completed, activeExport, overallProgress, exports, onCancel } = progress;
  if (!open || (state !== "PROCESSING" && !completed)) {
    return null;
  }

  return (
    <div className="export-progress-backdrop">
      <section
        className="export-progress-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-progress-title"
        aria-describedby="export-progress-description"
      >
        <div className="export-progress-heading">
          {!completed && (
            <button
              className="export-progress-cancel"
              type="button"
              title="Cancel export (keeps the source recording and project file)"
              aria-label="Cancel export"
              onClick={onCancel}
            >
              <Icon name="close" />
            </button>
          )}
          <div>
            <span className="export-progress-kicker">{completed ? "EXPORT COMPLETE" : "POST-PROCESSING"}</span>
            <h2 id="export-progress-title">{completed ? "Exports complete" : "Exporting videos"}</h2>
          </div>
          {completed ? <span className="export-progress-success" aria-hidden="true">✓</span> : null}
        </div>
        <p id="export-progress-description" className="export-progress-description">
          {completed
            ? "Selected layout exports are ready."
            : activeExport
              ? `Rendering ${activeExport.mode === "HORIZONTAL" ? "Landscape" : "Portrait"} layout…`
              : "Preparing the video exports…"}
        </p>
        <div className="export-progress-label">
          <span>Overall progress</span>
          <strong>{overallProgress}%</strong>
        </div>
        <div
          className="export-progress-track"
          role="progressbar"
          aria-label="Overall export progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={overallProgress}
        >
          <span style={{ width: `${overallProgress}%` }} />
        </div>
        <div className="export-progress-outputs">
          {exports.map((entry) => (
            <ExportOutputCard key={entry.mode} entry={entry} showPath={completed} />
          ))}
        </div>
        {completed && (
          <button className="export-progress-close" type="button" onClick={() => setOpen(false)}>
            Close
          </button>
        )}
      </section>
    </div>
  );
}
