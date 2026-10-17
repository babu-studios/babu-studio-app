import { formatStorageSize } from "@/features/studio/utils/recording-format";

type ExportSpaceEstimateProps = {
  estimatedBytes: number;
  freeBytes: number | null;
};

export function ExportSpaceEstimate({ estimatedBytes, freeBytes }: ExportSpaceEstimateProps) {
  const diskShort = freeBytes !== null && estimatedBytes > freeBytes;
  const share = freeBytes === null ? 0 : (estimatedBytes / Math.max(1, freeBytes)) * 100;

  return (
    <div className={`export-space${diskShort ? " export-space--short" : ""}`} role="status">
      <div className="export-space-header">
        <span className="export-space-label">Estimated space needed</span>
        <strong className="export-space-value">~{formatStorageSize(estimatedBytes)}</strong>
      </div>
      {freeBytes !== null && (
        <>
          <div
            className="export-space-track"
            role="progressbar"
            aria-label="Estimated share of free disk space"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.round(share))}
          >
            <span className="export-space-fill" style={{ width: `${Math.min(100, share)}%` }} />
          </div>
          <div className="export-space-footer">
            <span>{formatStorageSize(freeBytes)} free</span>
            <span className="export-space-status">
              {diskShort
                ? "Not enough free space"
                : `${formatStorageSize(freeBytes - estimatedBytes)} left after export`}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
