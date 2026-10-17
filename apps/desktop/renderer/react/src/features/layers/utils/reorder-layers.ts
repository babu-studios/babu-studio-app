import type { LayerId, StudioLayer } from "@/features/studio/types/studio.types";

export function reorderLayers(
  sceneLayers: StudioLayer[],
  sourceLayerId: LayerId,
  targetLayerId: LayerId,
  insertBefore: boolean,
): StudioLayer[] | null {
  const movingLayer = sceneLayers.find((layer) => layer.id === sourceLayerId);
  if (!movingLayer || !sceneLayers.some((layer) => layer.id === targetLayerId)) {
    return null;
  }
  const reordered = sceneLayers.filter((layer) => layer.id !== sourceLayerId);
  const targetIndex = reordered.findIndex((layer) => layer.id === targetLayerId);
  reordered.splice(targetIndex + (insertBefore ? 0 : 1), 0, movingLayer);
  return reordered;
}
