import type { CaptureResolution, CaptureResolutionId, CropInsets, DeviceOption, IconName, LayerKind, LayerOption, SceneAppearance } from "@/features/studio/types/studio.types";

export const CAPTURE_RESOLUTIONS: CaptureResolution[] = [
  { id: "360p", label: "SD 360p", width: 640, height: 360 },
  { id: "480p", label: "SD 480p", width: 854, height: 480 },
  { id: "720p", label: "HD 720p", width: 1280, height: 720 },
  { id: "1080p", label: "Full HD 1080p", width: 1920, height: 1080 },
  { id: "1440p", label: "QHD 1440p", width: 2560, height: 1440 },
  { id: "2160p", label: "4K 2160p", width: 3840, height: 2160 },
];

export const DEFAULT_CAPTURE_RESOLUTION: CaptureResolutionId = "2160p";

export const DEFAULT_CROP_INSETS: CropInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export const LAYER_OPTIONS: LayerOption[] = [
  { name: "Camera Device", description: "Add a connected webcam or camera.", icon: "camera", kind: "camera-device" },
  { name: "Capture Card", description: "Record gameplay from a capture card.", icon: "gameplay", kind: "game-capture" },
];

export const ICON_NAMES: IconName[] = [
  "record", "stream", "settings", "landscape", "portrait", "layers", "scenes",
  "audio", "gameplay", "camera", "alerts", "reload", "eye", "eye-off", "speaker", "speaker-muted", "trash", "plus",
];

export const SCENE_APPEARANCES: SceneAppearance[] = ["gameplay", "just-chatting", "starting-soon", "custom"];

export const LAYER_KINDS: LayerKind[] = [
  "gameplay", "camera", "alerts", "camera-device", "game-capture",
];

export const LAYER_SOURCE_LABELS: Record<LayerKind, string> = {
  gameplay: "Gameplay capture",
  camera: "Camera",
  alerts: "Alerts",
  "camera-device": "Camera device",
  "game-capture": "Capture Card",
};

export const DEVICE_OPTIONS: Record<LayerKind, DeviceOption[]> = {
  gameplay: [{ id: "gameplay-1", name: "Game source 1 (sample)" }],
  camera: [],
  alerts: [{ id: "alerts-1", name: "Alerts source (sample)" }],
  "camera-device": [],
  "game-capture": [],
};
