import type { DeviceOption, LayerKind, Scene, StudioLayer } from "@/features/studio/types/studio.types";
import type { RecordingMode } from "@shared/types/media";

export type RecordingSources = {
  captureLayers: StudioLayer[];
  captureNames: string[];
  cameraNames: string[];
};

export type RecordingSourcesResult =
  | { error: string }
  | { sources: RecordingSources };

export function resolveRecordingSources(
  currentScene: Scene | null,
  currentLayers: StudioLayer[],
  videoInputDevices: DeviceOption[],
  exportModes: RecordingMode[],
): RecordingSourcesResult {
  if (exportModes.length === 0) {
    return { error: "Select at least one export layout before recording." };
  }
  if (!currentScene) {
    return { error: "Create or select a shared scene before starting a recording." };
  }
  const enabledLayers = currentLayers.filter((layer) => layer.enabled);
  const sourceLayers = enabledLayers.filter((layer) => layer.kind === "game-capture" || layer.kind === "camera-device");
  if (sourceLayers.length === 0) {
    return { error: "Add a capture card or camera to the shared scene before recording." };
  }
  const namesForSource = (kind: LayerKind) => [...new Set(
    enabledLayers.filter((layer) => layer.kind === kind)
      .map((layer) => videoInputDevices.find((device) => device.id === layer.deviceId)?.name)
      .filter((name): name is string => Boolean(name)),
  )];
  const captureLayers = enabledLayers.filter((layer) => layer.kind === "game-capture");
  const cameraLayers = enabledLayers.filter((layer) => layer.kind === "camera-device");
  const captureNames = namesForSource("game-capture");
  const cameraNames = namesForSource("camera-device");
  if ((captureLayers.length > 0 && captureNames.length === 0)
    || (cameraLayers.length > 0 && cameraNames.length === 0)) {
    return { error: "A selected capture card or camera is unavailable. Reload the device list or choose another device." };
  }
  if (captureNames.length > 1 || cameraNames.length > 1) {
    return { error: "The shared scene must use only one capture card and one camera for a synchronized recording." };
  }
  return { sources: { captureLayers, captureNames, cameraNames } };
}
