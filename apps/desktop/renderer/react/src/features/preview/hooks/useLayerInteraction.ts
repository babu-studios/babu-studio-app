import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type {
  CanvasInteraction,
  CanvasResizeCorner,
  LayerId,
  LayerTransform,
  OutputId,
  StudioLayer,
} from "@/features/studio/types/studio.types";
import { getCaptureResolution, getCropFractions, getCroppedLayerTransform } from "@/features/studio/utils/crop";
import { getInteractionTransform } from "../utils/interaction-transform";

type PointerEventHandler = (event: ReactPointerEvent<HTMLSpanElement>) => void;

export type LayerPointerHandlers = {
  onPointerDown: PointerEventHandler;
  onPointerMove: PointerEventHandler;
  onPointerUp: PointerEventHandler;
  onPointerCancel: PointerEventHandler;
  onClick: (event: { stopPropagation: () => void }) => void;
};

type Options = {
  outputId: OutputId;
  onSelectLayer: (layerId: LayerId) => void;
  onTransformChange: (layerId: LayerId, transform: LayerTransform) => void;
};

export function useLayerInteraction({ outputId, onSelectLayer, onTransformChange }: Options) {
  const surfaceRef = useRef<HTMLSpanElement>(null);
  const interactionRef = useRef<CanvasInteraction | null>(null);
  const [dragTransform, setDragTransform] = useState<{ layerId: LayerId; transform: LayerTransform } | null>(null);

  function begin(event: ReactPointerEvent<HTMLSpanElement>, layer: StudioLayer): void {
    event.preventDefault();
    event.stopPropagation();
    onSelectLayer(layer.id);

    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    const corner = target?.closest("[data-resize-corner]")?.getAttribute("data-resize-corner");
    const resizeCorner: CanvasResizeCorner | null = corner === "bottom-left" || corner === "bottom-right" ? corner : null;
    const sourceDimensions = layer.sourceDimensions ?? getCaptureResolution(layer.captureResolution);
    const initialTransform = layer.transforms[outputId];
    interactionRef.current = {
      pointerId: event.pointerId,
      layerId: layer.id,
      mode: resizeCorner ?? "move",
      startX: event.clientX,
      startY: event.clientY,
      surfaceWidth: bounds.width,
      surfaceHeight: bounds.height,
      cropFractions: getCropFractions(layer.crop, sourceDimensions.width, sourceDimensions.height),
      initialVisibleTransform: getCroppedLayerTransform(initialTransform, layer.crop, sourceDimensions),
      initialTransform,
      currentTransform: initialTransform,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: ReactPointerEvent<HTMLSpanElement>): void {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const deltaX = ((event.clientX - interaction.startX) / interaction.surfaceWidth) * 100;
    const deltaY = ((event.clientY - interaction.startY) / interaction.surfaceHeight) * 100;
    const transform = getInteractionTransform(interaction, deltaX, deltaY);
    interaction.currentTransform = transform;
    setDragTransform({ layerId: interaction.layerId, transform });
  }

  function finish(event: ReactPointerEvent<HTMLSpanElement>): void {
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

  function getHandlers(layer: StudioLayer): LayerPointerHandlers {
    return {
      onPointerDown: (event) => begin(event, layer),
      onPointerMove: move,
      onPointerUp: finish,
      onPointerCancel: finish,
      onClick: (event) => event.stopPropagation(),
    };
  }

  return { surfaceRef, dragTransform, getHandlers };
}
