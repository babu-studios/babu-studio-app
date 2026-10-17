import type { LayerId, StudioLayer } from "@/features/studio/types/studio.types";

let nextLayerId = 1;

export function createLayerId(layersByScene: Record<string, StudioLayer[]>): LayerId {
  const exists = (id: LayerId) => Object.values(layersByScene).some((layers) => layers.some((layer) => layer.id === id));
  let layerId = `source-${nextLayerId++}`;
  while (exists(layerId)) {
    layerId = `source-${nextLayerId++}`;
  }
  return layerId;
}
