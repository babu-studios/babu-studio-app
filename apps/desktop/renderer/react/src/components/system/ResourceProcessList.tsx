import type { ProcessEntry } from "@shared/types/system-stats";
import { formatBytes, levelFor } from "./resource-format";

type ResourceProcessListProps = {
  title: string;
  hint: string;
  entries: ProcessEntry[] | undefined;
};

export function ResourceProcessList({ title, hint, entries }: ResourceProcessListProps) {
  return (
    <div className="resource-process-list">
      <div className="resource-process-heading">
        <strong>{title}</strong>
        <small>{hint}</small>
      </div>
      {!entries ? (
        <span className="resource-process-empty">Loading…</span>
      ) : entries.length === 0 ? (
        <span className="resource-process-empty">Nothing to show</span>
      ) : (
        <ul>
          {entries.map((entry) => (
            <li key={entry.name}>
              <span className="resource-process-name" title={entry.name}>
                {entry.name}
                {entry.instances > 1 && <small> ×{entry.instances}</small>}
              </span>
              <span className={`resource-process-cpu resource-metric--${levelFor(entry.cpuPercent * 4)}`}>
                {entry.cpuPercent.toFixed(1)}%
              </span>
              <span className="resource-process-memory">{formatBytes(entry.memoryBytes)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
