import type {
  NativeCaptureDevice,
  RecordingLayer,
  RecordingResult,
  StartRecordingRequest,
} from "@shared/types/media";

export const CAPTURE_SIZES = {
  "360p": { width: 640, height: 360 },
  "480p": { width: 854, height: 480 },
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "1440p": { width: 2560, height: 1440 },
  "2160p": { width: 3840, height: 2160 },
} as const;

export function failure(request: StartRecordingRequest, error: string): RecordingResult {
  return {
    state: "ERROR",
    success: false,
    recordingMode: request.mode,
    filePath: "",
    durationMs: 0,
    fileSizeBytes: 0,
    droppedVideoFrames: 0,
    droppedAudioFrames: 0,
    videoTracks: [],
    audioTracks: [],
    error,
    postProcessingState: "NOT_STARTED",
    exportPath: null,
  };
}

export function evenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

export function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeCaptureDeviceName(name: string): string {
  return name
    .replace(/^default\s*-\s*/i, "")
    .replace(/\s+\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, "")
    .replace(/\s+\(built-in\)$/i, "")
    .trim()
    .toLocaleLowerCase();
}

export function nativeDeviceId(
  selectedName: string,
  type: NativeCaptureDevice["type"],
  devices: NativeCaptureDevice[],
): string {
  const typedDevices = [...new Map(
    devices.filter((device) => device.type === type).map((device) => [device.id, device]),
  ).values()];
  const hardwareId = /\(([0-9a-f]{4}):([0-9a-f]{4})\)\s*$/i.exec(selectedName.trim());
  const compactHardwareId = hardwareId ? `${hardwareId[1]}${hardwareId[2]}`.toLocaleLowerCase() : undefined;
  const hardwareMatches = compactHardwareId
    ? typedDevices.filter((device) => device.id.toLocaleLowerCase().replace(/[^0-9a-f]/g, "").includes(compactHardwareId))
    : [];
  if (hardwareMatches.length === 1) {
    return hardwareMatches[0].id;
  }

  const normalizedName = normalizeCaptureDeviceName(selectedName);
  const nameMatches = typedDevices.filter((device) => normalizeCaptureDeviceName(device.name) === normalizedName);
  if (nameMatches.length === 1) {
    return nameMatches[0].id;
  }

  if (hardwareMatches.length > 1 || nameMatches.length > 1) {
    throw new Error(`More than one native ${type} device matches "${selectedName}". Choose a uniquely identified input.`);
  }

  const available = typedDevices.map((device) => device.name).join(", ") || "none";
  throw new Error(`Selected ${type} device "${selectedName}" is not available to the native recorder. Available ${type} devices: ${available}.`);
}

export function getSourceDimensions(layer: RecordingLayer): { width: number; height: number } {
  if (layer.sourceDimensions) {
    return layer.sourceDimensions;
  }
  switch (layer.captureResolution) {
    case "360p": return CAPTURE_SIZES["360p"];
    case "480p": return CAPTURE_SIZES["480p"];
    case "720p": return CAPTURE_SIZES["720p"];
    case "1080p": return CAPTURE_SIZES["1080p"];
    case "1440p": return CAPTURE_SIZES["1440p"];
    case "2160p": return CAPTURE_SIZES["2160p"];
  }
}
