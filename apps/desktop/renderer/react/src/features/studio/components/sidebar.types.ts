import type { Dispatch, SetStateAction } from "react";
import type { AudioTrack, CaptureResolutionId, DeviceOption, LayerId, LayerOption, PopupPosition, Scene, SceneId, StudioLayer } from "@/features/studio/types/studio.types";

export type Setter<T> = Dispatch<SetStateAction<T>>;
export type MutableRef<T> = { current: T };
type VideoLayerKind = "camera-device" | "game-capture";

export type SceneSidebarProps = {
  inspectorRef: MutableRef<HTMLElement | null>;
  currentScenes: Scene[];
  activeScene: SceneId | null;
  editingScene: SceneId | null;
  setEditingScene: Setter<SceneId | null>;
  sceneNameDraft: string;
  setSceneNameDraft: Setter<string>;
  renameInputRef: MutableRef<HTMLInputElement | null>;
  ignoreRenameBlur: MutableRef<boolean>;
  addScene: () => void;
  selectScene: (sceneId: SceneId | null) => void;
  startSceneRename: (scene: Scene) => void;
  finishSceneRename: (sceneId: SceneId) => void;
  deleteScene: (sceneId: SceneId) => void;
};

export type LayerSidebarProps = {
  currentScene: Scene | null;
  currentLayers: StudioLayer[];
  settingsLayerId: LayerId | null;
  setSettingsLayerId: Setter<LayerId | null>;
  videoInputDevices: DeviceOption[];
  videoInputLoading: boolean;
  videoInputError: string | null;
  draggedLayerId: LayerId | null;
  setDraggedLayerId: Setter<LayerId | null>;
  dragOverLayerId: LayerId | null;
  setDragOverLayerId: Setter<LayerId | null>;
  layersReloading: boolean;
  layerMenuOpen: boolean;
  setLayerMenuOpen: Setter<boolean>;
  layerMenuPosition: PopupPosition | null;
  layerMenuRef: MutableRef<HTMLDivElement | null>;
  layerMenuButtonRef: MutableRef<HTMLButtonElement | null>;
  layerMenuPopupRef: MutableRef<HTMLDivElement | null>;
  layerSettingsPosition: PopupPosition | null;
  layerSettingsButtonRef: MutableRef<HTMLButtonElement | null>;
  layerSettingsRef: MutableRef<HTMLDivElement | null>;
  reloadAll: () => void;
  addLayer: (option: LayerOption) => void;
  toggleLayer: (layerId: LayerId) => void;
  deleteLayer: (layerId: LayerId) => void;
  updateLayer: (sceneId: SceneId, layerId: LayerId, update: Partial<StudioLayer>) => void;
  reorderLayer: (sceneId: SceneId, sourceLayerId: LayerId, targetLayerId: LayerId, insertBefore: boolean) => void;
  changeVideoInputDevice: (
    sceneId: SceneId,
    layerId: LayerId,
    layerKind: VideoLayerKind,
    deviceId: string,
    captureResolution: CaptureResolutionId,
  ) => Promise<void>;
  changeLayerCaptureResolution: (
    sceneId: SceneId,
    layer: StudioLayer,
    captureResolution: CaptureResolutionId,
  ) => Promise<void>;
};

export type AudioSidebarProps = {
  audioInputDevices: DeviceOption[];
  audioInputError: string | null;
  selectedAudioInputId: string;
  setSelectedAudioInputId: Setter<string>;
  audioMeterLevels: Record<string, number>;
  audioTracks: AudioTrack[];
  audioSettingsOpen: boolean;
  audioSettingsTrackId: string;
  setAudioTrackInputIds: Setter<Record<string, string>>;
  audioTrackInputIds: Record<string, string>;
  audioOutputDevices: DeviceOption[];
  setAudioTrackOutputIds: Setter<Record<string, string>>;
  audioTrackOutputIds: Record<string, string>;
  audioSettingsPosition: PopupPosition | null;
  audioAddMenuOpen: boolean;
  setAudioAddMenuOpen: Setter<boolean>;
  audioAddMenuPosition: PopupPosition | null;
  audioAddMenuRef: MutableRef<HTMLDivElement | null>;
  audioAddMenuButtonRef: MutableRef<HTMLButtonElement | null>;
  audioAddMenuPopupRef: MutableRef<HTMLDivElement | null>;
  audioSettingsRef: MutableRef<HTMLDivElement | null>;
  audioSettingsButtonRef: MutableRef<HTMLButtonElement | null>;
  audioSettingsPopupRef: MutableRef<HTMLDivElement | null>;
  showAudioInputLoading: boolean;
  updateAudioTrack: (trackId: string, update: Partial<AudioTrack>) => void;
  addAudioSourceTrack: (id: string, name: string) => void;
  removeAudioTrack: (trackId: string) => void;
  toggleAudioSettings: (trackId: string) => Promise<void>;
};

export type StudioSidebarProps = {
  isRecordingActive: boolean;
  scene: SceneSidebarProps;
  layers: LayerSidebarProps;
  audio: AudioSidebarProps;
};

