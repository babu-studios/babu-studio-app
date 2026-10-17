import type { Scene, SceneId } from "@/features/studio/types/studio.types";

let nextCustomSceneId = 1;

export function createSceneId(scenes: Scene[]): SceneId {
  let sceneId = `custom-${nextCustomSceneId++}`;
  while (scenes.some((scene) => scene.id === sceneId)) {
    sceneId = `custom-${nextCustomSceneId++}`;
  }
  return sceneId;
}
