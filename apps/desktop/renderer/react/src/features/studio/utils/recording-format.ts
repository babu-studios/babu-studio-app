import type { ExportResolutionId } from "@shared/constants/media.constants";
import type { RecordingExport, RecordingMode, RecordingSummary } from "@shared/types/media";
import { EXPORT_RESOLUTIONS } from "@shared/constants/media.constants";

export function formatRecordingLabel(entry: RecordingSummary): string {
  const created = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : entry.id;
  const size = (entry.fileSizeBytes / 1048576).toFixed(0);
  return `${created} · ${formatRecordingTime(entry.durationMs)} · ${size} MB${entry.exported ? " · exported" : ""}`;
}

export function formatRecordingTime(milliseconds: number): string {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function formatRecordingExports(exports: RecordingExport[] | undefined): string {
  return (exports ?? []).map((entry) => {
    const layout = entry.mode === "HORIZONTAL" ? "Horizontal" : "Vertical";
    const detail = entry.error ? ` — ${entry.error}` : `: ${entry.path}`;
    return `${layout} ${entry.state.toLowerCase()}${detail}`;
  }).join(" · ");
}

// Calibrated from a measured 1080p VideoToolbox export (~14.3 Mbps incl. audio); scales with pixel count.

export const EXPORT_BITS_PER_PIXEL_SECOND = 6.9;

export function estimateExportBytes(durationMs: number, modes: RecordingMode[], resolution: ExportResolutionId): number {
  const { horizontal } = EXPORT_RESOLUTIONS[resolution];
  const bytesPerLayout = (horizontal.width * horizontal.height * EXPORT_BITS_PER_PIXEL_SECOND * durationMs / 1000) / 8;
  return bytesPerLayout * modes.length;
}

export function formatStorageSize(bytes: number): string {
  const gigabytes = bytes / 1024 ** 3;
  return gigabytes >= 1 ? `${gigabytes.toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

export function describeExportSelection(modes: RecordingMode[]): string {
  const names = modes.map((mode) => mode === "HORIZONTAL" ? "horizontal" : "vertical");
  return names.length === 2 ? "horizontal and vertical layouts" : `${names[0] ?? "selected"} layout`;
}
