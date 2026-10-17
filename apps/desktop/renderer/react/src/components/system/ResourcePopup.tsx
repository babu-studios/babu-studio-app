import type { ProcessSnapshot, SystemStats } from "@shared/types/system-stats";
import { formatBytes, formatRate } from "./resource-format";
import { ResourcePopupSection } from "./ResourcePopupSection";
import { ResourceProcessList } from "./ResourceProcessList";

type ResourcePopupProps = {
  stats: SystemStats;
  processes: ProcessSnapshot | null;
  memoryPercent: number;
  diskPercent: number;
  diskUsed: number;
};

export function ResourcePopup({ stats, processes, memoryPercent, diskPercent, diskUsed }: ResourcePopupProps) {
  const { cpu, gpu, memory, disk } = stats;
  return (
    <div className="resource-popup" role="tooltip">
      <div className="resource-popup-sections">
        <ResourcePopupSection
          title="CPU"
          percent={cpu.systemPercent}
          rows={[
            ["Model", cpu.model],
            ["Cores", String(cpu.cores)],
            ["System usage", `${cpu.systemPercent.toFixed(1)}%`],
            ["Babu Studio", `${cpu.appPercent.toFixed(1)}%`],
          ]}
        />
        <ResourcePopupSection
          title="GPU"
          percent={gpu.percent}
          rows={gpu.percent === null
            ? [["Status", "No reading available"]]
            : [["Utilization", `${gpu.percent.toFixed(0)}%`]]}
        />
        <ResourcePopupSection
          title="Memory"
          percent={memoryPercent}
          rows={[
            ["Used", formatBytes(memory.usedBytes)],
            ["Free", formatBytes(Math.max(0, memory.totalBytes - memory.usedBytes))],
            ["Total", formatBytes(memory.totalBytes)],
            ["Babu Studio", formatBytes(memory.appBytes)],
          ]}
        />
        <ResourcePopupSection
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
        <ResourceProcessList title="Top 10 running applications" hint="Apps you opened · CPU / memory" entries={processes?.applications} />
        <ResourceProcessList title="Top 10 background processes" hint="System and helper services · CPU / memory" entries={processes?.background} />
      </div>
    </div>
  );
}
