import { Dropdown } from "@/components/common/Dropdown";
import { Icon } from "@/components/common/Icon";
import { EXPORT_RESOLUTIONS, type ExportResolutionId } from "@shared/constants/media.constants";
import { estimateExportBytes, formatRecordingLabel } from "@/features/studio/utils/recording-format";
import type { ExportPickerProps } from "../types/export.types";
import { ExportFormatOptions } from "./ExportFormatOptions";
import { ExportSpaceEstimate } from "./ExportSpaceEstimate";

const RESOLUTION_ENTRIES = Object.entries(EXPORT_RESOLUTIONS) as [
  ExportResolutionId,
  (typeof EXPORT_RESOLUTIONS)[ExportResolutionId],
][];

export function ExportPickerDialog({ picker }: { picker: ExportPickerProps }) {
  const {
    open,
    setOpen,
    busy,
    loading,
    error,
    recordings,
    selectedRecordingId,
    setSelectedRecordingId,
    modes,
    setModes,
    resolution,
    setResolution,
    freeBytes,
    onExport,
  } = picker;
  if (!open) {
    return null;
  }

  const selectedRecording = recordings.find((entry) => entry.id === selectedRecordingId);

  return (
    <div className="export-progress-backdrop">
      <section
        className="export-progress-dialog export-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-picker-title"
      >
        <div className="export-progress-heading">
          <button
            className="export-progress-cancel"
            type="button"
            aria-label="Close export dialog"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            <Icon name="close" />
          </button>
          <div>
            <span className="export-progress-kicker">EXPORT</span>
            <h2 id="export-picker-title">Select a recording</h2>
          </div>
        </div>
        {loading ? (
          <p className="export-progress-description">Loading recordings…</p>
        ) : recordings.length === 0 ? (
          <p className="export-progress-description">No saved recordings found. Record something first.</p>
        ) : (
          <>
            <label className="export-resolution">
              <span>Recording</span>
              <Dropdown
                value={selectedRecordingId}
                aria-label="Recording to export"
                disabled={busy}
                onChange={(event) => setSelectedRecordingId(event.target.value)}
              >
                {recordings.map((entry) => (
                  <option key={entry.id} value={entry.id}>{formatRecordingLabel(entry)}</option>
                ))}
              </Dropdown>
            </label>
            <ExportFormatOptions modes={modes} setModes={setModes} disabled={busy} />
            <label className="export-resolution">
              <span>Export quality</span>
              <Dropdown
                value={resolution}
                aria-label="Export quality"
                disabled={busy}
                onChange={(event) => setResolution(event.target.value as ExportResolutionId)}
              >
                {RESOLUTION_ENTRIES.map(([id, option]) => (
                  <option key={id} value={id}>{option.label}</option>
                ))}
              </Dropdown>
            </label>
            {selectedRecording && (
              <ExportSpaceEstimate
                estimatedBytes={estimateExportBytes(selectedRecording.durationMs, modes, resolution)}
                freeBytes={freeBytes}
              />
            )}
          </>
        )}
        {error && <p className="export-picker-error" role="alert">{error}</p>}
        <button
          className="export-progress-close"
          type="button"
          disabled={busy || loading || !selectedRecordingId}
          onClick={() => void onExport()}
        >
          Export
        </button>
      </section>
    </div>
  );
}
