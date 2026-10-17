import type { DeviceOption } from "@/features/studio/types/studio.types";

export function nativeCaptureDeviceName(name: string): string {
  return name
    .replace(/^default\s*-\s*/i, "")
    .replace(/\s+\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, "")
    .replace(/\s+\(built-in\)$/i, "")
    .trim();
}

export function normalizeAudioDeviceName(name: string): string {
  return nativeCaptureDeviceName(name).toLocaleLowerCase();
}

export function findAudioDeviceByName(name: string, devices: DeviceOption[]): DeviceOption | undefined {
  const normalizedName = normalizeAudioDeviceName(name);
  if (!normalizedName) {
    return undefined;
  }
  const exactMatches = devices.filter((device) => normalizeAudioDeviceName(device.name) === normalizedName);
  if (exactMatches.length === 1) {
    return exactMatches[0];
  }
  if (exactMatches.length > 1) {
    return undefined;
  }
  const partialMatches = devices.filter((device) => {
    const normalizedDeviceName = normalizeAudioDeviceName(device.name);
    return normalizedDeviceName.length > 0
      && (normalizedDeviceName.includes(normalizedName) || normalizedName.includes(normalizedDeviceName));
  });
  return partialMatches.length === 1 ? partialMatches[0] : undefined;
}

export function findBuiltInMicrophone(devices: DeviceOption[]): DeviceOption | undefined {
  return devices.find((device) => normalizeAudioDeviceName(device.name) === "macbook air microphone")
    ?? devices.find((device) => /\bbuilt[\s-]?in\b/i.test(device.name));
}

export function isSupportedCaptureCard(device: DeviceOption): boolean {
  return device.name.toLocaleLowerCase().includes("elgato 4k s");
}
