import type { CSSProperties } from "react";
import { CAPTURE_RESOLUTIONS } from "@/features/studio/constants/layers";
import type { CaptureResolution, CaptureResolutionId, CropInsets, LayerTransform, SourceDimensions } from "@/features/studio/types/studio.types";

export function getCaptureResolution(id: CaptureResolutionId): CaptureResolution {
  const resolution = CAPTURE_RESOLUTIONS.find((option) => option.id === id);
  if (!resolution) {
    throw new Error(`Unsupported capture resolution: ${id}`);
  }
  return resolution;
}

export function getSourceDimensions(stream: MediaStream): SourceDimensions | null {
  const settings = stream.getVideoTracks()[0]?.getSettings();
  return settings?.width && settings.height
    ? { width: settings.width, height: settings.height }
    : null;
}

export function getCropFractions(crop: CropInsets, sourceWidth: number, sourceHeight: number) {
  const width = Math.max(1, Math.round(sourceWidth));
  const height = Math.max(1, Math.round(sourceHeight));
  const left = Math.min(width - 1, crop.left);
  const right = Math.min(width - left - 1, crop.right);
  const top = Math.min(height - 1, crop.top);
  const bottom = Math.min(height - top - 1, crop.bottom);

  return {
    left: left / width,
    top: top / height,
    visibleWidth: (width - left - right) / width,
    visibleHeight: (height - top - bottom) / height,
  };
}

export function getCroppedVideoStyle(
  crop: CropInsets,
  sourceWidth: number,
  sourceHeight: number,
): CSSProperties {
  const fractions = getCropFractions(crop, sourceWidth, sourceHeight);

  return {
    position: "absolute",
    left: `${-fractions.left / fractions.visibleWidth * 100}%`,
    top: `${-fractions.top / fractions.visibleHeight * 100}%`,
    width: `${100 / fractions.visibleWidth}%`,
    height: `${100 / fractions.visibleHeight}%`,
  };
}

export function getCroppedLayerTransform(
  transform: LayerTransform,
  crop: CropInsets,
  sourceDimensions: SourceDimensions,
): LayerTransform {
  const fractions = getCropFractions(crop, sourceDimensions.width, sourceDimensions.height);
  return {
    x: transform.x + transform.width * fractions.left,
    y: transform.y + transform.height * fractions.top,
    width: transform.width * fractions.visibleWidth,
    height: transform.height * fractions.visibleHeight,
  };
}
