import { getCaptureResolution } from "@/features/studio/utils/crop";
import type { StudioLayer } from "@/features/studio/types/studio.types";

type CropSide = "left" | "right" | "top" | "bottom";

const SIDES: CropSide[] = ["left", "right", "top", "bottom"];
const OPPOSITE: Record<CropSide, CropSide> = { left: "right", right: "left", top: "bottom", bottom: "top" };

type LayerCropControlsProps = {
  layer: StudioLayer;
  onChange: (crop: StudioLayer["crop"]) => void;
};

export function LayerCropControls({ layer, onChange }: LayerCropControlsProps) {
  const sourceDimensions = layer.sourceDimensions ?? getCaptureResolution(layer.captureResolution);

  return (
    <div className="layer-crop-controls" role="group" aria-label={`Crop ${layer.name} in pixels`}>
      <span className="layer-crop-title">Crop (source pixels)</span>
      <div className="layer-crop-grid">
        {SIDES.map((side) => {
          const dimension = side === "left" || side === "right" ? sourceDimensions.width : sourceDimensions.height;
          const maxCrop = Math.max(0, dimension - layer.crop[OPPOSITE[side]] - 1);
          return (
            <label className="layer-crop-field" key={side}>
              <span>{`${side[0].toUpperCase()}${side.slice(1)} (px)`}</span>
              <input
                type="number"
                min={0}
                max={maxCrop}
                step={1}
                value={layer.crop[side]}
                aria-label={`${side} crop for ${layer.name} in pixels`}
                onChange={(event) => {
                  const inputValue = event.currentTarget.valueAsNumber;
                  const amount = Number.isFinite(inputValue)
                    ? Math.min(maxCrop, Math.max(0, Math.floor(inputValue)))
                    : 0;
                  onChange({ ...layer.crop, [side]: amount });
                }}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}
