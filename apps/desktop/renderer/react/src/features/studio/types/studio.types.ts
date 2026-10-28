import { getCropFractions } from "@/features/studio/utils/crop";
import type { NoiseReductionLevel } from "@shared/constants/media.constants";

export type OutputId = "landscape" | "portrait";

export type LayerTransforms = Record<OutputId, LayerTransform>;

export type SceneId = string;

export type SceneAppearance = "gameplay" | "just-chatting" | "starting-soon" | "custom";

export type LayerId = string;

export type LayerKind = "gameplay" | "camera" | "alerts" | "camera-device" | "game-capture";

export type IconName =
  | "record"
  | "stream"
  | "settings"
  | "landscape"
  | "portrait"
  | "layers"
  | "scenes"
  | "audio"
  | "gameplay"
  | "camera"
  | "alerts"
  | "eye"
  | "reload"
  | "eye-off"
  | "speaker"
  | "speaker-muted"
  | "trash"
  | "export"
  | "plus"
  | "close"
  | "sparkle"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "check"
  | "play"
  | "pause";

export type AudioTrack = {
  id: string;
  name: string;
  icon: IconName;
  /** Mixer level in percent of the captured source: 100 is unity, up to 200 boosts it. */
  volume: number;
  /** Noise reduction applied to the microphone track while exporting. */
  noiseReduction: NoiseReductionLevel;
  muted: boolean;
};

export type Scene = {
  id: SceneId;
  name: string;
  appearance: SceneAppearance;
};

export type StudioLayer = {
  id: LayerId;
  name: string;
  icon: IconName;
  kind: LayerKind;
  enabled: boolean;
  deviceId: string;
  captureResolution: CaptureResolutionId;
  crop: CropInsets;
  sourceDimensions: SourceDimensions | null;
  transforms: LayerTransforms;
};

export type LayerTransform = { x: number; y: number; width: number; height: number };

export type CropInsets = { top: number; right: number; bottom: number; left: number };

export type SourceDimensions = { width: number; height: number };

export type CaptureResolutionId = "360p" | "480p" | "720p" | "1080p" | "1440p" | "2160p";

export type CaptureResolution = {
  id: CaptureResolutionId;
  label: string;
  width: number;
  height: number;
};

export type LayerOption = {
  name: string;
  description: string;
  icon: IconName;
  kind: LayerKind;
};

export type PopupPosition = { left: number; top: number };

export type PersistedStudioState = {
  activeScene: SceneId | null;
  scenes: Scene[];
  layersByScene: Record<SceneId, StudioLayer[]>;
  portraitPlacementVersion: number;
};

export type CanvasResizeCorner = "bottom-left" | "bottom-right";

export type CanvasInteraction = {
  pointerId: number;
  layerId: LayerId;
  mode: "move" | CanvasResizeCorner;
  startX: number;
  startY: number;
  surfaceWidth: number;
  surfaceHeight: number;
  cropFractions: ReturnType<typeof getCropFractions>;
  initialVisibleTransform: LayerTransform;
  initialTransform: LayerTransform;
  currentTransform: LayerTransform;
};

export type PersistedAudioMixer = {
  tracks: AudioTrack[];
  selectedInputId: string;
  monitoringEnabled: boolean;
  trackInputIds: Record<string, string>;
  trackOutputIds: Record<string, string>;
};

export type DeviceOption = { id: string; name: string };
