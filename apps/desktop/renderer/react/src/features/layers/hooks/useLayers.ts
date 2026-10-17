import type { OutputId, SceneId, LayerId, Scene, StudioLayer, LayerTransform, LayerOption, DeviceOption } from "@/features/studio/types/studio.types";
import { DEFAULT_CAPTURE_RESOLUTION, DEFAULT_CROP_INSETS } from "@/features/studio/constants/layers";
import { getDefaultLayerTransforms } from "@/features/studio/utils/transforms";
import { createLayerId } from "../utils/layer-id";
import { reorderLayers } from "../utils/reorder-layers";
import { useLayerDevices } from "./useLayerDevices";

type SetLayersByScene = (update: (current: Record<SceneId, StudioLayer[]>) => Record<SceneId, StudioLayer[]>) => void;

type UseLayersOptions = {
  activeScene: SceneId | null;
  currentScene: Scene | null;
  currentLayers: StudioLayer[];
  layersByScene: Record<SceneId, StudioLayer[]>;
  setLayersByScene: SetLayersByScene;
  videoInputDevices: DeviceOption[];
  setVideoInputError: (error: string | null) => void;
  setVideoInputDevices: (devices: DeviceOption[]) => void;
  setBrowserCaptureStream: (layerId: LayerId, stream: MediaStream | null) => void;
  setSettingsLayerId: (layerId: LayerId | null) => void;
  setLayerMenuOpen: (open: boolean) => void;
  deselectLayer: (layerId: LayerId) => void;
};

export function useLayers({
  activeScene,
  currentScene,
  currentLayers,
  layersByScene,
  setLayersByScene,
  videoInputDevices,
  setVideoInputError,
  setVideoInputDevices,
  setBrowserCaptureStream,
  setSettingsLayerId,
  setLayerMenuOpen,
  deselectLayer,
}: UseLayersOptions) {
  function toggleLayer(layerId: LayerId): void {
    const sceneId = activeScene;
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
    const sceneId = activeScene;
    if (!sceneId) {
      return;
    }
    setBrowserCaptureStream(layerId, null);
    setLayersByScene((current) => ({
      ...current,
      [sceneId]: current[sceneId].filter((layer) => layer.id !== layerId),
    }));
    setSettingsLayerId(null);
    deselectLayer(layerId);
  }

  function updateLayer(sceneId: SceneId, layerId: LayerId, update: Partial<StudioLayer>): void {
    setLayersByScene((current) => ({
      ...current,
      [sceneId]: (current[sceneId] ?? []).map((layer) => (
        layer.id === layerId ? { ...layer, ...update } : layer
      )),
    }));
  }

  function updateLayerTransform(
    sceneId: SceneId,
    layerId: LayerId,
    outputId: OutputId,
    transform: LayerTransform,
  ): void {
    setLayersByScene((current) => ({
      ...current,
      [sceneId]: (current[sceneId] ?? []).map((layer) => (
        layer.id === layerId
          ? { ...layer, transforms: { ...layer.transforms, [outputId]: transform } }
          : layer
      )),
    }));
  }

  function reorderLayer(sceneId: SceneId, sourceLayerId: LayerId, targetLayerId: LayerId, insertBefore: boolean): void {
    if (sourceLayerId === targetLayerId) {
      return;
    }
    setLayersByScene((current) => {
      const reordered = reorderLayers(current[sceneId] ?? [], sourceLayerId, targetLayerId, insertBefore);
      return reordered ? { ...current, [sceneId]: reordered } : current;
    });
  }

  const { layersReloading, reloadLayers, changeVideoInputDevice, changeLayerCaptureResolution } = useLayerDevices({
    currentScene,
    currentLayers,
    videoInputDevices,
    setVideoInputError,
    setVideoInputDevices,
    setBrowserCaptureStream,
    updateLayer,
  });

  function addLayer(option: LayerOption): void {
    const sceneId = activeScene;
    if (!sceneId) {
      return;
    }

    const layerId = createLayerId(layersByScene);
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
      transforms: getDefaultLayerTransforms(option.kind),
    };
    setLayersByScene((current) => ({
      ...current,
      [sceneId]: [layer, ...(current[sceneId] ?? [])],
    }));
    setLayerMenuOpen(false);
  }


  return {
    layersReloading,
    reloadLayers,
    toggleLayer,
    deleteLayer,
    updateLayer,
    updateLayerTransform,
    reorderLayer,
    changeVideoInputDevice,
    changeLayerCaptureResolution,
    addLayer,
  };
}
