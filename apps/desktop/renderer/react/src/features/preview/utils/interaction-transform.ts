import type { CanvasInteraction, LayerTransform } from "@/features/studio/types/studio.types";

const clampPosition = (value: number) => Math.min(1000, Math.max(-1000, value));

export function getInteractionTransform(
  interaction: CanvasInteraction,
  deltaX: number,
  deltaY: number,
): LayerTransform {
  const initial = interaction.initialTransform;
  if (interaction.mode === "move") {
    return { ...initial, x: clampPosition(initial.x + deltaX), y: clampPosition(initial.y + deltaY) };
  }

  const { cropFractions, initialVisibleTransform: visibleInitial } = interaction;
  const centerX = visibleInitial.x + visibleInitial.width / 2;
  const centerY = visibleInitial.y + visibleInitial.height / 2;
  const surfaceAspectRatio = interaction.surfaceWidth / interaction.surfaceHeight;
  const aspectRatio = (visibleInitial.width / visibleInitial.height) * surfaceAspectRatio;
  const heightDeltaFromX = (deltaX / aspectRatio) * surfaceAspectRatio
    * (interaction.mode === "bottom-left" ? -1 : 1);
  const heightDelta = Math.abs(deltaY) >= Math.abs(heightDeltaFromX) ? deltaY * 2 : heightDeltaFromX * 2;
  const minHeight = Math.max(
    5 * cropFractions.visibleHeight,
    (5 * cropFractions.visibleWidth * surfaceAspectRatio) / aspectRatio,
  );
  const maxHeight = Math.min(
    1000 * cropFractions.visibleHeight,
    (1000 * cropFractions.visibleWidth * surfaceAspectRatio) / aspectRatio,
  );
  const height = Math.min(maxHeight, Math.max(minHeight, visibleInitial.height + heightDelta));
  const width = (height * aspectRatio) / surfaceAspectRatio;
  const baseWidth = width / cropFractions.visibleWidth;
  const baseHeight = height / cropFractions.visibleHeight;
  return {
    ...initial,
    x: clampPosition(centerX - width / 2 - baseWidth * cropFractions.left),
    y: clampPosition(centerY - height / 2 - baseHeight * cropFractions.top),
    width: baseWidth,
    height: baseHeight,
  };
}
