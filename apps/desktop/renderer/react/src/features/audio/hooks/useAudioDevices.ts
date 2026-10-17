import { useState } from "react";
import type { DeviceOption } from "@/features/studio/types/studio.types";

export function useAudioDevices() {
  const [audioInputDevices, setAudioInputDevices] = useState<DeviceOption[]>([]);
  const [audioInputLoading, setAudioInputLoading] = useState(false);
  const [audioInputError, setAudioInputError] = useState<string | null>(null);
  const [audioOutputDevices, setAudioOutputDevices] = useState<DeviceOption[]>([]);

  async function discoverAudioInputs(): Promise<DeviceOption[]> {
    if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices.enumerateDevices) {
      throw new Error("Microphone input discovery is not supported in this environment.");
    }
    if (typeof window.babuStudio?.requestMicrophoneAccess === "function") {
      const granted = await window.babuStudio.requestMicrophoneAccess();
      if (!granted) {
        throw new Error("Microphone permission was denied. Allow Babu Studio under System Settings > Privacy & Security > Microphone, then reopen these settings.");
      }
    }
    const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    let devices: MediaDeviceInfo[];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } finally {
      permissionStream.getTracks().forEach((track) => track.stop());
    }
    const audioInputs = devices
      .filter((device) => device.kind === "audioinput" && device.deviceId !== "default")
      .map((device, index) => ({
        id: device.deviceId,
        name: device.label || `Microphone ${index + 1}`,
      }))
      .filter((device) => device.id.length > 0);
    if (audioInputs.length === 0) {
      throw new Error("No microphone input devices found. Check that a microphone is connected and recognized by the system.");
    }
    setAudioInputDevices(audioInputs);
    setAudioOutputDevices(
      devices
        .filter((device) => device.kind === "audiooutput" && device.deviceId !== "default")
        .map((device, index) => ({
          id: device.deviceId,
          name: device.label || `Output ${index + 1}`,
        })),
    );
    return audioInputs;
  }


  return {
    audioInputDevices,
    setAudioInputDevices,
    audioInputLoading,
    setAudioInputLoading,
    audioInputError,
    setAudioInputError,
    audioOutputDevices,
    discoverAudioInputs,
  };
}
