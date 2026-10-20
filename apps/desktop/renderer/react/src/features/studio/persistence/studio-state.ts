import { MAX_AUDIO_VOLUME_PERCENT } from "@shared/constants/media.constants";
import { DEFAULT_AUDIO_MIXER } from "@/features/studio/constants/audio";
import { DEFAULT_CAPTURE_RESOLUTION, DEFAULT_CROP_INSETS, ICON_NAMES, LAYER_KINDS } from "@/features/studio/constants/layers";
import { OUTPUTS } from "@/features/studio/constants/outputs";
import { PORTRAIT_PLACEMENT_VERSION } from "@/features/studio/constants/storage";
import type { AudioTrack, OutputId, PersistedAudioMixer, PersistedStudioState, Scene, SceneId, StudioLayer } from "@/features/studio/types/studio.types";
import { isCaptureResolutionId, isCropInsets, isLayerTransform, isRecord, isScene, isSourceDimensions, readStringRecord } from "@/features/studio/utils/guards";
import { centerLayerTransform, convertLandscapeTransformToPortrait, getDefaultLayerTransform } from "@/features/studio/utils/transforms";

export function loadAudioMixer(savedValue: unknown): PersistedAudioMixer {
  try {
    const parsedValue: unknown = typeof savedValue === "string" ? JSON.parse(savedValue) : savedValue;
    if (!isRecord(parsedValue) || !Array.isArray(parsedValue.tracks)) {
      return DEFAULT_AUDIO_MIXER;
    }
    const tracks = parsedValue.tracks.flatMap((track): AudioTrack[] => (
      isRecord(track)
        && typeof track.id === "string"
        && typeof track.name === "string"
        && typeof track.volume === "number"
        && typeof track.muted === "boolean"
        ? [{
          id: track.id,
          name: track.name,
          icon: "audio",
          volume: Math.max(0, Math.min(MAX_AUDIO_VOLUME_PERCENT, track.volume)),
          muted: track.muted,
        }]
        : []
    ));
    if (!tracks.some((track) => track.id === "mic")) {
      tracks.unshift(DEFAULT_AUDIO_MIXER.tracks[0]);
    }
    return {
      tracks,
      selectedInputId: typeof parsedValue.selectedInputId === "string" ? parsedValue.selectedInputId : "",
      monitoringEnabled: parsedValue.monitoringEnabled === true,
      trackInputIds: readStringRecord(parsedValue.trackInputIds),
      trackOutputIds: readStringRecord(parsedValue.trackOutputIds),
    };
  } catch (error) {
    console.error("Unable to restore the audio mixer:", error);
    return DEFAULT_AUDIO_MIXER;
  }
}

export function loadLegacyStoredValue(keys: string[]): unknown {
  try {
    for (const key of keys) {
      const saved = localStorage.getItem(key);
      if (saved !== null) {
        return JSON.parse(saved) as unknown;
      }
    }
  } catch (error) {
    console.error("Unable to import existing Babu Studio settings:", error);
  }
  return null;
}

export function parseStudioLayer(value: unknown, initializePortraitFromLandscape: boolean): StudioLayer | null {
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

  const legacyTransform = isLayerTransform(value.transform)
    ? value.transform
    : getDefaultLayerTransform(kind);
  const savedTransforms = isRecord(value.transforms) ? value.transforms : {};
  const landscapeTransform = isLayerTransform(savedTransforms.landscape)
    ? savedTransforms.landscape
    : legacyTransform;

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
    transforms: {
      landscape: { ...landscapeTransform },
      portrait: !initializePortraitFromLandscape && isLayerTransform(savedTransforms.portrait)
        ? savedTransforms.portrait
        : centerLayerTransform(convertLandscapeTransformToPortrait(landscapeTransform)),
    },
  };
}

export function loadPersistedStudioState(savedValue: unknown): PersistedStudioState {
  const emptyState: PersistedStudioState = {
    activeScene: null,
    scenes: [],
    layersByScene: {},
    portraitPlacementVersion: PORTRAIT_PLACEMENT_VERSION,
  };

  try {
    const parsed: unknown = typeof savedValue === "string" ? JSON.parse(savedValue) : savedValue;
    if (parsed === null || parsed === undefined) {
      return emptyState;
    }
    if (!isRecord(parsed)) {
      throw new Error("Saved studio state must be an object.");
    }

    const legacyScenesByOutput: Record<OutputId, Scene[]> = { landscape: [], portrait: [] };
    for (const output of OUTPUTS) {
      const scenes = isRecord(parsed.scenesByOutput) ? parsed.scenesByOutput[output.id] : null;
      if (Array.isArray(scenes)) {
        legacyScenesByOutput[output.id] = scenes.filter(isScene);
      }
    }

    const scenes = (Array.isArray(parsed.scenes) ? parsed.scenes.filter(isScene) : Object.values(legacyScenesByOutput).flat())
      .filter((scene, index, allScenes) => allScenes.findIndex((candidate) => candidate.id === scene.id) === index);
    const initializePortraitFromLandscape = parsed.portraitPlacementVersion !== PORTRAIT_PLACEMENT_VERSION;
    const sceneIds = new Set(scenes.map((scene) => scene.id));
    const layersByScene: Record<SceneId, StudioLayer[]> = {};
    if (isRecord(parsed.layersByScene)) {
      for (const [sceneId, layers] of Object.entries(parsed.layersByScene)) {
        if (sceneIds.has(sceneId) && Array.isArray(layers)) {
          layersByScene[sceneId] = layers
            .map((layer) => parseStudioLayer(layer, initializePortraitFromLandscape))
            .filter((layer): layer is StudioLayer => layer !== null);
        }
      }
    }

    const selectedOutput = parsed.selectedOutput === "portrait" ? "portrait" : "landscape";
    const legacyActiveScenes = isRecord(parsed.activeScenes) ? parsed.activeScenes : {};
    const activeScene = typeof parsed.activeScene === "string" && sceneIds.has(parsed.activeScene)
      ? parsed.activeScene
      : [selectedOutput, "landscape", "portrait"]
        .map((output) => legacyActiveScenes[output])
        .find((sceneId): sceneId is string => typeof sceneId === "string" && sceneIds.has(sceneId))
        ?? scenes[0]?.id
        ?? null;

    return {
      activeScene,
      scenes,
      layersByScene,
      portraitPlacementVersion: PORTRAIT_PLACEMENT_VERSION,
    };
  } catch (error) {
    console.error("Could not load saved Babu Studio scenes and layers.", error);
    return emptyState;
  }
}
