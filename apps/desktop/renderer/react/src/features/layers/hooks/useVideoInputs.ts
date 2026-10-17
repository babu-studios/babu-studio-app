import { useEffect, useState } from "react";
import type { SceneId, LayerId, StudioLayer, DeviceOption } from "@/features/studio/types/studio.types";

export function useVideoInputs(
  settingsLayerId: LayerId | null,
  layersByScene: Record<SceneId, StudioLayer[]>,
) {
  const [videoInputDevices, setVideoInputDevices] = useState<DeviceOption[]>([]);
  const [videoInputLoading, setVideoInputLoading] = useState(false);
  const [videoInputError, setVideoInputError] = useState<string | null>(null);

  useEffect(() => {
    const layer = settingsLayerId
      ? Object.values(layersByScene).flat().find((candidate) => candidate.id === settingsLayerId)
      : null;
    if (layer?.kind !== "camera-device" && layer?.kind !== "game-capture") {
      return;
    }
    let cancelled = false;
    setVideoInputLoading(true);
    setVideoInputError(null);

    async function loadVideoInputs(): Promise<void> {
      try {
        if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices.enumerateDevices) {
          throw new Error("Video input discovery is not supported in this environment.");
        }
        if (typeof window.babuStudio?.requestCameraAccess === "function") {
          const granted = await window.babuStudio.requestCameraAccess();
          if (!granted) {
            throw new Error("Camera permission was denied. Enable camera access in System Settings and restart Babu Studio.");
          }
        }
        const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        permissionStream.getTracks().forEach((track) => track.stop());
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices
          .filter((device) => device.kind === "videoinput")
          .map((device, index) => ({
            id: device.deviceId,
            name: device.label || `Video input ${index + 1}`,
          }))
          .filter((device) => device.id.length > 0);
        if (videoInputs.length === 0) {
          throw new Error("No video input devices found. Check that a camera or capture card is connected and recognized by macOS.");
        }
        if (!cancelled) {
          setVideoInputDevices(videoInputs);
        }
      } catch (error) {
        console.error("Unable to enumerate video input devices:", error);
        if (!cancelled) {
          setVideoInputError(error instanceof Error ? error.message : String(error));
          setVideoInputDevices([]);
        }
      } finally {
        if (!cancelled) {
          setVideoInputLoading(false);
        }
      }
    }

    void loadVideoInputs();
    return () => {
      cancelled = true;
    };
  }, [settingsLayerId]);


  return { videoInputDevices, setVideoInputDevices, videoInputLoading, videoInputError, setVideoInputError };
}
