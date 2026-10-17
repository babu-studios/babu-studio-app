import { useState } from "react";
import type { CaptureResolutionId, DeviceOption, LayerId, Scene, SceneId, StudioLayer } from "@/features/studio/types/studio.types";
import { getCaptureResolution, getSourceDimensions } from "@/features/studio/utils/crop";
import { isSupportedCaptureCard } from "@/features/studio/utils/devices";
import { requestVideoInputDevices } from "../utils/video-input-devices";

type UseLayerDevicesOptions = {
  currentScene: Scene | null;
  currentLayers: StudioLayer[];
  videoInputDevices: DeviceOption[];
  setVideoInputError: (error: string | null) => void;
  setVideoInputDevices: (devices: DeviceOption[]) => void;
  setBrowserCaptureStream: (layerId: LayerId, stream: MediaStream | null) => void;
  updateLayer: (sceneId: SceneId, layerId: LayerId, update: Partial<StudioLayer>) => void;
};

export function useLayerDevices({
  currentScene,
  currentLayers,
  videoInputDevices,
  setVideoInputError,
  setVideoInputDevices,
  setBrowserCaptureStream,
  updateLayer,
}: UseLayerDevicesOptions) {
  const [layersReloading, setLayersReloading] = useState(false);

  async function changeVideoInputDevice(
    sceneId: SceneId,
    layerId: LayerId,
    layerKind: "camera-device" | "game-capture",
    deviceId: string,
    captureResolution: CaptureResolutionId,
    knownDevices: DeviceOption[] = videoInputDevices,
  ): Promise<void> {
    setVideoInputError(null);
    if (!deviceId) {
      setBrowserCaptureStream(layerId, null);
      updateLayer(sceneId, layerId, {
        deviceId: "",
        captureResolution,
        sourceDimensions: null,
      });
      return;
    }
    const selectedDevice = knownDevices.find((device) => device.id === deviceId);
    if (!selectedDevice) {
      setVideoInputError("The selected video input is no longer available. Refresh the device list and try again.");
      return;
    }
    try {
      const resolution = getCaptureResolution(captureResolution);
      const requireExactResolution = isSupportedCaptureCard(selectedDevice);
      const width = requireExactResolution
        ? { exact: resolution.width }
        : { ideal: resolution.width };
      const height = requireExactResolution
        ? { exact: resolution.height }
        : { ideal: resolution.height };
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: { exact: deviceId },
          width,
          height,
          frameRate: { ideal: 60, max: 60 },
        },
      });
      const trackSettings = stream.getVideoTracks()[0]?.getSettings();
      console.info(layerKind === "game-capture" ? "Capture card stream settings:" : "Camera stream settings:", {
        device: selectedDevice.name,
        requestedResolution: `${resolution.width}x${resolution.height}`,
        width: trackSettings?.width,
        height: trackSettings?.height,
        frameRate: trackSettings?.frameRate,
      });
      setBrowserCaptureStream(layerId, stream);
      updateLayer(sceneId, layerId, {
        deviceId,
        captureResolution,
        sourceDimensions: getSourceDimensions(stream),
      });
    } catch (error) {
      console.error("Unable to start video input:", error);
      setVideoInputError(error instanceof Error ? error.message : String(error));
    }
  }

  async function reloadLayers(): Promise<void> {
    if (!currentScene || layersReloading) {
      return;
    }
    setLayersReloading(true);
    setVideoInputError(null);
    try {
      const reconnectable = currentLayers.filter((layer) => layer.deviceId);
      if (reconnectable.some((layer) => layer.kind === "camera-device" || layer.kind === "game-capture")) {
        const devices = await requestVideoInputDevices();
        setVideoInputDevices(devices);
        for (const layer of reconnectable) {
          if (layer.kind === "camera-device" || layer.kind === "game-capture") {
            await changeVideoInputDevice(
              currentScene.id,
              layer.id,
              layer.kind,
              layer.deviceId,
              layer.captureResolution,
              devices,
            );
          }
        }
      }
    } catch (error) {
      console.error("Unable to reload layers:", error);
      setVideoInputError(error instanceof Error ? error.message : String(error));
    } finally {
      setLayersReloading(false);
    }
  }

  async function changeLayerCaptureResolution(
    sceneId: SceneId,
    layer: StudioLayer,
    captureResolution: CaptureResolutionId,
  ): Promise<void> {
    if (layer.kind !== "camera-device" && layer.kind !== "game-capture") {
      return;
    }
    if (layer.deviceId) {
      await changeVideoInputDevice(sceneId, layer.id, layer.kind, layer.deviceId, captureResolution);
    } else {
      updateLayer(sceneId, layer.id, { captureResolution, sourceDimensions: null });
    }
  }

  return { layersReloading, reloadLayers, changeVideoInputDevice, changeLayerCaptureResolution };
}
