import type { DeviceOption } from "@/features/studio/types/studio.types";

export async function requestVideoInputDevices(): Promise<DeviceOption[]> {
  if (typeof window.babuStudio?.requestCameraAccess === "function") {
    const granted = await window.babuStudio.requestCameraAccess();
    if (!granted) {
      throw new Error("Camera permission was denied. Enable camera access in System Settings and restart Babu Studio.");
    }
  }
  const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
  permissionStream.getTracks().forEach((track) => track.stop());
  return (await navigator.mediaDevices.enumerateDevices())
    .filter((device) => device.kind === "videoinput" && device.deviceId.length > 0)
    .map((device, index) => ({ id: device.deviceId, name: device.label || `Video input ${index + 1}` }));
}
