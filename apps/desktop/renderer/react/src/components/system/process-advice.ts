import type { ProcessEntry } from "@shared/types/system-stats";

const HEAVY_CPU_PERCENT = 3;
const HEAVY_MEMORY_BYTES = 400 * 1024 ** 2;

// Anything the OS, the audio/video stack or Babu Studio itself depends on; never suggest closing these.
const PROTECTED_PATTERN = /^(WindowServer|coreaudiod|usbaudiod|screencapture|Finder|Dock|SystemUIServer|kernel_task|launchd|loginwindow|corespeechd|PerfPowerServices|ContinuityCaptureAgent|Electron|Babu Studio|media-core|ffmpeg|mds|mds_stores|bluetoothd|powerd|cameraserviced|VTDecoderXPCService)/i;

export function isHeavy(entry: ProcessEntry): boolean {
  return entry.cpuPercent >= HEAVY_CPU_PERCENT || entry.memoryBytes >= HEAVY_MEMORY_BYTES;
}

export function canSuggestClosing(entry: ProcessEntry): boolean {
  return isHeavy(entry) && !PROTECTED_PATTERN.test(entry.name);
}

export function closableNames(entries: ProcessEntry[] | undefined): string[] {
  return (entries ?? []).filter(canSuggestClosing).map((entry) => entry.name);
}
