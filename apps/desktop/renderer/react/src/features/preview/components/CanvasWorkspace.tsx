import { OUTPUTS } from "@/features/studio/constants/outputs";
import type { LayerId, LayerTransform, OutputId, Scene, SceneId, SourceDimensions, StudioLayer } from "@/features/studio/types/studio.types";
import { OutputPreview } from "./OutputPreview";

type CanvasSelection = { sceneId: SceneId; layerId: LayerId; outputId: OutputId };

type CanvasWorkspaceProps = {
  scene: Scene | null;
  layers: StudioLayer[];
  previewEnabled: Record<OutputId, boolean>;
  browserCaptureStreams: Record<LayerId, MediaStream>;
  selection: CanvasSelection | null;
  onSelect: (selection: CanvasSelection | null) => void;
  onTogglePreview: (outputId: OutputId) => void;
  onTransformChange: (layerId: LayerId, outputId: OutputId, transform: LayerTransform) => void;
  onSourceDimensionsChange: (layerId: LayerId, dimensions: SourceDimensions) => void;
};

export function CanvasWorkspace({
  scene,
  layers,
  previewEnabled,
  browserCaptureStreams,
  selection,
  onSelect,
  onTogglePreview,
  onTransformChange,
  onSourceDimensionsChange,
}: CanvasWorkspaceProps) {
  return (
    <section className="canvas-workspace" aria-label="Output previews" onPointerDown={() => onSelect(null)}>
      <div className="preview-grid">
        {OUTPUTS.map((output) => (
          <OutputPreview
            key={output.id}
            output={output}
            scene={scene}
            layers={layers}
            previewEnabled={previewEnabled[output.id]}
            browserCaptureStreams={browserCaptureStreams}
            selectedLayerId={
              selection && selection.sceneId === scene?.id && selection.outputId === output.id
                ? selection.layerId
                : null
            }
            onSelectLayer={(layerId) => onSelect(scene ? { sceneId: scene.id, layerId, outputId: output.id } : null)}
            onTogglePreview={() => onTogglePreview(output.id)}
            onTransformChange={(layerId, transform) => onTransformChange(layerId, output.id, transform)}
            onSourceDimensionsChange={onSourceDimensionsChange}
          />
        ))}
      </div>
    </section>
  );
}
