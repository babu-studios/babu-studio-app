import type { CaptureResolutionId } from "@/features/studio/types/studio.types";
import { CAPTURE_RESOLUTIONS } from "@/features/studio/constants/layers";

export type DeviceMaxSize = { width: number; height: number };

const maxSizeCache = new Map<string, DeviceMaxSize | null>();

function rangeMax(range: number | { max?: number } | undefined): number | null {
  if (typeof range === "number") {
    return range;
  }
  return typeof range?.max === "number" ? range.max : null;
}

export async function readDeviceMaxSize(deviceId: string): Promise<DeviceMaxSize | null> {
  if (maxSizeCache.has(deviceId)) {
    return maxSizeCache.get(deviceId) ?? null;
  }
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: deviceId } } });
    const capabilities = stream.getVideoTracks()[0]?.getCapabilities?.();
    const width = rangeMax(capabilities?.width);
    const height = rangeMax(capabilities?.height);
    const size = width && height ? { width, height } : null;
    maxSizeCache.set(deviceId, size);
    return size;
  } catch (error) {
    console.error("Unable to read device capabilities:", error);
    return null;
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
}

export function supportedResolutionIds(max: DeviceMaxSize): CaptureResolutionId[] {
  return CAPTURE_RESOLUTIONS
    .filter((resolution) => resolution.width <= max.width && resolution.height <= max.height)
    .map((resolution) => resolution.id);
}
