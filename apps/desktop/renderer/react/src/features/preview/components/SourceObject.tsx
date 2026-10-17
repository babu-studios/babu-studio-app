import type { LayerPointerHandlers } from "../hooks/useLayerInteraction";
import type { CanvasResizeCorner, LayerTransform, SourceDimensions, StudioLayer } from "@/features/studio/types/studio.types";
import { getCaptureResolution } from "@/features/studio/utils/crop";
import { getCornerHandlePositions, getOffscreenHandlePosition, isOutsideCanvas } from "../utils/source-geometry";
import { MediaStreamVideo } from "./MediaStreamVideo";

const CORNERS: CanvasResizeCorner[] = ["bottom-left", "bottom-right"];

type SourceObjectProps = {
  layer: StudioLayer;
  transform: LayerTransform;
  selected: boolean;
  stackCount: number;
  stackIndex: number;
  stream: MediaStream | undefined;
  handlers: LayerPointerHandlers;
  onSourceDimensions: (dimensions: SourceDimensions) => void;
};

export function SourceObject({
  layer,
  transform,
  selected,
  stackCount,
  stackIndex,
  stream,
  handlers,
  onSourceDimensions,
}: SourceObjectProps) {
  const cornerPositions = getCornerHandlePositions(transform);
  return (
    <>
      <span
        className={`source-preview-object${selected ? " source-preview-object--selected" : ""}`}
        style={{
          left: `${transform.x}%`,
          top: `${transform.y}%`,
          width: `${transform.width}%`,
          height: `${transform.height}%`,
          zIndex: stackCount - stackIndex,
        }}
        title="Drag to move. Use either bottom corner to resize proportionally around the center. Objects may extend beyond the canvas."
        {...handlers}
      >
        {layer.deviceId && stream ? (
          <MediaStreamVideo
            stream={stream}
            resolution={getCaptureResolution(layer.captureResolution)}
            crop={layer.crop}
            onSourceDimensions={onSourceDimensions}
          />
        ) : (
          <span className="source-preview-label">
            {layer.deviceId ? "Reconnect video input in settings" : "No device selected"}
          </span>
        )}
      </span>
      {isOutsideCanvas(transform) && (
        <span
          className="source-preview-offscreen-handle"
          role="button"
          tabIndex={0}
          aria-label={`Drag ${layer.name} back into the preview`}
          style={{ ...getOffscreenHandlePosition(transform), zIndex: stackCount + 2 }}
          title={`Drag ${layer.name} back into the preview`}
          {...handlers}
        />
      )}
      {selected && CORNERS.map((corner) => (
        <span
          key={corner}
          className={`source-preview-corner-resize-handle source-preview-corner-resize-handle--${corner}`}
          data-resize-corner={corner}
          role="button"
          tabIndex={0}
          aria-label={`Resize from ${corner} corner, keep video aspect ratio`}
          style={{ ...cornerPositions[corner], zIndex: stackCount + 4 }}
          title="Drag corner to resize proportionally around the center"
          {...handlers}
        />
      ))}
    </>
  );
}
