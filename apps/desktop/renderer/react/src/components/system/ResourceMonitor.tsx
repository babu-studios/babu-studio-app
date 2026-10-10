import { useEffect, useState } from "react";
import type { ProcessEntry, ProcessSnapshot, SystemStats } from "@shared/types/system-stats";

const REFRESH_INTERVAL_MS = 1000;
const PROCESS_REFRESH_INTERVAL_MS = 2000;

const RING_RADIUS = 15;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function levelFor(percent: number | null): "idle" | "ok" | "warn" | "high" {
  if (percent === null) {
    return "idle";
  }
  if (percent <= 50) {
    return "ok";
  }
  return percent <= 80 ? "warn" : "high";
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function formatRate(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null) {
    return "—";
  }
  if (bytesPerSecond >= 1024 ** 2) {
    return `${(bytesPerSecond / 1024 ** 2).toFixed(1)} MB/s`;
  }
  return `${Math.round(bytesPerSecond / 1024)} KB/s`;
}

type MetricRow = [label: string, value: string];

type MetricProps = {
  label: string;
  percent: number | null;
  detail?: string;
};

function Metric({ label, percent, detail }: MetricProps) {
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

function PopupSection({ title, percent, rows }: { title: string; percent: number | null; rows: MetricRow[] }) {
  return (
    <div className={`resource-popup-section resource-metric--${levelFor(percent)}`}>
      <strong className="resource-popup-title">{title}</strong>
      <dl>
        {rows.map(([rowLabel, rowValue]) => (
          <div key={rowLabel}>
            <dt>{rowLabel}</dt>
            <dd>{rowValue}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ProcessList({ title, hint, entries }: { title: string; hint: string; entries: ProcessEntry[] | undefined }) {
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

export function ResourceMonitor() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [open, setOpen] = useState(false);
  const [processes, setProcesses] = useState<ProcessSnapshot | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await window.duiStudio.getProcessSnapshot();
        if (!cancelled) {
          setProcesses(next);
        }
      } catch (error) {
        console.error("Unable to read running processes:", error);
      }
      if (!cancelled) {
        timer = window.setTimeout(poll, PROCESS_REFRESH_INTERVAL_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await window.duiStudio.getSystemStats();
        if (!cancelled) {
          setStats(next);
        }
      } catch (error) {
        console.error("Unable to read system stats:", error);
      }
      if (!cancelled) {
        timer = window.setTimeout(poll, REFRESH_INTERVAL_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  if (!stats) {
    return (
      <section className="resource-monitor" aria-label="System resources">
        <span className="resource-monitor-loading">Reading system resources…</span>
      </section>
    );
  }

  const { cpu, gpu, memory, disk } = stats;
  const memoryPercent = memory.totalBytes > 0 ? (memory.usedBytes / memory.totalBytes) * 100 : 0;
  const diskUsed = disk.totalBytes - disk.freeBytes;
  const diskPercent = disk.totalBytes > 0 ? (diskUsed / disk.totalBytes) * 100 : 0;

  return (
    <section
      className={`resource-monitor${open ? " resource-monitor--open" : ""}`}
      aria-label="System resources"
      tabIndex={0}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <Metric label="CPU" percent={cpu.systemPercent} />
      <Metric label="GPU" percent={gpu.percent} detail={gpu.percent === null ? "Unavailable" : undefined} />
      <Metric label="Memory" percent={memoryPercent} />
      <Metric label="Disk" percent={diskPercent} />
      <div className="resource-popup" role="tooltip">
        <div className="resource-popup-sections">
        <PopupSection
          title="CPU"
          percent={cpu.systemPercent}
          rows={[
            ["Model", cpu.model],
            ["Cores", String(cpu.cores)],
            ["System usage", `${cpu.systemPercent.toFixed(1)}%`],
            ["Babu Studio", `${cpu.appPercent.toFixed(1)}%`],
          ]}
        />
        <PopupSection
          title="GPU"
          percent={gpu.percent}
          rows={gpu.percent === null
            ? [["Status", "No reading available"]]
            : [["Utilization", `${gpu.percent.toFixed(0)}%`]]}
        />
        <PopupSection
          title="Memory"
          percent={memoryPercent}
          rows={[
            ["Used", formatBytes(memory.usedBytes)],
            ["Free", formatBytes(Math.max(0, memory.totalBytes - memory.usedBytes))],
            ["Total", formatBytes(memory.totalBytes)],
            ["Babu Studio", formatBytes(memory.appBytes)],
          ]}
        />
        <PopupSection
          title="Disk"
          percent={diskPercent}
          rows={[
            ["Used", formatBytes(diskUsed)],
            ["Free", formatBytes(disk.freeBytes)],
            ["Total", formatBytes(disk.totalBytes)],
            ["Read/write", formatRate(disk.activityBytesPerSecond)],
          ]}
        />
        </div>
        <div className="resource-process-columns">
          <ProcessList title="Top 10 running applications" hint="Apps you opened · CPU / memory" entries={processes?.applications} />
          <ProcessList title="Top 10 background processes" hint="System and helper services · CPU / memory" entries={processes?.background} />
        </div>
      </div>
    </section>
  );
}
