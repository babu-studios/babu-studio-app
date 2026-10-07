import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Dropdown } from "./components/common/Dropdown";
import { IconButton } from "./components/common/IconButton";
import type { DesktopCaptureSource } from "@shared/types/capture";

type OutputId = "landscape" | "portrait";
type SceneId = string;
type SceneAppearance = "gameplay" | "just-chatting" | "starting-soon" | "custom";
type LayerId = string;
type LayerKind = "gameplay" | "camera" | "alerts" | "camera-device" | "display-capture" | "game-capture";
type IconName =
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
  | "plus";

type AudioTrack = {
  id: string;
  name: string;
  icon: IconName;
  volume: number;
  muted: boolean;
};

const AUDIO_SOURCE_OPTIONS = [
  { id: "capture-card", name: "Capture card", description: "Audio from a capture device" },
] as const;

type Scene = {
  id: SceneId;
  name: string;
  appearance: SceneAppearance;
};

type StudioLayer = {
  id: LayerId;
  name: string;
  icon: IconName;
  kind: LayerKind;
  enabled: boolean;
  deviceId: string;
  captureResolution: CaptureResolutionId;
  crop: CropInsets;
  sourceDimensions: SourceDimensions | null;
  transform: LayerTransform;
};

type LayerTransform = { x: number; y: number; width: number; height: number };
type CropInsets = { top: number; right: number; bottom: number; left: number };
type SourceDimensions = { width: number; height: number };
type CaptureResolutionId = "720p" | "1080p" | "1440p" | "2160p";
type CaptureResolution = {
  id: CaptureResolutionId;
  label: string;
  width: number;
  height: number;
};
type LayerOption = {
  name: string;
  description: string;
  icon: IconName;
  kind: LayerKind;
};
type PopupPosition = { left: number; top: number };
type PersistedStudioState = {
  selectedOutput: OutputId;
  activeScenes: Record<OutputId, SceneId | null>;
  scenesByOutput: Record<OutputId, Scene[]>;
  layersByScene: Record<SceneId, StudioLayer[]>;
};
type CanvasResizeCorner = "bottom-left" | "bottom-right";
type CanvasInteraction = {
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
type ElectronDesktopCaptureConstraints = MediaTrackConstraints & {
  width?: { ideal: number };
  height?: { ideal: number };
  frameRate?: { ideal: number; max: number };
  mandatory: {
    chromeMediaSource: "desktop";
    chromeMediaSourceId: string;
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    minFrameRate?: number;
    maxFrameRate?: number;
  };
};
const BROWSER_DISPLAY_CAPTURE_ID = "__browser-display-capture__";

const OUTPUTS: { id: OutputId; name: string; ratio: string; size: string; icon: IconName }[] = [
  { id: "landscape", name: "Landscape", ratio: "16:9", size: "1920 × 1080", icon: "landscape" },
  { id: "portrait", name: "Portrait", ratio: "9:16", size: "1080 × 1920", icon: "portrait" },
];

const CAPTURE_RESOLUTIONS: CaptureResolution[] = [
  { id: "720p", label: "HD 720p", width: 1280, height: 720 },
  { id: "1080p", label: "Full HD 1080p", width: 1920, height: 1080 },
  { id: "1440p", label: "QHD 1440p", width: 2560, height: 1440 },
  { id: "2160p", label: "4K 2160p", width: 3840, height: 2160 },
];
const DEFAULT_CAPTURE_RESOLUTION: CaptureResolutionId = "2160p";
const DEFAULT_CROP_INSETS: CropInsets = { top: 0, right: 0, bottom: 0, left: 0 };

let nextCustomSceneId = 1;
let nextLayerId = 1;

const LAYER_OPTIONS: LayerOption[] = [
  { name: "Camera Device", description: "Add a connected webcam or camera.", icon: "camera", kind: "camera-device" },
  { name: "Display Capture", description: "Capture a monitor or application window.", icon: "landscape", kind: "display-capture" },
  { name: "Capture Card", description: "Capture a game or application window.", icon: "gameplay", kind: "game-capture" },
];

const STUDIO_STATE_STORAGE_KEY = "dui-studio.studio-state.v1";
const AUDIO_MIXER_STORAGE_KEY = "dui-studio.audio-mixer.v1";

type PersistedAudioMixer = {
  tracks: AudioTrack[];
  selectedInputId: string;
  monitoringEnabled: boolean;
  trackInputIds: Record<string, string>;
  trackOutputIds: Record<string, string>;
};

const DEFAULT_AUDIO_MIXER: PersistedAudioMixer = {
  tracks: [{ id: "mic", name: "Microphone", icon: "audio", volume: 100, muted: false }],
  selectedInputId: "",
  monitoringEnabled: false,
  trackInputIds: {},
  trackOutputIds: {},
};

function readStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function loadAudioMixer(): PersistedAudioMixer {
  try {
    const saved = localStorage.getItem(AUDIO_MIXER_STORAGE_KEY);
    if (!saved) {
      return DEFAULT_AUDIO_MIXER;
    }
    const parsed: unknown = JSON.parse(saved);
    if (!isRecord(parsed) || !Array.isArray(parsed.tracks)) {
      return DEFAULT_AUDIO_MIXER;
    }
    const tracks = parsed.tracks.flatMap((track): AudioTrack[] => (
      isRecord(track)
        && typeof track.id === "string"
        && typeof track.name === "string"
        && typeof track.volume === "number"
        && typeof track.muted === "boolean"
        ? [{
          id: track.id,
          name: track.name,
          icon: "audio",
          volume: Math.max(0, Math.min(100, track.volume)),
          muted: track.muted,
        }]
        : []
    ));
    if (!tracks.some((track) => track.id === "mic")) {
      tracks.unshift(DEFAULT_AUDIO_MIXER.tracks[0]);
    }
    return {
      tracks,
      selectedInputId: typeof parsed.selectedInputId === "string" ? parsed.selectedInputId : "",
      monitoringEnabled: parsed.monitoringEnabled === true,
      trackInputIds: readStringRecord(parsed.trackInputIds),
      trackOutputIds: readStringRecord(parsed.trackOutputIds),
    };
  } catch (error) {
    console.error("Unable to restore the audio mixer:", error);
    return DEFAULT_AUDIO_MIXER;
  }
}
const ICON_NAMES: IconName[] = [
  "record", "stream", "settings", "landscape", "portrait", "layers", "scenes",
  "audio", "gameplay", "camera", "alerts", "reload", "eye", "eye-off", "speaker", "speaker-muted", "trash", "plus",
];
const SCENE_APPEARANCES: SceneAppearance[] = ["gameplay", "just-chatting", "starting-soon", "custom"];
const LAYER_KINDS: LayerKind[] = [
  "gameplay", "camera", "alerts", "camera-device", "display-capture", "game-capture",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScene(value: unknown): value is Scene {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && SCENE_APPEARANCES.some((appearance) => appearance === value.appearance);
}

function isLayerTransform(value: unknown): value is LayerTransform {
  if (!isRecord(value)) {
    return false;
  }
  const { x, y, width, height } = value;
  return typeof x === "number"
    && Number.isFinite(x)
    && typeof y === "number"
    && Number.isFinite(y)
    && typeof width === "number"
    && Number.isFinite(width)
    && typeof height === "number"
    && Number.isFinite(height)
    && Math.abs(x) <= 1000
    && Math.abs(y) <= 1000
    && width >= 5
    && height >= 5
    && width <= 1000
    && height <= 1000;
}

function isCaptureResolutionId(value: unknown): value is CaptureResolutionId {
  return CAPTURE_RESOLUTIONS.some((resolution) => resolution.id === value);
}

function isCropInsets(value: unknown): value is CropInsets {
  return isRecord(value) && ["top", "right", "bottom", "left"].every((side) => {
    const amount = value[side];
    return typeof amount === "number"
      && Number.isInteger(amount)
      && amount >= 0
      && amount <= 10000;
  });
}

function isSourceDimensions(value: unknown): value is SourceDimensions {
  return isRecord(value)
    && typeof value.width === "number"
    && Number.isFinite(value.width)
    && value.width > 0
    && typeof value.height === "number"
    && Number.isFinite(value.height)
    && value.height > 0;
}

function getCaptureResolution(id: CaptureResolutionId): CaptureResolution {
  const resolution = CAPTURE_RESOLUTIONS.find((option) => option.id === id);
  if (!resolution) {
    throw new Error(`Unsupported capture resolution: ${id}`);
  }
  return resolution;
}

function getSourceDimensions(stream: MediaStream): SourceDimensions | null {
  const settings = stream.getVideoTracks()[0]?.getSettings();
  return settings?.width && settings.height
    ? { width: settings.width, height: settings.height }
    : null;
}

function getCropFractions(crop: CropInsets, sourceWidth: number, sourceHeight: number) {
  const width = Math.max(1, Math.round(sourceWidth));
  const height = Math.max(1, Math.round(sourceHeight));
  const left = Math.min(width - 1, crop.left);
  const right = Math.min(width - left - 1, crop.right);
  const top = Math.min(height - 1, crop.top);
  const bottom = Math.min(height - top - 1, crop.bottom);

  return {
    left: left / width,
    top: top / height,
    visibleWidth: (width - left - right) / width,
    visibleHeight: (height - top - bottom) / height,
  };
}

function getCroppedVideoStyle(
  crop: CropInsets,
  sourceWidth: number,
  sourceHeight: number,
): CSSProperties {
  const fractions = getCropFractions(crop, sourceWidth, sourceHeight);

  return {
    position: "absolute",
    left: `${-fractions.left / fractions.visibleWidth * 100}%`,
    top: `${-fractions.top / fractions.visibleHeight * 100}%`,
    width: `${100 / fractions.visibleWidth}%`,
    height: `${100 / fractions.visibleHeight}%`,
  };
}

function getCroppedLayerTransform(
  transform: LayerTransform,
  crop: CropInsets,
  sourceDimensions: SourceDimensions,
): LayerTransform {
  const fractions = getCropFractions(crop, sourceDimensions.width, sourceDimensions.height);
  return {
    x: transform.x + transform.width * fractions.left,
    y: transform.y + transform.height * fractions.top,
    width: transform.width * fractions.visibleWidth,
    height: transform.height * fractions.visibleHeight,
  };
}

function getDefaultLayerTransform(kind: LayerKind): LayerTransform {
  if (kind === "camera-device") {
    return { x: 70, y: 68, width: 25, height: 25 };
  }
  if (kind === "display-capture") {
    return { x: 0, y: 0, width: 100, height: 100 };
  }
  if (kind === "game-capture") {
    return { x: 20, y: 20, width: 60, height: 60 };
  }
  if (kind === "gameplay") {
    return { x: 0, y: 0, width: 100, height: 100 };
  }
  if (kind === "camera") {
    return { x: 70, y: 68, width: 25, height: 25 };
  }
  return { x: 38, y: 10, width: 24, height: 16 };
}

function parseStudioLayer(value: unknown): StudioLayer | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, name, enabled, deviceId } = value;
  const icon = ICON_NAMES.find((candidate) => candidate === value.icon);
  const kind = LAYER_KINDS.find((candidate) => candidate === value.kind);
  if (
    typeof id !== "string"
    || typeof name !== "string"
    || !icon
    || !kind
    || typeof enabled !== "boolean"
    || typeof deviceId !== "string"
  ) {
    return null;
  }

  return {
    id,
    name: kind === "game-capture" && name === "Game Capture" ? "Capture Card" : name,
    icon,
    kind,
    enabled,
    deviceId,
    captureResolution: isCaptureResolutionId(value.captureResolution)
      ? value.captureResolution
      : DEFAULT_CAPTURE_RESOLUTION,
    crop: isCropInsets(value.crop) ? value.crop : { ...DEFAULT_CROP_INSETS },
    sourceDimensions: isSourceDimensions(value.sourceDimensions) ? value.sourceDimensions : null,
    transform: isLayerTransform(value.transform) ? value.transform : getDefaultLayerTransform(kind),
  };
}

function loadPersistedStudioState(): PersistedStudioState {
  const emptyState: PersistedStudioState = {
    selectedOutput: "landscape",
    activeScenes: { landscape: null, portrait: null },
    scenesByOutput: { landscape: [], portrait: [] },
    layersByScene: {},
  };

  try {
    const savedState = localStorage.getItem(STUDIO_STATE_STORAGE_KEY);
    if (!savedState) {
      return emptyState;
    }

    const parsed: unknown = JSON.parse(savedState);
    if (!isRecord(parsed)) {
      throw new Error("Saved studio state must be an object.");
    }

    const scenesByOutput: Record<OutputId, Scene[]> = { landscape: [], portrait: [] };
    for (const output of OUTPUTS) {
      const scenes = isRecord(parsed.scenesByOutput) ? parsed.scenesByOutput[output.id] : null;
      if (Array.isArray(scenes)) {
        scenesByOutput[output.id] = scenes.filter(isScene);
      }
    }

    const sceneIds = new Set(Object.values(scenesByOutput).flat().map((scene) => scene.id));
    const layersByScene: Record<SceneId, StudioLayer[]> = {};
    if (isRecord(parsed.layersByScene)) {
      for (const [sceneId, layers] of Object.entries(parsed.layersByScene)) {
        if (sceneIds.has(sceneId) && Array.isArray(layers)) {
          layersByScene[sceneId] = layers
            .map(parseStudioLayer)
            .filter((layer): layer is StudioLayer => layer !== null);
        }
      }
    }

    const activeScenes: Record<OutputId, SceneId | null> = { landscape: null, portrait: null };
    if (isRecord(parsed.activeScenes)) {
      for (const output of OUTPUTS) {
        const sceneId = parsed.activeScenes[output.id];
        if (typeof sceneId === "string" && scenesByOutput[output.id].some((scene) => scene.id === sceneId)) {
          activeScenes[output.id] = sceneId;
        }
      }
    }

    return {
      selectedOutput: parsed.selectedOutput === "portrait" ? "portrait" : "landscape",
      activeScenes,
      scenesByOutput,
      layersByScene,
    };
  } catch (error) {
    console.error("Could not load saved DUI Studio scenes and layers.", error);
    return emptyState;
  }
}

function savePersistedStudioState(state: PersistedStudioState): void {
  try {
    localStorage.setItem(STUDIO_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Could not save DUI Studio scenes and layers.", error);
  }
}

function isElectronRenderer(): boolean {
  return typeof window.duiStudio !== "undefined"
    || window.location.protocol === "file:"
    || new URLSearchParams(window.location.search).has("duiStudioElectron");
}

const LAYER_SOURCE_LABELS: Record<LayerKind, string> = {
  gameplay: "Gameplay capture",
  camera: "Camera",
  alerts: "Alerts",
  "camera-device": "Camera device",
  "display-capture": "Display capture",
  "game-capture": "Capture Card",
};

type DeviceOption = { id: string; name: string };

function isSupportedCaptureCard(device: DeviceOption): boolean {
  return device.name.toLocaleLowerCase().includes("elgato 4k s");
}

const DEVICE_OPTIONS: Record<LayerKind, DeviceOption[]> = {
  gameplay: [{ id: "gameplay-1", name: "Game source 1 (sample)" }],
  camera: [],
  alerts: [{ id: "alerts-1", name: "Alerts source (sample)" }],
  "camera-device": [],
  "display-capture": [],
  "game-capture": [],
};

function getSidebarPopupPosition(
  sidebar: HTMLElement | null,
  anchor: HTMLElement | null,
  popup: HTMLElement | null,
): PopupPosition | null {
  if (!sidebar || !anchor || !popup) {
    return null;
  }

  const sidebarRect = sidebar.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  const left = Math.max(8, Math.min(sidebarRect.right + 8, window.innerWidth - popupRect.width - 8));
  const maxTop = Math.max(8, window.innerHeight - popupRect.height - 8);
  const top = Math.max(8, Math.min(anchorRect.top, maxTop));
  return { left, top };
}

function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  const drawings: Record<IconName, ReactNode> = {
    record: <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />,
    stream: (
      <>
        <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
        <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
      </>
    ),
    settings: (
      <>
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    landscape: <rect x="3.5" y="5.5" width="17" height="13" rx="2" />,
    portrait: <rect x="7" y="3" width="10" height="18" rx="2" />,
    layers: (
      <>
        <path d="m12 3 9 5-9 5-9-5 9-5Z" />
        <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
      </>
    ),
    scenes: (
      <>
        <rect x="3.5" y="4.5" width="17" height="6" rx="1.5" />
        <rect x="3.5" y="13.5" width="17" height="6" rx="1.5" />
      </>
    ),
    audio: (
      <>
        <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10v4" />
      </>
    ),
    gameplay: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m8 10 3 2-3 2M13.5 14H17" />
      </>
    ),
    camera: (
      <>
        <rect x="3" y="6" width="13" height="12" rx="2" />
        <path d="m16 10 5-3v10l-5-3" />
      </>
    ),
    alerts: (
      <>
        <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" />
      </>
    ),
    speaker: (
      <>
        <path d="M4 10v4h4l5 4V6l-5 4H4Z" />
        <path d="M17 9a5 5 0 0 1 0 6M19.5 6.5a9 9 0 0 1 0 11" />
      </>
    ),
    reload: (
      <>
        <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
        <path d="M21 3v5h-5" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    "eye-off": (
      <>
        <path d="M9.9 5.2A9.8 9.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.9 3.8M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1" />
        <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
      </>
    ),
    "speaker-muted": (
      <>
        <path d="M4 10v4h4l5 4V6l-5 4H4Z" />
        <path d="M17 9.5l5 5M22 9.5l-5 5" />
      </>
    ),
    trash: (
      <>
        <path d="M3.5 6h17M9 6V4h6v2M6 6l1 14h10l1-14M10 10v6M14 10v6" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
  };

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {drawings[name]}
    </svg>
  );
}

function DisplayCaptureVideo({
  sourceId,
  browserStream,
  resolution,
  crop,
  onSourceDimensions,
}: {
  sourceId: string;
  browserStream?: MediaStream;
  resolution: CaptureResolution;
  crop: CropInsets;
  onSourceDimensions: (dimensions: SourceDimensions) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [videoSize, setVideoSize] = useState({ width: resolution.width, height: resolution.height });

  useEffect(() => {
    setVideoSize({ width: resolution.width, height: resolution.height });
    if (browserStream) {
      const dimensions = getSourceDimensions(browserStream);
      if (dimensions) {
        onSourceDimensions(dimensions);
      }
      if (videoRef.current) {
        videoRef.current.srcObject = browserStream;
      }
      return () => {
        if (videoRef.current?.srcObject === browserStream) {
          videoRef.current.srcObject = null;
        }
      };
    }
    if (!sourceId || sourceId === BROWSER_DISPLAY_CAPTURE_ID) {
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    setCaptureError(null);

    const constraints: ElectronDesktopCaptureConstraints = {
      width: { ideal: resolution.width },
      height: { ideal: resolution.height },
      frameRate: { ideal: 60, max: 60 },
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        minWidth: 640,
        maxWidth: resolution.width,
        minHeight: 480,
        maxHeight: resolution.height,
        minFrameRate: 30,
        maxFrameRate: 60,
      },
    };

    const basicConstraints: ElectronDesktopCaptureConstraints = {
      mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId },
    };

    navigator.mediaDevices.getUserMedia({ audio: false, video: constraints }).catch((error: unknown) => {
      console.warn("Display capture with preferred constraints failed, retrying with basic constraints:", error);
      return navigator.mediaDevices.getUserMedia({ audio: false, video: basicConstraints });
    }).then((captureStream) => {
      if (cancelled) {
        captureStream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = captureStream;
      const trackSettings = captureStream.getVideoTracks()[0]?.getSettings();
      const dimensions = getSourceDimensions(captureStream);
      if (dimensions) {
        onSourceDimensions(dimensions);
      }
      console.info("Display capture stream settings:", {
        requestedResolution: `${resolution.width}x${resolution.height}`,
        width: trackSettings?.width,
        height: trackSettings?.height,
        frameRate: trackSettings?.frameRate,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = captureStream;
      }
    }).catch((error: unknown) => {
      console.error("Unable to start display capture:", error);
      if (!cancelled) {
        setCaptureError(error instanceof Error ? error.message : String(error));
      }
    });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [sourceId, browserStream, resolution]);

  return (
    <>
      <video
        className="source-preview-video"
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={getCroppedVideoStyle(crop, videoSize.width, videoSize.height)}
        onLoadedMetadata={(event) => {
          const dimensions = {
            width: event.currentTarget.videoWidth || resolution.width,
            height: event.currentTarget.videoHeight || resolution.height,
          };
          setVideoSize(dimensions);
          onSourceDimensions(dimensions);
        }}
      />
      {captureError && (
        <span className="source-preview-label" title={captureError}>
          Capture unavailable: {captureError}
        </span>
      )}
    </>
  );
}

function MediaStreamVideo({
  stream,
  resolution,
  crop,
  onSourceDimensions,
}: {
  stream: MediaStream;
  resolution: CaptureResolution;
  crop: CropInsets;
  onSourceDimensions: (dimensions: SourceDimensions) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoSize, setVideoSize] = useState({ width: resolution.width, height: resolution.height });

  useEffect(() => {
    const settings = stream.getVideoTracks()[0]?.getSettings();
    setVideoSize({
      width: settings?.width ?? resolution.width,
      height: settings?.height ?? resolution.height,
    });
    const dimensions = getSourceDimensions(stream);
    if (dimensions) {
      onSourceDimensions(dimensions);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
    return () => {
      if (videoRef.current?.srcObject === stream) {
        videoRef.current.srcObject = null;
      }
    };
  }, [stream]);

  return (
    <video
      className="source-preview-video"
      ref={videoRef}
      autoPlay
      muted
      playsInline
      style={getCroppedVideoStyle(crop, videoSize.width, videoSize.height)}
      onLoadedMetadata={(event) => {
        const dimensions = {
          width: event.currentTarget.videoWidth || resolution.width,
          height: event.currentTarget.videoHeight || resolution.height,
        };
        setVideoSize(dimensions);
        onSourceDimensions(dimensions);
      }}
    />
  );
}

function OutputPreview({
  output,
  active,
  scene,
  layers,
  guides,
  selectedLayerId,
  browserCaptureStreams,
  onSelect,
  onSelectLayer,
  onTransformChange,
  onSourceDimensionsChange,
}: {
  output: (typeof OUTPUTS)[number];
  active: boolean;
  scene: Scene | null;
  layers: StudioLayer[];
  guides: boolean;
  selectedLayerId: LayerId | null;
  browserCaptureStreams: Record<LayerId, MediaStream>;
  onSelect: () => void;
  onSelectLayer: (layerId: LayerId) => void;
  onTransformChange: (layerId: LayerId, transform: LayerTransform) => void;
  onSourceDimensionsChange: (layerId: LayerId, dimensions: SourceDimensions) => void;
}) {
  const surfaceRef = useRef<HTMLSpanElement>(null);
  const interactionRef = useRef<CanvasInteraction | null>(null);
  const [dragTransform, setDragTransform] = useState<{ layerId: LayerId; transform: LayerTransform } | null>(null);

  function beginLayerInteraction(event: ReactPointerEvent<HTMLSpanElement>, layer: StudioLayer): void {
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    onSelectLayer(layer.id);

    const surface = surfaceRef.current;
    const bounds = surface?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    const corner = target?.closest("[data-resize-corner]")?.getAttribute("data-resize-corner");
    const resizeCorner: CanvasResizeCorner | null = corner === "bottom-left"
      || corner === "bottom-right"
      ? corner
      : null;
    const sourceDimensions = layer.sourceDimensions ?? getCaptureResolution(layer.captureResolution);
    const cropFractions = getCropFractions(layer.crop, sourceDimensions.width, sourceDimensions.height);
    const initialVisibleTransform = getCroppedLayerTransform(layer.transform, layer.crop, sourceDimensions);
    interactionRef.current = {
      pointerId: event.pointerId,
      layerId: layer.id,
      mode: resizeCorner ?? "move",
      startX: event.clientX,
      startY: event.clientY,
      surfaceWidth: bounds.width,
      surfaceHeight: bounds.height,
      cropFractions,
      initialVisibleTransform,
      initialTransform: layer.transform,
      currentTransform: layer.transform,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveLayerInteraction(event: ReactPointerEvent<HTMLSpanElement>): void {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const deltaX = ((event.clientX - interaction.startX) / interaction.surfaceWidth) * 100;
    const deltaY = ((event.clientY - interaction.startY) / interaction.surfaceHeight) * 100;
    const initial = interaction.initialTransform;
    let transform: LayerTransform;
    if (interaction.mode === "move") {
      transform = {
        ...initial,
        x: Math.min(1000, Math.max(-1000, initial.x + deltaX)),
        y: Math.min(1000, Math.max(-1000, initial.y + deltaY)),
      };
    } else {
      const visibleInitial = interaction.initialVisibleTransform;
      const centerX = visibleInitial.x + visibleInitial.width / 2;
      const centerY = visibleInitial.y + visibleInitial.height / 2;
      const percentAspectRatio = visibleInitial.width / visibleInitial.height;
      const heightDeltaFromX = deltaX
        * (interaction.mode === "bottom-left" ? -1 : 1)
        / percentAspectRatio;
      const heightDelta = Math.abs(deltaY) >= Math.abs(heightDeltaFromX) ? deltaY * 2 : heightDeltaFromX * 2;
      const minHeight = Math.max(
        5 * interaction.cropFractions.visibleHeight,
        5 * interaction.cropFractions.visibleWidth / percentAspectRatio,
      );
      const maxHeight = Math.min(
        1000 * interaction.cropFractions.visibleHeight,
        1000 * interaction.cropFractions.visibleWidth / percentAspectRatio,
      );
      const height = Math.min(maxHeight, Math.max(minHeight, visibleInitial.height + heightDelta));
      const width = height * percentAspectRatio;
      const visibleX = centerX - width / 2;
      const visibleY = centerY - height / 2;
      const baseWidth = width / interaction.cropFractions.visibleWidth;
      const baseHeight = height / interaction.cropFractions.visibleHeight;
      transform = {
        ...initial,
        x: Math.min(1000, Math.max(-1000, visibleX - baseWidth * interaction.cropFractions.left)),
        y: Math.min(1000, Math.max(-1000, visibleY - baseHeight * interaction.cropFractions.top)),
        width: baseWidth,
        height: baseHeight,
      };
    }
    interaction.currentTransform = transform;
    setDragTransform({ layerId: interaction.layerId, transform });
  }

  function finishLayerInteraction(event: ReactPointerEvent<HTMLSpanElement>): void {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = null;
    setDragTransform(null);
    onTransformChange(interaction.layerId, interaction.currentTransform);
  }

  const visibleLayers = layers.filter((layer) => layer.enabled);
  const isPositionableSource = (layer: StudioLayer) => (
    layer.kind === "camera-device"
    || layer.kind === "display-capture"
    || layer.kind === "game-capture"
  );
  const sourceLayers = visibleLayers.filter(isPositionableSource);
  const selectedSource = sourceLayers.find((layer) => layer.id === selectedLayerId);
  const selectedSourceTransform = selectedSource
    ? getCroppedLayerTransform(
      dragTransform?.layerId === selectedSource.id ? dragTransform.transform : selectedSource.transform,
      selectedSource.crop,
      selectedSource.sourceDimensions ?? getCaptureResolution(selectedSource.captureResolution),
    )
    : null;
  const cornerResizeHandlePositions: Record<CanvasResizeCorner, { left: string; top: string }> | null = selectedSourceTransform
    ? {
      "bottom-left": {
        left: `${Math.min(98, Math.max(2, selectedSourceTransform.x))}%`,
        top: `${Math.min(98, Math.max(2, selectedSourceTransform.y + selectedSourceTransform.height))}%`,
      },
      "bottom-right": {
        left: `${Math.min(98, Math.max(2, selectedSourceTransform.x + selectedSourceTransform.width))}%`,
        top: `${Math.min(98, Math.max(2, selectedSourceTransform.y + selectedSourceTransform.height))}%`,
      },
    }
    : null;

  return (
    <button
      className={`preview-card${active ? " preview-card--active" : ""}`}
      onClick={onSelect}
      aria-pressed={active}
      aria-label={`Select ${output.name} ${output.ratio} output for configuration`}
    >
      <span className="preview-card-heading">
        <span className="preview-output-name">
          <Icon name={output.icon} />
          {output.name}
        </span>
        <span className="preview-ratio">{output.ratio}</span>
      </span>
      <span
        ref={surfaceRef}
        className={`preview-surface preview-surface--${output.id} scene-${scene?.appearance ?? "empty"}`}
      >
        {scene && visibleLayers.filter((layer) => layer.kind === "gameplay").map((layer) => (
          <span className="game-art" key={layer.id} aria-hidden="true">
            <span className="game-sun" />
            <span className="game-horizon" />
            <span className="game-ridge game-ridge--back" />
            <span className="game-ridge game-ridge--front" />
            <span className="game-grid" />
          </span>
        ))}
        {scene && visibleLayers.filter((layer) => layer.kind === "alerts").map((layer) => (
          <span className="alert-preview" key={layer.id}>
            ALERT PREVIEW
          </span>
        ))}
        {scene && visibleLayers.filter((layer) => layer.kind === "camera").map((layer) => (
          <span className="camera-preview" key={layer.id}>
            <span className="camera-avatar" />
            <span className="camera-label">CAM</span>
          </span>
        ))}
        {scene && sourceLayers.map((layer, layerIndex) => {
          const baseTransform = dragTransform?.layerId === layer.id ? dragTransform.transform : layer.transform;
          const sourceDimensions = layer.sourceDimensions ?? getCaptureResolution(layer.captureResolution);
          const transform = getCroppedLayerTransform(baseTransform, layer.crop, sourceDimensions);
          const selected = selectedLayerId === layer.id;
          const sourceOutsideCanvas = transform.x + transform.width <= 0
            || transform.x >= 100
            || transform.y + transform.height <= 0
            || transform.y >= 100;
          const offscreenMovePosition = {
            left: `${Math.min(98, Math.max(2, transform.x + transform.width / 2))}%`,
            top: `${Math.min(98, Math.max(2, transform.y + transform.height / 2))}%`,
          };
          return (
            <Fragment key={layer.id}>
              <span
                className={`source-preview-object${selected ? " source-preview-object--selected" : ""}`}
                style={{
                  left: `${transform.x}%`,
                  top: `${transform.y}%`,
                  width: `${transform.width}%`,
                  height: `${transform.height}%`,
                  zIndex: sourceLayers.length - layerIndex,
                }}
                title="Drag to move. Use either bottom corner to resize proportionally around the center. Objects may extend beyond the canvas."
                onPointerDown={(event) => beginLayerInteraction(event, layer)}
                onPointerMove={moveLayerInteraction}
                onPointerUp={finishLayerInteraction}
                onPointerCancel={finishLayerInteraction}
                onClick={(event) => event.stopPropagation()}
              >
                {layer.kind === "display-capture"
                  && layer.deviceId
                  && layer.deviceId !== BROWSER_DISPLAY_CAPTURE_ID
                  ? (
                    <DisplayCaptureVideo
                      sourceId={layer.deviceId}
                      resolution={getCaptureResolution(layer.captureResolution)}
                      crop={layer.crop}
                      onSourceDimensions={(dimensions) => onSourceDimensionsChange(layer.id, dimensions)}
                    />
                  )
                  : layer.kind === "display-capture"
                    && layer.deviceId === BROWSER_DISPLAY_CAPTURE_ID
                    && browserCaptureStreams[layer.id]
                    ? (
                      <DisplayCaptureVideo
                        sourceId={BROWSER_DISPLAY_CAPTURE_ID}
                        browserStream={browserCaptureStreams[layer.id]}
                        resolution={getCaptureResolution(layer.captureResolution)}
                        crop={layer.crop}
                        onSourceDimensions={(dimensions) => onSourceDimensionsChange(layer.id, dimensions)}
                      />
                    )
                  : (layer.kind === "camera-device" || layer.kind === "game-capture")
                    && layer.deviceId
                    && browserCaptureStreams[layer.id]
                    ? (
                      <MediaStreamVideo
                        stream={browserCaptureStreams[layer.id]}
                        resolution={getCaptureResolution(layer.captureResolution)}
                        crop={layer.crop}
                        onSourceDimensions={(dimensions) => onSourceDimensionsChange(layer.id, dimensions)}
                      />
                    )
                  : (
                    <span className="source-preview-label">
                      {layer.deviceId === BROWSER_DISPLAY_CAPTURE_ID
                        ? "Select display again to resume capture"
                        : layer.deviceId
                          ? "Reconnect video input in settings"
                          : "No device selected"}
                    </span>
                  )}
              </span>
              {sourceOutsideCanvas && (
                <span
                  className="source-preview-offscreen-handle"
                  role="button"
                  tabIndex={0}
                  aria-label={`Drag ${layer.name} back into the preview`}
                  style={{
                    ...offscreenMovePosition,
                    zIndex: sourceLayers.length + 2,
                  }}
                  title={`Drag ${layer.name} back into the preview`}
                  onPointerDown={(event) => beginLayerInteraction(event, layer)}
                  onPointerMove={moveLayerInteraction}
                  onPointerUp={finishLayerInteraction}
                  onPointerCancel={finishLayerInteraction}
                  onClick={(event) => event.stopPropagation()}
                />
              )}
              {selected && cornerResizeHandlePositions && (
                (["bottom-left", "bottom-right"] as const).map((corner) => (
                <span
                  key={corner}
                  className={`source-preview-corner-resize-handle source-preview-corner-resize-handle--${corner}`}
                  data-resize-corner={corner}
                  role="button"
                  tabIndex={0}
                  aria-label={`Resize from ${corner} corner, keep video aspect ratio`}
                  style={{
                    ...cornerResizeHandlePositions[corner],
                    zIndex: sourceLayers.length + 4,
                  }}
                  title="Drag corner to resize proportionally around the center"
                  onPointerDown={(event) => beginLayerInteraction(event, layer)}
                  onPointerMove={moveLayerInteraction}
                  onPointerUp={finishLayerInteraction}
                  onPointerCancel={finishLayerInteraction}
                  onClick={(event) => event.stopPropagation()}
                />
                ))
              )}
            </Fragment>
          );
        })}
        {guides && <span className="safe-area-guide" aria-hidden="true" />}
      </span>
      <span className="preview-card-footer">
        <span>{output.size}</span>
        <span className="preview-state">
          <span className="preview-live-dot" />
          PREVIEW
        </span>
      </span>
    </button>
  );
}

export default function App() {
  const [initialStudioState] = useState(loadPersistedStudioState);
  const [selectedOutput, setSelectedOutput] = useState<OutputId>(initialStudioState.selectedOutput);
  const [activeScenes, setActiveScenes] = useState<Record<OutputId, SceneId | null>>(initialStudioState.activeScenes);
  const [scenesByOutput, setScenesByOutput] = useState<Record<OutputId, Scene[]>>(initialStudioState.scenesByOutput);
  const [editingScene, setEditingScene] = useState<{ outputId: OutputId; sceneId: SceneId } | null>(null);
  const [sceneNameDraft, setSceneNameDraft] = useState("");
  const [layersByScene, setLayersByScene] = useState<Record<SceneId, StudioLayer[]>>(initialStudioState.layersByScene);
  const [selectedCanvasObject, setSelectedCanvasObject] = useState<{ sceneId: SceneId; layerId: LayerId } | null>(null);
  const [settingsLayerId, setSettingsLayerId] = useState<LayerId | null>(null);
  const [desktopCaptureSources, setDesktopCaptureSources] = useState<DesktopCaptureSource[]>([]);
  const [desktopCaptureLoading, setDesktopCaptureLoading] = useState(false);
  const [desktopCaptureError, setDesktopCaptureError] = useState<string | null>(null);
  const [browserPickerAvailable, setBrowserPickerAvailable] = useState(false);
  const [browserCaptureStreams, setBrowserCaptureStreams] = useState<Record<LayerId, MediaStream>>({});
  const [videoInputDevices, setVideoInputDevices] = useState<DeviceOption[]>([]);
  const [videoInputLoading, setVideoInputLoading] = useState(false);
  const [videoInputError, setVideoInputError] = useState<string | null>(null);
  const [audioInputDevices, setAudioInputDevices] = useState<DeviceOption[]>([]);
  const [audioInputLoading, setAudioInputLoading] = useState(false);
  const [audioInputError, setAudioInputError] = useState<string | null>(null);
  const [savedAudioMixer] = useState(loadAudioMixer);
  const [selectedAudioInputId, setSelectedAudioInputId] = useState(savedAudioMixer.selectedInputId);
  const [audioMonitoringEnabled, setAudioMonitoringEnabled] = useState(savedAudioMixer.monitoringEnabled);
  const [audioMeterLevels, setAudioMeterLevels] = useState<Record<string, number>>({});
  const [draggedLayerId, setDraggedLayerId] = useState<LayerId | null>(null);
  const [dragOverLayerId, setDragOverLayerId] = useState<LayerId | null>(null);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>(savedAudioMixer.tracks);
  const [showGuides, setShowGuides] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recordMenuOpen, setRecordMenuOpen] = useState(false);
  const [recordLayouts, setRecordLayouts] = useState<Record<OutputId, boolean>>({ landscape: true, portrait: false });
  const [recordingLayouts, setRecordingLayouts] = useState<OutputId[]>([]);
  const recordWrapRef = useRef<HTMLDivElement>(null);
  const [audioSettingsOpen, setAudioSettingsOpen] = useState(false);
  const [audioSettingsTrackId, setAudioSettingsTrackId] = useState("mic");
  const [audioTrackInputIds, setAudioTrackInputIds] = useState<Record<string, string>>(savedAudioMixer.trackInputIds);
  const [layersReloading, setLayersReloading] = useState(false);
  const [audioReloadToken, setAudioReloadToken] = useState(0);
  const [audioOutputDevices, setAudioOutputDevices] = useState<DeviceOption[]>([]);
  const [audioTrackOutputIds, setAudioTrackOutputIds] = useState<Record<string, string>>(savedAudioMixer.trackOutputIds);
  const [audioSettingsPosition, setAudioSettingsPosition] = useState<PopupPosition | null>(null);
  const [audioAddMenuOpen, setAudioAddMenuOpen] = useState(false);
  const [audioAddMenuPosition, setAudioAddMenuPosition] = useState<PopupPosition | null>(null);
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const [layerMenuPosition, setLayerMenuPosition] = useState<PopupPosition | null>(null);
  const [layerSettingsPosition, setLayerSettingsPosition] = useState<PopupPosition | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const audioAddMenuRef = useRef<HTMLDivElement>(null);
  const audioAddMenuButtonRef = useRef<HTMLButtonElement>(null);
  const audioAddMenuPopupRef = useRef<HTMLDivElement>(null);
  const layerMenuRef = useRef<HTMLDivElement>(null);
  const layerMenuButtonRef = useRef<HTMLButtonElement>(null);
  const layerMenuPopupRef = useRef<HTMLDivElement>(null);
  const layerSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const layerSettingsRef = useRef<HTMLDivElement>(null);
  const audioSettingsRef = useRef<HTMLDivElement>(null);
  const audioSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const audioSettingsPopupRef = useRef<HTMLDivElement>(null);
  const audioPlaybackRef = useRef<Record<string, HTMLAudioElement>>({});
  const browserCaptureStreamsRef = useRef<Record<LayerId, MediaStream>>({});
  const ignoreRenameBlur = useRef(false);
  const currentOutput = OUTPUTS.find((output) => output.id === selectedOutput)!;
  const currentScenes = scenesByOutput[selectedOutput];
  const currentScene = currentScenes.find((scene) => scene.id === activeScenes[selectedOutput]) ?? null;
  const currentLayers = currentScene ? layersByScene[currentScene.id] ?? [] : [];

  useEffect(() => {
    const mixer: PersistedAudioMixer = {
      tracks: audioTracks,
      selectedInputId: selectedAudioInputId,
      monitoringEnabled: audioMonitoringEnabled,
      trackInputIds: audioTrackInputIds,
      trackOutputIds: audioTrackOutputIds,
    };
    try {
      localStorage.setItem(AUDIO_MIXER_STORAGE_KEY, JSON.stringify(mixer));
    } catch (error) {
      console.error("Unable to save the audio mixer:", error);
    }
  }, [audioTracks, selectedAudioInputId, audioMonitoringEnabled, audioTrackInputIds, audioTrackOutputIds]);

  const audioPlaybackSettingsRef = useRef({ outputIds: audioTrackOutputIds, tracks: audioTracks });
  audioPlaybackSettingsRef.current = { outputIds: audioTrackOutputIds, tracks: audioTracks };

  async function applyAudioPlaybackSettings(trackId: string): Promise<void> {
    const playback = audioPlaybackRef.current[trackId];
    const track = audioPlaybackSettingsRef.current.tracks.find((item) => item.id === trackId);
    if (!playback || !track) {
      return;
    }
    const outputId = audioPlaybackSettingsRef.current.outputIds[trackId] ?? "";
    playback.muted = track.muted || !outputId;
    playback.volume = Math.max(0, Math.min(1, track.volume / 100));
    try {
      await playback.setSinkId(outputId);
    } catch (error) {
      console.error("Unable to route audio to the selected output:", error);
      setAudioInputError("Unable to use the selected output device.");
    }
  }

  useEffect(() => {
    Object.keys(audioPlaybackRef.current).forEach((trackId) => void applyAudioPlaybackSettings(trackId));
  }, [audioTrackOutputIds, audioTracks]);

  const audioMonitorKey = JSON.stringify([
    audioReloadToken,
    ...(audioMonitoringEnabled ? [["mic", selectedAudioInputId]] : []),
    ...audioTracks
      .filter((track) => track.id !== "mic" && audioTrackInputIds[track.id])
      .map((track) => [track.id, audioTrackInputIds[track.id]]),
  ]);

  useEffect(() => {
    const sources = (JSON.parse(audioMonitorKey) as [number, ...[string, string][]]).slice(1) as [string, string][];
    setAudioMeterLevels({});
    if (sources.length === 0) {
      return;
    }

    let cancelled = false;
    const cleanups: Array<() => void> = [];
    setAudioInputError(null);

    async function monitorSource(trackId: string, deviceId: string): Promise<void> {
      try {
        if (!navigator.mediaDevices?.getUserMedia || typeof window.AudioContext !== "function") {
          throw new Error("Live audio monitoring is not supported in this environment.");
        }
        const rawAudio = trackId !== "mic";
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
            ...(rawAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : {}),
          },
          video: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const audioContext = new AudioContext();
        let animationFrame = 0;
        cleanups.push(() => {
          window.cancelAnimationFrame(animationFrame);
          stream.getTracks().forEach((track) => track.stop());
          if (audioContext.state !== "closed") {
            void audioContext.close().catch((error: unknown) => {
              console.error("Unable to close audio meter context:", error);
            });
          }
        });
        if (audioContext.state === "suspended") {
          await audioContext.resume();
        }
        if (cancelled) {
          return;
        }

        if (trackId === "capture-card") {
          const playback = new Audio();
          playback.srcObject = stream;
          audioPlaybackRef.current[trackId] = playback;
          cleanups.push(() => {
            playback.pause();
            playback.srcObject = null;
            delete audioPlaybackRef.current[trackId];
          });
          await applyAudioPlaybackSettings(trackId);
          await playback.play().catch((error: unknown) => {
            console.error("Unable to play capture card audio:", error);
          });
          if (cancelled) {
            return;
          }
        }

        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        audioContext.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        let smoothedLevel = 0;
        let lastUpdateTime = 0;

        function updateMeter(timestamp: number): void {
          analyser.getFloatTimeDomainData(samples);
          let sumSquares = 0;
          for (const sample of samples) {
            sumSquares += sample * sample;
          }
          const rms = Math.sqrt(sumSquares / samples.length);
          const decibels = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
          const targetLevel = Math.max(0, Math.min(100, ((decibels + 48) / 40) * 100));
          smoothedLevel += (targetLevel - smoothedLevel) * (targetLevel > smoothedLevel ? 0.65 : 0.25);

          if (timestamp - lastUpdateTime >= 50) {
            const level = Math.round(smoothedLevel);
            setAudioMeterLevels((levels) => (levels[trackId] === level ? levels : { ...levels, [trackId]: level }));
            lastUpdateTime = timestamp;
          }
          animationFrame = window.requestAnimationFrame(updateMeter);
        }

        animationFrame = window.requestAnimationFrame(updateMeter);
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error("Unable to monitor audio input:", error);
        setAudioInputError(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Microphone permission was denied. Allow DUI Studio under System Settings > Privacy & Security > Microphone, then reopen these settings."
            : error instanceof Error ? error.message : String(error),
        );
      }
    }

    sources.forEach(([trackId, deviceId]) => void monitorSource(trackId, deviceId));
    return () => {
      cancelled = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [audioMonitorKey]);

  useEffect(() => {
    if (!audioSettingsOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      if (
        event.target instanceof Node
        && !audioSettingsRef.current?.contains(event.target)
        && !audioSettingsPopupRef.current?.contains(event.target)
      ) {
        setAudioSettingsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setAudioSettingsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [audioSettingsOpen, audioSettingsTrackId]);

  useLayoutEffect(() => {
    if (!audioSettingsOpen) {
      setAudioSettingsPosition(null);
      return;
    }

    function updateAudioSettingsPosition(): void {
      const position = getSidebarPopupPosition(
        inspectorRef.current,
        audioSettingsButtonRef.current,
        audioSettingsPopupRef.current,
      );
      if (position) {
        setAudioSettingsPosition(position);
      }
    }

    updateAudioSettingsPosition();
    window.addEventListener("resize", updateAudioSettingsPosition);
    document.addEventListener("scroll", updateAudioSettingsPosition, true);
    return () => {
      window.removeEventListener("resize", updateAudioSettingsPosition);
      document.removeEventListener("scroll", updateAudioSettingsPosition, true);
    };
  }, [audioSettingsOpen, audioSettingsTrackId]);

  useEffect(() => {
    savePersistedStudioState({ selectedOutput, activeScenes, scenesByOutput, layersByScene });
  }, [selectedOutput, activeScenes, scenesByOutput, layersByScene]);

  useEffect(() => () => {
    Object.values(browserCaptureStreamsRef.current).forEach((stream) => {
      stream.getTracks().forEach((track) => track.stop());
    });
  }, []);

  function setBrowserCaptureStream(layerId: LayerId, stream: MediaStream | null): void {
    const previousStream = browserCaptureStreamsRef.current[layerId];
    if (previousStream && previousStream !== stream) {
      previousStream.getTracks().forEach((track) => track.stop());
    }
    const nextStreams = { ...browserCaptureStreamsRef.current };
    if (stream) {
      nextStreams[layerId] = stream;
    } else {
      delete nextStreams[layerId];
    }
    browserCaptureStreamsRef.current = nextStreams;
    setBrowserCaptureStreams(nextStreams);
  }

  useEffect(() => {
    const layer = settingsLayerId
      ? Object.values(layersByScene).flat().find((candidate) => candidate.id === settingsLayerId)
      : null;
    if (layer?.kind !== "display-capture") {
      return;
    }

    let cancelled = false;
    setDesktopCaptureLoading(true);
    setDesktopCaptureError(null);
    if (typeof window.duiStudio?.getDesktopCaptureSources !== "function") {
      const isElectron = isElectronRenderer();
      setDesktopCaptureSources([]);
      setBrowserPickerAvailable(!isElectron);
      if (isElectron) {
        setDesktopCaptureError("Display capture bridge is unavailable. Restart DUI Studio to reload its Electron preload.");
      }
      setDesktopCaptureLoading(false);
      return;
    }

    setBrowserPickerAvailable(false);
    window.duiStudio.getDesktopCaptureSources().then((result) => {
      if (!cancelled) {
        setDesktopCaptureSources(result.sources);
        setBrowserPickerAvailable(false);
        if (result.error) {
          setDesktopCaptureError(
            result.permissionStatus !== "granted" && result.permissionStatus !== "unknown"
              ? `Screen Recording permission is "${result.permissionStatus}". Enable Electron in System Settings → Privacy & Security → Screen Recording, then restart. Details: ${result.error}`
              : `Electron could not enumerate display sources (permission status: ${result.permissionStatus}). Details: ${result.error}`,
          );
        } else         if (!result.sources.some((source) => source.name === "Entire Screen")) {
          setDesktopCaptureError(
            result.permissionStatus === "granted"
              ? "No screen source was found. Restart DUI Studio and try again."
              : "Allow Screen Recording for DUI Studio in System Settings, then restart the app.",
          );
        }
        if (result.sources.some((source) => source.name === "Entire Screen")) {
          setDesktopCaptureError(null);
          const sourceIds = new Set(
            result.sources
              .filter((source) => source.name === "Entire Screen")
              .map((source) => source.id),
          );
          setLayersByScene((current) => {
            let changed = false;
            const next = { ...current };
            for (const [sceneId, layers] of Object.entries(current)) {
              next[sceneId] = layers.map((candidate) => {
                if (
                  candidate.kind === "display-capture"
                  && candidate.deviceId
                  && !sourceIds.has(candidate.deviceId)
                ) {
                  changed = true;
                  return { ...candidate, deviceId: "" };
                }
                return candidate;
              });
            }
            return changed ? next : current;
          });
        }
      }
    }).catch((error: unknown) => {
      console.error("Unable to list display capture sources:", error);
      if (!cancelled) {
        setBrowserPickerAvailable(!isElectronRenderer());
        const message = error instanceof Error ? error.message : String(error);
        setDesktopCaptureError(
          message.includes("No handler registered")
            ? "Display capture support isn't loaded. Stop and restart the Electron dev process."
            : message,
        );
      }
    }).finally(() => {
      if (!cancelled) {
        setDesktopCaptureLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [settingsLayerId]);

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
        if (typeof window.duiStudio?.requestCameraAccess === "function") {
          const granted = await window.duiStudio.requestCameraAccess();
          if (!granted) {
            throw new Error("Camera permission was denied. Enable camera access in System Settings and restart DUI Studio.");
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

  function getLayersForOutput(outputId: OutputId): StudioLayer[] {
    const sceneId = activeScenes[outputId];
    return sceneId ? layersByScene[sceneId] ?? [] : [];
  }

  useEffect(() => {
    if (editingScene) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [editingScene]);

  useEffect(() => {
    if (!audioAddMenuOpen) {
      return;
    }

    function closeOnPointerDown(event: PointerEvent): void {
      const target = event.target;
      if (
        target instanceof Node
        && !audioAddMenuRef.current?.contains(target)
        && !audioAddMenuPopupRef.current?.contains(target)
      ) {
        setAudioAddMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setAudioAddMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [audioAddMenuOpen]);

  useLayoutEffect(() => {
    if (!audioAddMenuOpen) {
      setAudioAddMenuPosition(null);
      return;
    }

    function updatePosition(): void {
      const position = getSidebarPopupPosition(
        inspectorRef.current,
        audioAddMenuButtonRef.current,
        audioAddMenuPopupRef.current,
      );
      if (position) {
        setAudioAddMenuPosition(position);
      }
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [audioAddMenuOpen]);

  useEffect(() => {
    if (!layerMenuOpen) {
      return;
    }

    function closeMenuOnPointerDown(event: PointerEvent): void {
      const target = event.target;
      if (
        target instanceof Node
        && !layerMenuRef.current?.contains(target)
        && !layerMenuPopupRef.current?.contains(target)
      ) {
        setLayerMenuOpen(false);
      }
    }

    function closeMenuOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setLayerMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeMenuOnPointerDown);
    document.addEventListener("keydown", closeMenuOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenuOnPointerDown);
      document.removeEventListener("keydown", closeMenuOnEscape);
    };
  }, [layerMenuOpen]);

  useEffect(() => {
    if (!settingsLayerId) {
      return;
    }

    function closeSettingsOnPointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node) || layerSettingsRef.current?.contains(target)) {
        return;
      }
      if (target instanceof Element && target.closest(".layer-settings-trigger")) {
        return;
      }
      setSettingsLayerId(null);
    }

    function closeSettingsOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setSettingsLayerId(null);
      }
    }

    document.addEventListener("pointerdown", closeSettingsOnPointerDown);
    document.addEventListener("keydown", closeSettingsOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeSettingsOnPointerDown);
      document.removeEventListener("keydown", closeSettingsOnEscape);
    };
  }, [settingsLayerId]);

  useLayoutEffect(() => {
    if (!layerMenuOpen && !settingsLayerId) {
      return;
    }

    function updatePopupPositions(): void {
      if (layerMenuOpen) {
        const position = getSidebarPopupPosition(
          inspectorRef.current,
          layerMenuButtonRef.current,
          layerMenuPopupRef.current,
        );
        if (position) {
          setLayerMenuPosition(position);
        }
      } else {
        setLayerMenuPosition(null);
      }

      if (settingsLayerId) {
        const position = getSidebarPopupPosition(
          inspectorRef.current,
          layerSettingsButtonRef.current,
          layerSettingsRef.current,
        );
        if (position) {
          setLayerSettingsPosition(position);
        }
      } else {
        setLayerSettingsPosition(null);
      }
    }

    updatePopupPositions();
    window.addEventListener("resize", updatePopupPositions);
    document.addEventListener("scroll", updatePopupPositions, true);
    return () => {
      window.removeEventListener("resize", updatePopupPositions);
      document.removeEventListener("scroll", updatePopupPositions, true);
    };
  }, [layerMenuOpen, settingsLayerId]);

  function toggleLayer(layerId: LayerId): void {
    const sceneId = activeScenes[selectedOutput];
    if (!sceneId) {
      return;
    }
    setLayersByScene((current) => ({
      ...current,
      [sceneId]: current[sceneId].map((layer) => (
        layer.id === layerId ? { ...layer, enabled: !layer.enabled } : layer
      )),
    }));
  }

  function deleteLayer(layerId: LayerId): void {
    const sceneId = activeScenes[selectedOutput];
    if (!sceneId) {
      return;
    }
    setBrowserCaptureStream(layerId, null);
    setLayersByScene((current) => ({
      ...current,
      [sceneId]: current[sceneId].filter((layer) => layer.id !== layerId),
    }));
    setSettingsLayerId(null);
    setSelectedCanvasObject((selected) => selected?.layerId === layerId ? null : selected);
  }

  function updateLayer(sceneId: SceneId, layerId: LayerId, update: Partial<StudioLayer>): void {
    setLayersByScene((current) => ({
      ...current,
      [sceneId]: (current[sceneId] ?? []).map((layer) => (
        layer.id === layerId ? { ...layer, ...update } : layer
      )),
    }));
  }

  function reorderLayer(sceneId: SceneId, sourceLayerId: LayerId, targetLayerId: LayerId, insertBefore: boolean): void {
    if (sourceLayerId === targetLayerId) {
      return;
    }
    setLayersByScene((current) => {
      const sceneLayers = current[sceneId] ?? [];
      const movingLayer = sceneLayers.find((layer) => layer.id === sourceLayerId);
      if (!movingLayer || !sceneLayers.some((layer) => layer.id === targetLayerId)) {
        return current;
      }
      const reordered = sceneLayers.filter((layer) => layer.id !== sourceLayerId);
      const targetIndex = reordered.findIndex((layer) => layer.id === targetLayerId);
      reordered.splice(targetIndex + (insertBefore ? 0 : 1), 0, movingLayer);
      return { ...current, [sceneId]: reordered };
    });
  }

  function changeDisplayCaptureDevice(
    sceneId: SceneId,
    layerId: LayerId,
    deviceId: string,
    captureResolution: CaptureResolutionId,
  ): void {
    setDesktopCaptureError(null);
    if (deviceId === BROWSER_DISPLAY_CAPTURE_ID) {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        setDesktopCaptureError("This browser does not support display capture.");
        return;
      }
      const resolution = getCaptureResolution(captureResolution);
      void navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: {
          width: { ideal: resolution.width },
          height: { ideal: resolution.height },
        },
      }).then((stream) => {
        setBrowserCaptureStream(layerId, stream);
        updateLayer(sceneId, layerId, {
          deviceId: BROWSER_DISPLAY_CAPTURE_ID,
          captureResolution,
          sourceDimensions: getSourceDimensions(stream),
          transform: { x: 0, y: 0, width: 100, height: 100 },
        });
        stream.getVideoTracks()[0]?.addEventListener("ended", () => {
          setBrowserCaptureStream(layerId, null);
          updateLayer(sceneId, layerId, { deviceId: "" });
        }, { once: true });
      }).catch((error: unknown) => {
        console.error("Unable to start browser display capture:", error);
        setDesktopCaptureError(error instanceof Error ? error.message : String(error));
      });
      return;
    }

    setBrowserCaptureStream(layerId, null);
    updateLayer(sceneId, layerId, {
      deviceId,
      captureResolution,
      sourceDimensions: null,
      transform: { x: 0, y: 0, width: 100, height: 100 },
    });
  }

  async function changeVideoInputDevice(
    sceneId: SceneId,
    layerId: LayerId,
    layerKind: "camera-device" | "game-capture",
    deviceId: string,
    captureResolution: CaptureResolutionId,
    fitToPreview = false,
    knownDevices: DeviceOption[] = videoInputDevices,
  ): Promise<void> {
    setVideoInputError(null);
    if (!deviceId) {
      setBrowserCaptureStream(layerId, null);
      updateLayer(sceneId, layerId, {
        deviceId: "",
        captureResolution,
        sourceDimensions: null,
        ...(fitToPreview ? { transform: { x: 0, y: 0, width: 100, height: 100 } } : {}),
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
        ...(fitToPreview ? { transform: { x: 0, y: 0, width: 100, height: 100 } } : {}),
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
        if (typeof window.duiStudio?.requestCameraAccess === "function") {
          const granted = await window.duiStudio.requestCameraAccess();
          if (!granted) {
            throw new Error("Camera permission was denied. Enable camera access in System Settings and restart DUI Studio.");
          }
        }
        const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        permissionStream.getTracks().forEach((track) => track.stop());
        const devices = (await navigator.mediaDevices.enumerateDevices())
          .filter((device) => device.kind === "videoinput" && device.deviceId.length > 0)
          .map((device, index) => ({ id: device.deviceId, name: device.label || `Video input ${index + 1}` }));
        setVideoInputDevices(devices);
        for (const layer of reconnectable) {
          if (layer.kind === "camera-device" || layer.kind === "game-capture") {
            await changeVideoInputDevice(
              currentScene.id,
              layer.id,
              layer.kind,
              layer.deviceId,
              layer.captureResolution,
              false,
              devices,
            );
          }
        }
      }
      for (const layer of reconnectable) {
        if (layer.kind === "display-capture" && layer.deviceId === BROWSER_DISPLAY_CAPTURE_ID) {
          changeDisplayCaptureDevice(currentScene.id, layer.id, layer.deviceId, layer.captureResolution);
        }
      }
    } catch (error) {
      console.error("Unable to reload layers:", error);
      setVideoInputError(error instanceof Error ? error.message : String(error));
    } finally {
      setLayersReloading(false);
    }
  }

  useEffect(() => {
    if (!recordMenuOpen) {
      return;
    }

    function closeOnPointerDown(event: PointerEvent): void {
      if (event.target instanceof Node && !recordWrapRef.current?.contains(event.target)) {
        setRecordMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setRecordMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [recordMenuOpen]);

  function startRecording(): void {
    const layouts = OUTPUTS.filter((output) => recordLayouts[output.id]).map((output) => output.id);
    if (layouts.length === 0) {
      return;
    }
    setRecordingLayouts(layouts);
    setRecordMenuOpen(false);
  }

  function reloadAll(): void {
    reloadAudioMixer();
    void reloadLayers();
  }

  function reloadAudioMixer(): void {
    setAudioMonitoringEnabled(true);
    setAudioReloadToken((token) => token + 1);
  }

  async function changeLayerCaptureResolution(
    sceneId: SceneId,
    layer: StudioLayer,
    captureResolution: CaptureResolutionId,
  ): Promise<void> {
    const resolution = getCaptureResolution(captureResolution);
    if (layer.kind === "display-capture") {
      setDesktopCaptureError(null);
      const stream = browserCaptureStreamsRef.current[layer.id];
      const track = stream?.getVideoTracks()[0];
      if (layer.deviceId === BROWSER_DISPLAY_CAPTURE_ID && stream && !track) {
        setDesktopCaptureError("The selected display stream has no video track.");
        return;
      }
      if (layer.deviceId === BROWSER_DISPLAY_CAPTURE_ID && track) {
        try {
          await track.applyConstraints({
            width: { ideal: resolution.width },
            height: { ideal: resolution.height },
          });
        } catch (error) {
          console.error("Unable to change display capture resolution:", error);
          setDesktopCaptureError(error instanceof Error ? error.message : String(error));
          return;
        }
      }
      updateLayer(sceneId, layer.id, {
        captureResolution,
        sourceDimensions: stream && track ? getSourceDimensions(stream) : null,
        transform: { x: 0, y: 0, width: 100, height: 100 },
      });
      return;
    }

    if (layer.kind === "camera-device" || layer.kind === "game-capture") {
      if (layer.deviceId) {
        await changeVideoInputDevice(sceneId, layer.id, layer.kind, layer.deviceId, captureResolution, true);
      } else {
        updateLayer(sceneId, layer.id, {
          captureResolution,
          sourceDimensions: null,
          transform: { x: 0, y: 0, width: 100, height: 100 },
        });
      }
    }
  }

  function addLayer(option: LayerOption): void {
    const sceneId = activeScenes[selectedOutput];
    if (!sceneId) {
      return;
    }

    let layerId = `source-${nextLayerId++}`;
    while (Object.values(layersByScene).some((layers) => layers.some((layer) => layer.id === layerId))) {
      layerId = `source-${nextLayerId++}`;
    }
    const layer: StudioLayer = {
      id: layerId,
      name: option.name,
      icon: option.icon,
      kind: option.kind,
      enabled: true,
      deviceId: "",
      captureResolution: DEFAULT_CAPTURE_RESOLUTION,
      crop: { ...DEFAULT_CROP_INSETS },
      sourceDimensions: null,
      transform: getDefaultLayerTransform(option.kind),
    };
    setLayersByScene((current) => ({
      ...current,
      [sceneId]: [layer, ...(current[sceneId] ?? [])],
    }));
    setSelectedCanvasObject({ sceneId, layerId });
    setLayerMenuOpen(false);
  }

  function selectScene(outputId: OutputId, sceneId: SceneId | null): void {
    setSettingsLayerId(null);
    setLayerMenuOpen(false);
    setSelectedCanvasObject(null);
    setActiveScenes((current) => ({ ...current, [outputId]: sceneId }));
  }

  function addScene(): void {
    let sceneId = `custom-${nextCustomSceneId++}`;
    while (Object.values(scenesByOutput).some((scenes) => scenes.some((scene) => scene.id === sceneId))) {
      sceneId = `custom-${nextCustomSceneId++}`;
    }
    const scene: Scene = {
      id: sceneId,
      name: `Scene ${scenesByOutput[selectedOutput].length + 1}`,
      appearance: "custom",
    };
    setScenesByOutput((current) => ({
      ...current,
      [selectedOutput]: [...current[selectedOutput], scene],
    }));
    selectScene(selectedOutput, scene.id);
  }

  function startSceneRename(outputId: OutputId, scene: Scene): void {
    setSceneNameDraft(scene.name);
    setEditingScene({ outputId, sceneId: scene.id });
  }

  function finishSceneRename(outputId: OutputId, sceneId: SceneId): void {
    if (ignoreRenameBlur.current) {
      ignoreRenameBlur.current = false;
      return;
    }

    const name = sceneNameDraft.trim();
    if (name) {
      setScenesByOutput((current) => ({
        ...current,
        [outputId]: current[outputId].map((scene) => (
          scene.id === sceneId ? { ...scene, name } : scene
        )),
      }));
    }
    setEditingScene(null);
  }

  function deleteScene(outputId: OutputId, sceneId: SceneId): void {
    const outputScenes = scenesByOutput[outputId];
    const sceneIndex = outputScenes.findIndex((scene) => scene.id === sceneId);
    if (sceneIndex === -1) {
      return;
    }

    for (const layer of layersByScene[sceneId] ?? []) {
      setBrowserCaptureStream(layer.id, null);
    }
    const replacementScene = outputScenes[sceneIndex + 1] ?? outputScenes[sceneIndex - 1] ?? null;
    setScenesByOutput((current) => {
      const currentScenes = current[outputId];
      if (!currentScenes.some((scene) => scene.id === sceneId)) {
        return current;
      }
      return {
        ...current,
        [outputId]: currentScenes.filter((scene) => scene.id !== sceneId),
      };
    });
    setLayersByScene((current) => {
      const remainingLayers = { ...current };
      delete remainingLayers[sceneId];
      return remainingLayers;
    });
    setSettingsLayerId(null);
    setLayerMenuOpen(false);
    if (activeScenes[outputId] === sceneId) {
      selectScene(outputId, replacementScene?.id ?? null);
    }
    if (editingScene?.outputId === outputId && editingScene.sceneId === sceneId) {
      setEditingScene(null);
    }
  }

  function updateAudioTrack(trackId: string, update: Partial<AudioTrack>): void {
    setAudioTracks((tracks) => tracks.map((track) => (
      track.id === trackId ? { ...track, ...update } : track
    )));
  }

  function addAudioSourceTrack(id: string, name: string): void {
    setAudioTracks((tracks) => (
      tracks.some((track) => track.id === id)
        ? tracks
        : [...tracks, { id, name, icon: "audio", volume: 100, muted: false }]
    ));
    setAudioAddMenuOpen(false);
  }

  function removeAudioTrack(trackId: string): void {
    if (audioSettingsOpen && audioSettingsTrackId === trackId) {
      setAudioSettingsOpen(false);
    }
    setAudioTracks((tracks) => tracks.filter((track) => track.id !== trackId));
    setAudioTrackOutputIds((ids) => {
      const { [trackId]: _removedOutput, ...rest } = ids;
      return rest;
    });
    setAudioTrackInputIds((ids) => {
      const { [trackId]: _removed, ...rest } = ids;
      return rest;
    });
  }

  async function toggleAudioSettings(trackId: string): Promise<void> {
    if (audioSettingsOpen && audioSettingsTrackId === trackId) {
      setAudioSettingsOpen(false);
      return;
    }
    setAudioSettingsTrackId(trackId);
    setAudioSettingsOpen(true);
    setAudioInputLoading(true);
    setAudioInputError(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices.enumerateDevices) {
        throw new Error("Microphone input discovery is not supported in this environment.");
      }
      if (typeof window.duiStudio?.requestMicrophoneAccess === "function") {
        const granted = await window.duiStudio.requestMicrophoneAccess();
        if (!granted) {
          throw new Error("Microphone permission was denied. Allow DUI Studio under System Settings > Privacy & Security > Microphone, then reopen these settings.");
        }
      }
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      permissionStream.getTracks().forEach((track) => track.stop());
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices
        .filter((device) => device.kind === "audioinput")
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
      if (trackId === "mic") {
        setAudioMonitoringEnabled(true);
      }
    } catch (error) {
      console.error("Unable to enumerate microphone input devices:", error);
      const message = error instanceof Error ? error.message : String(error);
      setAudioInputError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow DUI Studio under System Settings > Privacy & Security > Microphone, then reopen these settings."
          : message,
      );
      setAudioInputDevices([]);
    } finally {
      setAudioInputLoading(false);
    }
  }

  return (
    <main className="studio-app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">DUI Studio</span>
        </div>
        <div className="topbar-actions">
          <div className="settings-wrap" ref={recordWrapRef}>
            <button
              className={`action-button action-button--record${recordingLayouts.length ? " action-button--recording" : ""}`}
              aria-expanded={recordMenuOpen}
              aria-haspopup="dialog"
              onClick={() => {
                if (recordingLayouts.length) {
                  setRecordingLayouts([]);
                } else {
                  setRecordMenuOpen((open) => !open);
                }
              }}
            >
              <Icon name="record" />
              {recordingLayouts.length ? "Stop" : "Record"}
            </button>
            {recordMenuOpen && (
              <div className="settings-popover" role="dialog" aria-label="Recording mode">
                <strong>Recording Mode</strong>
                <div className="record-mode-list">
                  {OUTPUTS.map((output) => (
                    <label className="guide-setting" key={output.id}>
                      <span>{output.id === "landscape" ? "Horizontal" : "Vertical"}</span>
                      <input
                        type="checkbox"
                        checked={recordLayouts[output.id]}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setRecordLayouts((layouts) => ({ ...layouts, [output.id]: checked }));
                        }}
                      />
                    </label>
                  ))}
                </div>
                <button
                  className="record-start-button"
                  disabled={!OUTPUTS.some((output) => recordLayouts[output.id])}
                  onClick={startRecording}
                >
                  <Icon name="record" />
                  Start recording
                </button>
              </div>
            )}
          </div>
          <button className="action-button action-button--stream" disabled title="Streaming will be available when the media pipeline is connected">
            <Icon name="stream" />
            Stream
          </button>
          <div className="settings-wrap">
            <button
              className={`settings-button${settingsOpen ? " settings-button--active" : ""}`}
              onClick={() => setSettingsOpen((open) => !open)}
              aria-expanded={settingsOpen}
              aria-haspopup="dialog"
            >
              <Icon name="settings" />
              Settings
            </button>
            {settingsOpen && (
              <div className="settings-popover" role="dialog" aria-label="Preview settings">
                <strong>Preview settings</strong>
                <label className="guide-setting">
                  <span>Safe-area guides</span>
                  <input type="checkbox" checked={showGuides} onChange={(event) => setShowGuides(event.target.checked)} />
                </label>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="studio-layout">
        <aside className="inspector" ref={inspectorRef} aria-label="Studio configuration">
          <div className="inspector-heading">
            <div>
              <span className="section-kicker">CONFIGURING</span>
              <h2>{currentOutput.name}</h2>
            </div>
            <div className="inspector-heading-actions">
              <IconButton
                className="section-reload-button"
                title="Reload all: reconnect the saved layer inputs and restart the audio mixer"
                aria-label="Reload layers and audio mixer"
                disabled={layersReloading}
                onClick={reloadAll}
              >
                <Icon name="reload" />
              </IconButton>
              <span className="inspector-ratio">{currentOutput.ratio}</span>
            </div>
          </div>

          <section className="inspector-section">
            <div className="section-title">
              <Icon name="scenes" />
              <h3>Scenes</h3>
              <button
                className="text-icon-button"
                title="Add scene"
                aria-label="Add scene"
                onClick={addScene}
              >
                <Icon name="plus" />
              </button>
            </div>
            <div className="scene-list" role="group" aria-label={`${currentOutput.name} scenes`}>
              {currentScenes.map((scene) => {
                const active = activeScenes[selectedOutput] === scene.id;
                const editing = editingScene?.outputId === selectedOutput && editingScene.sceneId === scene.id;
                return (
                  <div className={`scene-item${active ? " scene-item--active" : ""}`} key={scene.id}>
                    {editing ? (
                      <div className="scene-row scene-row--editing">
                        <input
                          ref={renameInputRef}
                          className="scene-name-input"
                          value={sceneNameDraft}
                          maxLength={12}
                          aria-label={`Rename scene ${scene.name}`}
                          onChange={(event) => setSceneNameDraft(event.target.value)}
                          onBlur={() => finishSceneRename(selectedOutput, scene.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.currentTarget.blur();
                            } else if (event.key === "Escape") {
                              ignoreRenameBlur.current = true;
                              setEditingScene(null);
                              event.currentTarget.blur();
                            }
                          }}
                        />
                        {active && <span className="scene-active-dot" aria-label="Active scene" />}
                      </div>
                    ) : (
                      <button
                        className="scene-row"
                        onClick={() => selectScene(selectedOutput, scene.id)}
                        onDoubleClick={() => startSceneRename(selectedOutput, scene)}
                        onKeyDown={(event) => {
                          if (event.key === "F2") {
                            event.preventDefault();
                            startSceneRename(selectedOutput, scene);
                          }
                        }}
                        title="Double-click to rename"
                        aria-pressed={active}
                      >
                        <span>{scene.name}</span>
                        {active && <span className="scene-active-dot" aria-label="Active scene" />}
                      </button>
                    )}
                    <button
                      className="delete-scene-button"
                      title={`Delete ${scene.name}`}
                      aria-label={`Delete scene ${scene.name}`}
                      onClick={() => deleteScene(selectedOutput, scene.id)}
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="inspector-section">
            <div className="section-title">
              <Icon name="layers" />
              <h3>Layers</h3>
              <span className="section-count">
                {currentLayers.filter((layer) => layer.enabled).length}
              </span>
              <div className="layer-add-wrap" ref={layerMenuRef}>
                <button
                  className="text-icon-button"
                  title={currentScene ? "Add layer: camera, display capture or capture card" : "Select a scene to add layers"}
                  aria-label="Add layer"
                  aria-haspopup="menu"
                  aria-expanded={layerMenuOpen}
                  disabled={!currentScene}
                  ref={layerMenuButtonRef}
                  onClick={() => setLayerMenuOpen((open) => !open)}
                >
                  <Icon name="plus" />
                </button>
                {layerMenuOpen && (
                  createPortal(
                    <div
                      className="layer-add-menu"
                      ref={layerMenuPopupRef}
                      role="menu"
                      aria-label="Add layer"
                      style={{
                        left: layerMenuPosition?.left ?? 0,
                        top: layerMenuPosition?.top ?? 0,
                        visibility: layerMenuPosition ? "visible" : "hidden",
                      }}
                    >
                      {LAYER_OPTIONS.map((option) => (
                        <button
                          className="layer-add-option"
                          key={option.kind}
                          role="menuitem"
                          onClick={() => addLayer(option)}
                        >
                          <Icon name={option.icon} />
                          <span className="layer-add-option-copy">
                            <span>{option.name}</span>
                            <span className="layer-add-option-description">{option.description}</span>
                          </span>
                        </button>
                      ))}
                    </div>,
                    document.body,
                  )
                )}
              </div>
            </div>
            <div className="layer-list">
              {currentScene ? currentLayers.map((layer) => {
                const enabled = layer.enabled;
                const deviceListLoading = layer.kind === "display-capture"
                  ? desktopCaptureLoading
                  : (layer.kind === "camera-device" || layer.kind === "game-capture") && videoInputLoading;
                const settingsOpen = settingsLayerId === layer.id;
                const dragged = draggedLayerId === layer.id;
                const dragTarget = dragOverLayerId === layer.id;
                return (
                  <div className="layer-entry" key={layer.id}>
                    <div
                      className={`layer-item${dragged ? " layer-item--dragging" : ""}${dragTarget ? " layer-item--drop-target" : ""}`}
                      onDragOver={(event) => {
                        if (draggedLayerId && draggedLayerId !== layer.id) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          setDragOverLayerId(layer.id);
                        }
                      }}
                      onDragLeave={(event) => {
                        const relatedTarget = event.relatedTarget;
                        if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) {
                          setDragOverLayerId(null);
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const sourceLayerId = event.dataTransfer.getData("text/plain") || draggedLayerId;
                        if (currentScene && sourceLayerId) {
                          const bounds = event.currentTarget.getBoundingClientRect();
                          reorderLayer(currentScene.id, sourceLayerId, layer.id, event.clientY < bounds.top + bounds.height / 2);
                        }
                        setDraggedLayerId(null);
                        setDragOverLayerId(null);
                      }}
                    >
                      <div
                        className={`layer-row${enabled ? "" : " layer-row--muted"}`}
                        draggable
                        title="Drag to reorder layers. Top layers appear in front."
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", layer.id);
                          setDraggedLayerId(layer.id);
                        }}
                        onDragEnd={() => {
                          setDraggedLayerId(null);
                          setDragOverLayerId(null);
                        }}
                      >
                        <Icon name={layer.icon} />
                        <span className="layer-name">{layer.name}</span>
                      </div>
                      <IconButton
                        tone={enabled ? "default" : "alert"}
                        onClick={() => toggleLayer(layer.id)}
                        role="switch"
                        aria-label={layer.name}
                        aria-checked={enabled}
                        title={`${enabled ? "Disable" : "Enable"} ${layer.name}`}
                      >
                        <Icon name={enabled ? "eye" : "eye-off"} />
                      </IconButton>
                      <IconButton
                        className="layer-settings-trigger"
                        active={settingsOpen}
                        title={`Settings for ${layer.name}`}
                        aria-label={`Settings for ${layer.name}`}
                        aria-haspopup="dialog"
                        aria-expanded={settingsOpen}
                        onClick={(event) => {
                          if (settingsOpen) {
                            setSettingsLayerId(null);
                            return;
                          }
                          layerSettingsButtonRef.current = event.currentTarget;
                          setSettingsLayerId(layer.id);
                        }}
                      >
                        <Icon name="settings" />
                      </IconButton>
                      <IconButton
                        tone="danger"
                        title={`Delete ${layer.name}`}
                        aria-label={`Delete layer ${layer.name}`}
                        onClick={() => deleteLayer(layer.id)}
                      >
                        <Icon name="trash" />
                      </IconButton>
                    </div>
                    {settingsOpen && (
                      createPortal(
                        <div
                          className="layer-settings-panel"
                          ref={layerSettingsRef}
                          role="dialog"
                          aria-label={`${layer.name} settings`}
                          style={{
                            left: layerSettingsPosition?.left ?? 0,
                            top: layerSettingsPosition?.top ?? 0,
                            visibility: layerSettingsPosition ? "visible" : "hidden",
                          }}
                        >
                          <label className="layer-settings-name">
                            <span>Layer name</span>
                            <input
                              value={layer.name}
                              maxLength={12}
                              aria-label={`Rename layer ${layer.name}`}
                              onChange={(event) => updateLayer(currentScene.id, layer.id, { name: event.target.value })}
                              onBlur={() => {
                                const name = layer.name.trim();
                                updateLayer(currentScene.id, layer.id, {
                                  name: name || LAYER_SOURCE_LABELS[layer.kind],
                                });
                              }}
                            />
                          </label>
                          <label className="layer-device-select">
                            <span>Device</span>
                            <Dropdown
                              loading={deviceListLoading}
                              loadingLabel="Loading device list"
                              value={deviceListLoading ? "" : layer.deviceId}
                              aria-label={`Device for ${layer.name}`}
                              onChange={(event) => {
                                if (layer.kind === "display-capture") {
                                  changeDisplayCaptureDevice(
                                    currentScene.id,
                                    layer.id,
                                    event.target.value,
                                    layer.captureResolution,
                                  );
                                } else if (
                                  layer.kind === "camera-device"
                                  || layer.kind === "game-capture"
                                ) {
                                  void changeVideoInputDevice(
                                    currentScene.id,
                                    layer.id,
                                    layer.kind,
                                    event.target.value,
                                    layer.captureResolution,
                                  );
                                } else {
                                  updateLayer(currentScene.id, layer.id, {
                                    deviceId: event.target.value,
                                  });
                                }
                              }}
                            >
                              <option value="">
                                {layer.kind === "camera-device" || layer.kind === "game-capture"
                                  ? videoInputLoading
                                    ? "Device"
                                    : videoInputDevices.length
                                      ? "Select a video input"
                                      : "No video inputs found"
                                  : layer.kind === "display-capture"
                                  ? desktopCaptureLoading
                                    ? "Device"
                                    : desktopCaptureSources.length
                                      ? "Select a display or window"
                                      : browserPickerAvailable
                                        ? "Select a source"
                                        : "No display sources found"
                                  : "Select a device"}
                              </option>
                              {layer.kind === "display-capture"
                                ? desktopCaptureSources.map((source) => (
                                  <option
                                    key={source.id}
                                    value={source.id}
                                  >
                                    {source.name}
                                  </option>
                                ))
                                : (layer.kind === "camera-device" || layer.kind === "game-capture")
                                  ? videoInputDevices.map((device) => (
                                    <option
                                      key={device.id}
                                      value={device.id}
                                    >
                                      {device.name}
                                    </option>
                                  ))
                                : DEVICE_OPTIONS[layer.kind].map((device) => (
                                  <option key={device.id} value={device.id}>{device.name}</option>
                                ))}
                              {layer.kind === "display-capture" && browserPickerAvailable && (
                                <option value={BROWSER_DISPLAY_CAPTURE_ID}>Choose a display or window...</option>
                              )}
                              {layer.kind === "display-capture"
                                && layer.deviceId === BROWSER_DISPLAY_CAPTURE_ID
                                && !browserPickerAvailable
                                && (
                                  <option value={BROWSER_DISPLAY_CAPTURE_ID}>Re-select browser display...</option>
                                )}
                              {layer.kind === "display-capture"
                                && layer.deviceId
                                && layer.deviceId !== BROWSER_DISPLAY_CAPTURE_ID
                                && !desktopCaptureSources.some((source) => source.id === layer.deviceId)
                                && (
                                  <option value={layer.deviceId}>Previously selected source unavailable</option>
                                )}
                            </Dropdown>
                          </label>
                          {(layer.kind === "camera-device"
                            || layer.kind === "display-capture"
                            || layer.kind === "game-capture") && (
                            <label className="layer-device-select">
                                <span>Resolution</span>
                                <Dropdown
                                  value={layer.captureResolution}
                                  aria-label={`Resolution for ${layer.name}`}
                                  onChange={(event) => {
                                    if (isCaptureResolutionId(event.target.value)) {
                                      void changeLayerCaptureResolution(
                                        currentScene.id,
                                        layer,
                                        event.target.value,
                                      );
                                    }
                                  }}
                                >
                                  {CAPTURE_RESOLUTIONS.map((resolution) => (
                                    <option key={resolution.id} value={resolution.id}>
                                      {resolution.label} ({resolution.width} × {resolution.height})
                                    </option>
                                  ))}
                                </Dropdown>
                                <span className="layer-resolution-hint">
                                  Requests this capture size; changing it resizes the layer to fill the preview.
                                </span>
                            </label>
                          )}
                          {(layer.kind === "camera-device"
                            || layer.kind === "display-capture"
                            || layer.kind === "game-capture") && (
                            <div className="layer-crop-controls" role="group" aria-label={`Crop ${layer.name} in pixels`}>
                                <span className="layer-crop-title">Crop (source pixels)</span>
                                <div className="layer-crop-grid">
                                  {(["left", "right", "top", "bottom"] as const).map((side) => {
                                    const opposite = side === "left"
                                      ? "right"
                                      : side === "right"
                                        ? "left"
                                        : side === "top"
                                          ? "bottom"
                                          : "top";
                                    const sourceDimensions = layer.sourceDimensions
                                      ?? getCaptureResolution(layer.captureResolution);
                                    const dimension = side === "left" || side === "right"
                                      ? sourceDimensions.width
                                      : sourceDimensions.height;
                                    const maxCrop = Math.max(0, dimension - layer.crop[opposite] - 1);
                                    return (
                                      <label className="layer-crop-field" key={side}>
                                        <span>{`${side[0].toUpperCase()}${side.slice(1)} (px)`}</span>
                                        <input
                                          type="number"
                                          min={0}
                                          max={maxCrop}
                                          step={1}
                                          value={layer.crop[side]}
                                          aria-label={`${side} crop for ${layer.name} in pixels`}
                                          onChange={(event) => {
                                            const inputValue = event.currentTarget.valueAsNumber;
                                            const amount = Number.isFinite(inputValue)
                                              ? Math.min(maxCrop, Math.max(0, Math.floor(inputValue)))
                                              : 0;
                                            updateLayer(currentScene.id, layer.id, {
                                              crop: { ...layer.crop, [side]: amount },
                                            });
                                          }}
                                        />
                                      </label>
                                    );
                                  })}
                                </div>
                            </div>
                          )}
                          {(layer.kind === "camera-device" || layer.kind === "game-capture")
                            && videoInputError && (
                              <span className="layer-device-error" role="alert">
                                {videoInputError}
                              </span>
                            )}
                          {layer.kind === "display-capture" && desktopCaptureError && (
                            <span className="layer-device-error" role="alert">
                              {desktopCaptureError}
                            </span>
                          )}
                        </div>,
                        document.body,
                        layer.id,
                      )
                    )}
                  </div>
                );
              }) : (
                <p className="layer-empty-state">Select a scene to manage its layers.</p>
              )}
            </div>
          </section>

          <section className="inspector-section audio-section">
            <div className="section-title">
              <Icon name="audio" />
              <h3>Audio mixer</h3>
              <div className="layer-add-wrap" ref={audioAddMenuRef}>
                <button
                  className="text-icon-button"
                  title="Add audio source: capture card"
                  aria-label="Add audio source"
                  aria-haspopup="menu"
                  aria-expanded={audioAddMenuOpen}
                  type="button"
                  ref={audioAddMenuButtonRef}
                  onClick={() => setAudioAddMenuOpen((open) => !open)}
                >
                  <Icon name="plus" />
                </button>
                {audioAddMenuOpen && (
                  createPortal(
                    <div
                      className="layer-add-menu"
                      ref={audioAddMenuPopupRef}
                      role="menu"
                      aria-label="Add audio source"
                      style={{
                        left: audioAddMenuPosition?.left ?? 0,
                        top: audioAddMenuPosition?.top ?? 0,
                        visibility: audioAddMenuPosition ? "visible" : "hidden",
                      }}
                    >
                      {AUDIO_SOURCE_OPTIONS.map((option) => (
                        <button
                          className="layer-add-option"
                          key={option.id}
                          role="menuitem"
                          disabled={audioTracks.some((track) => track.id === option.id)}
                          onClick={() => addAudioSourceTrack(option.id, option.name)}
                        >
                          <Icon name="audio" />
                          <span className="layer-add-option-copy">
                            <span>{option.name}</span>
                            <span className="layer-add-option-description">{option.description}</span>
                          </span>
                        </button>
                      ))}
                    </div>,
                    document.body,
                  )
                )}
              </div>
            </div>
            <div className="audio-track-list">
              {audioTracks.map((track) => {
                const effectiveMeterLevel = track.muted
                  ? 0
                  : Math.round((audioMeterLevels[track.id] ?? 0) * track.volume / 100);
                const trackSettingsOpen = audioSettingsOpen && audioSettingsTrackId === track.id;
                const trackInputId = track.id === "mic"
                  ? selectedAudioInputId
                  : audioTrackInputIds[track.id] ?? "";
                return (
                  <div className={`audio-track${track.muted ? " audio-track--muted" : ""}`} key={track.id}>
                  <div className="audio-track-heading">
                    <span className="audio-track-name">
                      <Icon name={track.icon} />
                      {track.name}
                    </span>
                    <div className="audio-track-actions" ref={track.id === audioSettingsTrackId ? audioSettingsRef : undefined}>
                      <IconButton
                        active={trackSettingsOpen}
                        onClick={() => void toggleAudioSettings(track.id)}
                        ref={track.id === audioSettingsTrackId ? audioSettingsButtonRef : undefined}
                        title={`${track.name} settings`}
                        aria-label={`${track.name} settings`}
                        aria-expanded={trackSettingsOpen}
                        aria-haspopup="dialog"
                      >
                        <Icon name="settings" />
                      </IconButton>
                      <IconButton
                        tone={track.muted ? "alert" : "default"}
                        onClick={() => updateAudioTrack(track.id, { muted: !track.muted })}
                        aria-label={`${track.muted ? "Unmute" : "Mute"} ${track.name}`}
                        aria-pressed={track.muted}
                      >
                        <Icon name={track.muted ? "speaker-muted" : "speaker"} />
                      </IconButton>
                      {track.id !== "mic" && (
                        <IconButton
                          tone="danger"
                          title={`Remove ${track.name}`}
                          aria-label={`Remove ${track.name}`}
                          onClick={() => removeAudioTrack(track.id)}
                        >
                          <Icon name="trash" />
                        </IconButton>
                      )}
                    </div>
                  </div>
                  {trackSettingsOpen && createPortal(
                    <div
                      className="audio-device-popup"
                      ref={audioSettingsPopupRef}
                      role="dialog"
                      aria-label={`${track.name} settings`}
                      style={{
                        left: audioSettingsPosition?.left ?? 0,
                        top: audioSettingsPosition?.top ?? 0,
                        visibility: audioSettingsPosition ? "visible" : "hidden",
                      }}
                    >
                      <div className="audio-device-popup-heading">{track.name}</div>
                      <label className="audio-device-select">
                        <span>Input device</span>
                        <Dropdown
                            loading={audioInputLoading}
                            loadingLabel="Loading microphone inputs"
                            value={audioInputLoading ? "" : trackInputId}
                            onChange={(event) => {
                              if (track.id === "mic") {
                                setSelectedAudioInputId(event.target.value);
                              } else {
                                const value = event.target.value;
                                setAudioTrackInputIds((ids) => ({ ...ids, [track.id]: value }));
                              }
                            }}
                            disabled={audioInputDevices.length === 0}
                            aria-label={`${track.name} input device`}
                          >
                            {audioInputLoading ? (
                              <option value="">Select input device</option>
                            ) : (
                              <>
                              <option value="">Select input device</option>
                              {trackInputId
                                && !audioInputDevices.some((device) => device.id === trackInputId) && (
                                <option value={trackInputId}>Previously selected device unavailable</option>
                              )}
                              {audioInputDevices.map((device) => (
                                <option key={device.id} value={device.id}>{device.name}</option>
                              ))}
                              </>
                            )}
                          </Dropdown>
                      </label>
                      {track.id === "capture-card" && (
                        <label className="audio-device-select">
                          <span>Output device</span>
                          <Dropdown
                            loading={audioInputLoading}
                            loadingLabel="Loading output devices"
                            value={audioInputLoading ? "" : audioTrackOutputIds[track.id] ?? ""}
                            onChange={(event) => {
                              const value = event.target.value;
                              setAudioTrackOutputIds((ids) => ({ ...ids, [track.id]: value }));
                            }}
                            aria-label={`${track.name} output device`}
                          >
                            {audioInputLoading ? (
                              <option value="">Select output device</option>
                            ) : (
                              <>
                                <option value="">Select output device</option>
                                {audioOutputDevices.map((device) => (
                                  <option key={device.id} value={device.id}>{device.name}</option>
                                ))}
                              </>
                            )}
                          </Dropdown>
                        </label>
                      )}
                      {audioInputError && <p className="audio-device-error" role="alert">{audioInputError}</p>}
                    </div>,
                    document.body,
                  )}
                  <div className="audio-meter-row">
                    <span className="audio-control-label">Input level</span>
                    <div
                      className="audio-meter"
                      role="meter"
                      aria-label={`${track.name} input level`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={effectiveMeterLevel}
                      aria-valuetext={`${effectiveMeterLevel}%`}
                    >
                      <span
                        style={{
                          width: `${effectiveMeterLevel}%`,
                          background: "linear-gradient(to right, #83d6b5 0% 60%, #e4c65e 60% 80%, #ec7777 80% 100%)",
                          backgroundSize: `${10000 / Math.max(effectiveMeterLevel, 1)}% 100%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="audio-controls">
                    <label className="audio-control-label" htmlFor={`audio-volume-${track.id}`}>Volume</label>
                    <input
                      id={`audio-volume-${track.id}`}
                      type="range"
                      min="0"
                      max="100"
                      value={track.volume}
                      aria-label={`${track.name} volume`}
                      onChange={(event) => updateAudioTrack(track.id, { volume: Number(event.target.value) })}
                      style={{
                        background: `linear-gradient(to right, #92e6c6 ${track.volume}%, #30353c ${track.volume}%)`,
                      }}
                    />
                    <output className="volume-value" htmlFor={`audio-volume-${track.id}`}>{track.volume}%</output>
                  </div>
                  </div>
                );
              })}
            </div>
          </section>
        </aside>

        <section className="canvas-workspace" aria-label="Output previews">
          <div className="preview-grid">
            {OUTPUTS.map((output) => {
              const outputScene = scenesByOutput[output.id].find((scene) => scene.id === activeScenes[output.id]) ?? null;
              return (
                <OutputPreview
                  key={output.id}
                  output={output}
                  active={selectedOutput === output.id}
                  scene={outputScene}
                  layers={getLayersForOutput(output.id)}
                  guides={showGuides}
                  browserCaptureStreams={browserCaptureStreams}
                  selectedLayerId={
                    selectedCanvasObject && selectedCanvasObject.sceneId === outputScene?.id
                      ? selectedCanvasObject.layerId
                      : null
                  }
                  onSelect={() => {
                    setSettingsLayerId(null);
                    setLayerMenuOpen(false);
                    setSelectedOutput(output.id);
                  }}
                  onSelectLayer={(layerId) => {
                    setSelectedCanvasObject(outputScene ? { sceneId: outputScene.id, layerId } : null);
                  }}
                  onTransformChange={(layerId, transform) => {
                    if (outputScene) {
                      updateLayer(outputScene.id, layerId, { transform });
                    }
                  }}
                  onSourceDimensionsChange={(layerId, sourceDimensions) => {
                    if (outputScene) {
                      updateLayer(outputScene.id, layerId, { sourceDimensions });
                    }
                  }}
                />
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
