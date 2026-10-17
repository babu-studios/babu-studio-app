import type { OUTPUTS } from "@/features/studio/constants/outputs";
import type {
  LayerId,
  LayerTransform,
  Scene,
  SourceDimensions,
  StudioLayer,
} from "@/features/studio/types/studio.types";
import { getCaptureResolution, getCroppedLayerTransform } from "@/features/studio/utils/crop";
import { useLayerInteraction } from "../hooks/useLayerInteraction";
import { PlaceholderLayers } from "./PlaceholderLayers";
import { PreviewHeader } from "./PreviewHeader";
import { PausedOverlay, PreviewFooter } from "./PreviewStatus";
import { SourceObject } from "./SourceObject";

type OutputPreviewProps = {
  output: (typeof OUTPUTS)[number];
  scene: Scene | null;
  layers: StudioLayer[];
  previewEnabled: boolean;
  selectedLayerId: LayerId | null;
  browserCaptureStreams: Record<LayerId, MediaStream>;
  onSelectLayer: (layerId: LayerId) => void;
  onTogglePreview: () => void;
  onTransformChange: (layerId: LayerId, transform: LayerTransform) => void;
  onSourceDimensionsChange: (layerId: LayerId, dimensions: SourceDimensions) => void;
};

const isPositionableSource = (layer: StudioLayer) => layer.kind === "camera-device" || layer.kind === "game-capture";

export function OutputPreview({
  output,
  scene,
  layers,
  previewEnabled,
  selectedLayerId,
  browserCaptureStreams,
  onSelectLayer,
  onTogglePreview,
  onTransformChange,
  onSourceDimensionsChange,
}: OutputPreviewProps) {
  const { surfaceRef, dragTransform, getHandlers } = useLayerInteraction({
    outputId: output.id,
    onSelectLayer,
    onTransformChange,
  });
  const visibleLayers = layers.filter((layer) => layer.enabled);
  const sourceLayers = visibleLayers.filter(isPositionableSource);
  const showScene = previewEnabled && scene;

  return (
    <div
      className={`preview-card${previewEnabled ? "" : " preview-card--paused"}`}
      role="group"
      aria-label={`${output.name} preview ${previewEnabled ? "enabled" : "paused"}. ${previewEnabled ? "Drag layers to place them for this layout." : "Recording is unaffected."}`}
    >
      <PreviewHeader output={output} previewEnabled={previewEnabled} onTogglePreview={onTogglePreview} />
      <span
        ref={surfaceRef}
        className={`preview-surface preview-surface--${output.id} scene-${scene?.appearance ?? "empty"}${previewEnabled ? "" : " preview-surface--paused"}`}
      >
        {showScene && <PlaceholderLayers layers={visibleLayers} />}
        {showScene && sourceLayers.map((layer, index) => {
          const baseTransform = dragTransform?.layerId === layer.id ? dragTransform.transform : layer.transforms[output.id];
          const sourceDimensions = layer.sourceDimensions ?? getCaptureResolution(layer.captureResolution);
          return (
            <SourceObject
              key={layer.id}
              layer={layer}
              transform={getCroppedLayerTransform(baseTransform, layer.crop, sourceDimensions)}
              selected={selectedLayerId === layer.id}
              stackCount={sourceLayers.length}
              stackIndex={index}
              stream={browserCaptureStreams[layer.id]}
              handlers={getHandlers(layer)}
              onSourceDimensions={(dimensions) => onSourceDimensionsChange(layer.id, dimensions)}
            />
          );
        })}
        {!previewEnabled && <PausedOverlay />}
      </span>
      <PreviewFooter previewEnabled={previewEnabled} />
    </div>
  );
}
