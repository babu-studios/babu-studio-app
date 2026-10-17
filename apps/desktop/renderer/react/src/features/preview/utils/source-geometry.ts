import type { CanvasResizeCorner, LayerTransform } from "@/features/studio/types/studio.types";

const clampPercent = (value: number) => `${Math.min(98, Math.max(2, value))}%`;

export function isOutsideCanvas(transform: LayerTransform): boolean {
  return transform.x + transform.width <= 0
    || transform.x >= 100
    || transform.y + transform.height <= 0
    || transform.y >= 100;
}

export function getOffscreenHandlePosition(transform: LayerTransform) {
  return {
    left: clampPercent(transform.x + transform.width / 2),
    top: clampPercent(transform.y + transform.height / 2),
  };
}

export function getCornerHandlePositions(transform: LayerTransform): Record<CanvasResizeCorner, { left: string; top: string }> {
  const top = clampPercent(transform.y + transform.height);
  return {
    "bottom-left": { left: clampPercent(transform.x), top },
    "bottom-right": { left: clampPercent(transform.x + transform.width), top },
  };
}
