import { OUTPUTS } from "@/features/studio/constants/outputs";
import type { LayerKind, LayerTransform, LayerTransforms } from "@/features/studio/types/studio.types";

export function getDefaultLayerTransform(kind: LayerKind): LayerTransform {
  if (kind === "camera-device") {
    return { x: 70, y: 68, width: 25, height: 25 };
  }
  if (kind === "game-capture") {
    return { x: 20, y: 20, width: 60, height: 60 };
  }
  if (kind === "gameplay") {
    return { x: 0, y: 0, width: 100, height: 100 };
  }
  if (kind === "camera") {
    return { x: 70, y: 68, width: 25, height: 25 };
  }
  return { x: 38, y: 10, width: 24, height: 16 };
}

export function convertLandscapeTransformToPortrait(transform: LayerTransform): LayerTransform {
  const landscape = OUTPUTS.find((output) => output.id === "landscape");
  const portrait = OUTPUTS.find((output) => output.id === "portrait");
  if (!landscape || !portrait) {
    throw new Error("Landscape and Portrait output dimensions are required to convert layer placement.");
  }

  return {
    x: transform.x * landscape.width / portrait.width,
    y: transform.y * landscape.height / portrait.height,
    width: transform.width * landscape.width / portrait.width,
    height: transform.height * landscape.height / portrait.height,
  };
}

export function centerLayerTransform(transform: LayerTransform): LayerTransform {
  return {
    ...transform,
    x: (100 - transform.width) / 2,
    y: (100 - transform.height) / 2,
  };
}

export function createLayerTransforms(transform: LayerTransform): LayerTransforms {
  const landscape = centerLayerTransform(transform);
  return {
    landscape,
    portrait: centerLayerTransform(convertLandscapeTransformToPortrait(landscape)),
  };
}

export function getDefaultLayerTransforms(kind: LayerKind): LayerTransforms {
  return createLayerTransforms(getDefaultLayerTransform(kind));
}
