import { openActivityMonitor } from "./open-activity-monitor";
import { Icon } from "@/components/common/Icon";
import type { ProcessEntry } from "@shared/types/system-stats";
import { formatBytes, levelFor } from "./resource-format";
import { canSuggestClosing } from "./process-advice";

type ResourceProcessListProps = {
  title: string;
  hint: string;
  entries: ProcessEntry[] | undefined;
};

export function ResourceProcessList({ title, hint, entries }: ResourceProcessListProps) {
  return (
    <div className="resource-process-list">
      <div className="resource-process-heading">
        <div className="resource-process-heading-copy">
          <strong>{title}</strong>
          <small>{hint}</small>
        </div>
        <button
          className="resource-process-settings"
          type="button"
          title="Open Activity Monitor to quit apps or processes"
          aria-label={`Open Activity Monitor for ${title}`}
          onClick={() => void openActivityMonitor()}
        >
          <Icon name="settings" />
        </button>
      </div>
      {!entries ? (
        <span className="resource-process-empty">Loading…</span>
      ) : entries.length === 0 ? (
        <span className="resource-process-empty">Nothing to show</span>
      ) : (
        <ul>
          {entries.map((entry) => {
            const closable = canSuggestClosing(entry);
            return (
              <li key={entry.name} className={closable ? "resource-process-row--closable" : undefined}>
                <span className="resource-process-name" title={entry.name}>
                  {entry.name}
                  {entry.instances > 1 && <small> ×{entry.instances}</small>}
                  {closable && (
                    <em className="resource-process-tag" title="Heavy and not needed by Babu Studio. Consider closing it.">
                      can close
                    </em>
                  )}
                </span>
                <span className={`resource-process-cpu resource-metric--${levelFor(entry.cpuPercent * 4)}`}>
                  {entry.cpuPercent.toFixed(1)}%
                </span>
                <span className="resource-process-memory">{formatBytes(entry.memoryBytes)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
