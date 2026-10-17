import type { ExportResolutionId } from "@shared/constants/media.constants";
import { EXPORT_RESOLUTIONS } from "@shared/constants/media.constants";
import { CAPTURE_RESOLUTIONS, SCENE_APPEARANCES } from "@/features/studio/constants/layers";
import type { CaptureResolutionId, CropInsets, LayerTransform, Scene, SourceDimensions } from "@/features/studio/types/studio.types";

export function readStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isScene(value: unknown): value is Scene {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && SCENE_APPEARANCES.some((appearance) => appearance === value.appearance);
}

export function isLayerTransform(value: unknown): value is LayerTransform {
  if (!isRecord(value)) {
    return false;
  }
  const { x, y, width, height } = value;
  return typeof x === "number"
    && Number.isFinite(x)
    && typeof y === "number"
    && Number.isFinite(y)
    && typeof width === "number"
    && Number.isFinite(width)
    && typeof height === "number"
    && Number.isFinite(height)
    && Math.abs(x) <= 1000
    && Math.abs(y) <= 1000
    && width >= 5
    && height >= 5
    && width <= 1000
    && height <= 1000;
}

export function isCaptureResolutionId(value: unknown): value is CaptureResolutionId {
  return CAPTURE_RESOLUTIONS.some((resolution) => resolution.id === value);
}

export function isExportResolutionId(value: unknown): value is ExportResolutionId {
  return typeof value === "string" && Object.hasOwn(EXPORT_RESOLUTIONS, value);
}

export function isCropInsets(value: unknown): value is CropInsets {
  return isRecord(value) && ["top", "right", "bottom", "left"].every((side) => {
    const amount = value[side];
    return typeof amount === "number"
      && Number.isInteger(amount)
      && amount >= 0
      && amount <= 10000;
  });
}

export function isSourceDimensions(value: unknown): value is SourceDimensions {
  return isRecord(value)
    && typeof value.width === "number"
    && Number.isFinite(value.width)
    && value.width > 0
    && typeof value.height === "number"
    && Number.isFinite(value.height)
    && value.height > 0;
}
