export type ResourceLevel = "idle" | "ok" | "warn" | "high";

export function levelFor(percent: number | null): ResourceLevel {
  if (percent === null) {
    return "idle";
  }
  if (percent <= 50) {
    return "ok";
  }
  return percent <= 80 ? "warn" : "high";
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

export function formatRate(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null) {
    return "—";
  }
  if (bytesPerSecond >= 1024 ** 2) {
    return `${(bytesPerSecond / 1024 ** 2).toFixed(1)} MB/s`;
  }
  return `${Math.round(bytesPerSecond / 1024)} KB/s`;
}
