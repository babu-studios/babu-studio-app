import { execFile } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { statfs } from "node:fs/promises";
import { promisify } from "node:util";
import { app } from "electron";
import type { ProcessEntry, ProcessSnapshot, SystemStats } from "@shared/types/system-stats";

const run = promisify(execFile);
const COMMAND_TIMEOUT_MS = 2000;
const PROCESS_LIMIT = 10;
const APPLICATION_PATTERN = /(?:^|\/)Applications\/([^/]+)\.app\/|\/CoreServices\/(Finder)\.app\//;

type CpuTimes = { idle: number; total: number };

function readCpuTimes(): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const { times } of cpus()) {
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
}

function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

async function command(file: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run(file, args, { timeout: COMMAND_TIMEOUT_MS });
    return stdout;
  } catch {
    return null;
  }
}

export class SystemStatsService {
  private previousCpu = readCpuTimes();
  private previousDisk?: { megabytes: number; at: number };
  private lastSystemCpu = 0;

  async sample(): Promise<SystemStats> {
    const [gpuPercent, usedBytes, diskSpace, diskTotalMb] = await Promise.all([
      this.readGpuPercent(),
      this.readUsedMemory(),
      statfs("/").catch(() => null),
      this.readDiskTransferredMegabytes(),
    ]);

    const metrics = app.getAppMetrics();
    const cores = cpus().length;
    const appPercent = clampPercent(metrics.reduce((sum, entry) => sum + entry.cpu.percentCPUUsage, 0) / Math.max(1, cores));
    const appBytes = metrics.reduce((sum, entry) => sum + entry.memory.workingSetSize * 1024, 0);

    return {
      timestamp: Date.now(),
      cpu: {
        systemPercent: this.readSystemCpu(),
        appPercent,
        cores,
        model: cpus()[0]?.model ?? "CPU",
      },
      gpu: { percent: gpuPercent },
      memory: {
        totalBytes: totalmem(),
        usedBytes: usedBytes ?? 0,
        appBytes,
      },
      disk: {
        totalBytes: diskSpace ? diskSpace.blocks * diskSpace.bsize : 0,
        freeBytes: diskSpace ? diskSpace.bavail * diskSpace.bsize : 0,
        activityBytesPerSecond: this.diskActivity(diskTotalMb),
      },
    };
  }

  private readSystemCpu(): number {
    const current = readCpuTimes();
    const totalDelta = current.total - this.previousCpu.total;
    const idleDelta = current.idle - this.previousCpu.idle;
    this.previousCpu = current;
    if (totalDelta > 0) {
      this.lastSystemCpu = clampPercent((1 - idleDelta / totalDelta) * 100);
    }
    return this.lastSystemCpu;
  }

  private async readGpuPercent(): Promise<number | null> {
    if (process.platform !== "darwin") {
      return null;
    }
    const output = await command("/usr/sbin/ioreg", ["-r", "-d", "1", "-w0", "-c", "IOAccelerator"]);
    const match = output?.match(/"Device Utilization %"\s*=\s*(\d+)/);
    return match ? clampPercent(Number(match[1])) : null;
  }

  private async readUsedMemory(): Promise<number | null> {
    if (process.platform !== "darwin") {
      return totalmem() - process.getSystemMemoryInfo().free * 1024;
    }
    const output = await command("/usr/bin/vm_stat", []);
    if (!output) {
      return null;
    }
    const pageSize = Number(output.match(/page size of (\d+) bytes/)?.[1] ?? 16384);
    const pages = (label: string) => Number(output.match(new RegExp(`${label}:\\s+(\\d+)`))?.[1] ?? 0);
    // Matches Activity Monitor's "Memory Used": app memory + wired + compressed.
    const used = pages("Pages active") + pages("Pages wired down") + pages("Pages occupied by compressor");
    return used * pageSize;
  }

  private async readDiskTransferredMegabytes(): Promise<number | null> {
    if (process.platform !== "darwin") {
      return null;
    }
    const output = await command("/usr/sbin/iostat", ["-Id", "disk0"]);
    const values = output?.trim().split("\n").pop()?.trim().split(/\s+/).map(Number);
    const megabytes = values?.[2];
    return megabytes !== undefined && Number.isFinite(megabytes) ? megabytes : null;
  }

  private diskActivity(megabytes: number | null): number | null {
    if (megabytes === null) {
      return null;
    }
    const now = Date.now();
    const previous = this.previousDisk;
    this.previousDisk = { megabytes, at: now };
    if (!previous || now <= previous.at || megabytes < previous.megabytes) {
      return null;
    }
    return ((megabytes - previous.megabytes) * 1024 * 1024) / ((now - previous.at) / 1000);
  }

  async sampleProcesses(): Promise<ProcessSnapshot> {
    const output = await command("/bin/ps", ["-axo", "pid=,pcpu=,rss=,comm="]);
    if (!output) {
      return { applications: [], background: [] };
    }
    const cores = Math.max(1, cpus().length);
    const applications = new Map<string, ProcessEntry>();
    const background = new Map<string, ProcessEntry>();

    for (const line of output.split("\n")) {
      const match = line.match(/^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
      if (!match) {
        continue;
      }
      const path = match[4].trim();
      const appMatch = path.match(APPLICATION_PATTERN);
      const name = appMatch ? (appMatch[1] ?? appMatch[2]) : path.split("/").pop() ?? path;
      if (!appMatch && name === "ps") {
        continue;
      }
      const group = appMatch ? applications : background;
      const entry = group.get(name) ?? { name, cpuPercent: 0, memoryBytes: 0, instances: 0 };
      entry.cpuPercent += Number(match[2]) / cores;
      entry.memoryBytes += Number(match[3]) * 1024;
      entry.instances += 1;
      group.set(name, entry);
    }

    const top = (group: Map<string, ProcessEntry>) => [...group.values()]
      .sort((a, b) => b.cpuPercent - a.cpuPercent || b.memoryBytes - a.memoryBytes)
      .slice(0, PROCESS_LIMIT);
    return { applications: top(applications), background: top(background) };
  }
}
