import { useState } from "react";
import type { OutputId, SceneId, LayerId } from "@/features/studio/types/studio.types";

type CanvasSelection = { sceneId: SceneId; layerId: LayerId; outputId: OutputId };

export function useCanvasSelection() {
  const [selectedCanvasObject, setSelectedCanvasObject] = useState<CanvasSelection | null>(null);

  return {
    selectedCanvasObject,
    selectCanvasObject: setSelectedCanvasObject,
    clearCanvasSelection: () => setSelectedCanvasObject(null),
    deselectLayer: (layerId: LayerId) => setSelectedCanvasObject((selected) => selected?.layerId === layerId ? null : selected),
  };
}
