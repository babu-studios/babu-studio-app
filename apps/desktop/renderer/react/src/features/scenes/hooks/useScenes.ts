import { useEffect, useRef, useState } from "react";
import type { SceneId, LayerId, Scene, StudioLayer } from "@/features/studio/types/studio.types";
import { createSceneId } from "../utils/scene-id";

type Setter<T> = (update: T | ((current: T) => T)) => void;

type UseScenesOptions = {
  scenes: Scene[];
  setScenes: Setter<Scene[]>;
  activeScene: SceneId | null;
  setActiveScene: (sceneId: SceneId | null) => void;
  layersByScene: Record<SceneId, StudioLayer[]>;
  setLayersByScene: Setter<Record<SceneId, StudioLayer[]>>;
  setBrowserCaptureStream: (layerId: LayerId, stream: MediaStream | null) => void;
  setSettingsLayerId: (layerId: LayerId | null) => void;
  setLayerMenuOpen: (open: boolean) => void;
  clearCanvasSelection: () => void;
};

export function useScenes({
  scenes,
  setScenes,
  activeScene,
  setActiveScene,
  layersByScene,
  setLayersByScene,
  setBrowserCaptureStream,
  setSettingsLayerId,
  setLayerMenuOpen,
  clearCanvasSelection,
}: UseScenesOptions) {
  const [editingScene, setEditingScene] = useState<SceneId | null>(null);
  const [sceneNameDraft, setSceneNameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const ignoreRenameBlur = useRef(false);

  useEffect(() => {
    if (editingScene) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [editingScene]);


  function selectScene(sceneId: SceneId | null): void {
    setSettingsLayerId(null);
    setLayerMenuOpen(false);
    clearCanvasSelection();
    setActiveScene(sceneId);
  }

  function addScene(): void {
    const scene: Scene = {
      id: createSceneId(scenes),
      name: `Scene ${scenes.length + 1}`,
      appearance: "custom",
    };
    setScenes((current) => [...current, scene]);
    selectScene(scene.id);
  }

  function startSceneRename(scene: Scene): void {
    setSceneNameDraft(scene.name);
    setEditingScene(scene.id);
  }

  function finishSceneRename(sceneId: SceneId): void {
    if (ignoreRenameBlur.current) {
      ignoreRenameBlur.current = false;
      return;
    }

    const name = sceneNameDraft.trim();
    if (name) {
      setScenes((current) => current.map((scene) => (
          scene.id === sceneId ? { ...scene, name } : scene
        )));
    }
    setEditingScene(null);
  }

  function deleteScene(sceneId: SceneId): void {
    const sceneIndex = scenes.findIndex((scene) => scene.id === sceneId);
    if (sceneIndex === -1) {
      return;
    }

    for (const layer of layersByScene[sceneId] ?? []) {
      setBrowserCaptureStream(layer.id, null);
    }
    const replacementScene = scenes[sceneIndex + 1] ?? scenes[sceneIndex - 1] ?? null;
    setScenes((current) => current.filter((scene) => scene.id !== sceneId));
    setLayersByScene((current) => {
      const remainingLayers = { ...current };
      delete remainingLayers[sceneId];
      return remainingLayers;
    });
    setSettingsLayerId(null);
    setLayerMenuOpen(false);
    if (activeScene === sceneId) {
      selectScene(replacementScene?.id ?? null);
    }
    if (editingScene === sceneId) {
      setEditingScene(null);
    }
  }


  return {
    editingScene,
    setEditingScene,
    sceneNameDraft,
    setSceneNameDraft,
    renameInputRef,
    ignoreRenameBlur,
    selectScene,
    addScene,
    startSceneRename,
    finishSceneRename,
    deleteScene,
  };
}
