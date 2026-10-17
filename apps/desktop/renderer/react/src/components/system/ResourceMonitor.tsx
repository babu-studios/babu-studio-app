import { useState } from "react";
import { usePolledValue } from "@/hooks/usePolledValue";
import { ResourceMetric } from "./ResourceMetric";
import { ResourcePopup } from "./ResourcePopup";
import { closableNames } from "./process-advice";

const REFRESH_INTERVAL_MS = 1000;
const PROCESS_REFRESH_INTERVAL_MS = 2000;
const IDLE_PROCESS_REFRESH_INTERVAL_MS = 15000;

export function ResourceMonitor() {
  const [open, setOpen] = useState(false);
  const stats = usePolledValue(
    () => window.babuStudio.getSystemStats(),
    REFRESH_INTERVAL_MS,
    true,
    "Unable to read system stats:",
  );
  const processes = usePolledValue(
    () => window.babuStudio.getProcessSnapshot(),
    open ? PROCESS_REFRESH_INTERVAL_MS : IDLE_PROCESS_REFRESH_INTERVAL_MS,
    true,
    "Unable to read running processes:",
  );

  if (!stats) {
    return (
      <section className="resource-monitor" aria-label="System resources">
        <span className="resource-monitor-loading">Reading system resources…</span>
      </section>
    );
  }

  const hasAdvice = closableNames(processes?.applications).length + closableNames(processes?.background).length > 0;
  const { cpu, gpu, memory, disk } = stats;
  const memoryPercent = memory.totalBytes > 0 ? (memory.usedBytes / memory.totalBytes) * 100 : 0;
  const diskUsed = disk.totalBytes - disk.freeBytes;
  const diskPercent = disk.totalBytes > 0 ? (diskUsed / disk.totalBytes) * 100 : 0;

  return (
    <section
      className={`resource-monitor${open ? " resource-monitor--open" : ""}${hasAdvice ? " resource-monitor--advice" : ""}`}
      aria-label="System resources"
      tabIndex={0}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <ResourceMetric label="CPU" percent={cpu.systemPercent} />
      <ResourceMetric label="GPU" percent={gpu.percent} detail={gpu.percent === null ? "Unavailable" : undefined} />
      <ResourceMetric label="Memory" percent={memoryPercent} />
      <ResourceMetric label="Disk" percent={diskPercent} />
      {hasAdvice && (
        <span className="resource-monitor-warning" title="Heavy background apps detected. Hover for details." aria-label="Heavy background apps detected" />
      )}
      <ResourcePopup
        stats={stats}
        processes={processes}
        memoryPercent={memoryPercent}
        diskPercent={diskPercent}
        diskUsed={diskUsed}
      />
    </section>
  );
}
