import type { StudioLayer } from "@/features/studio/types/studio.types";

export function PlaceholderLayers({ layers }: { layers: StudioLayer[] }) {
  return (
    <>
      {layers.filter((layer) => layer.kind === "gameplay").map((layer) => (
        <span className="game-art" key={layer.id} aria-hidden="true">
          <span className="game-sun" />
          <span className="game-horizon" />
          <span className="game-ridge game-ridge--back" />
          <span className="game-ridge game-ridge--front" />
          <span className="game-grid" />
        </span>
      ))}
      {layers.filter((layer) => layer.kind === "alerts").map((layer) => (
        <span className="alert-preview" key={layer.id}>
          ALERT PREVIEW
        </span>
      ))}
      {layers.filter((layer) => layer.kind === "camera").map((layer) => (
        <span className="camera-preview" key={layer.id}>
          <span className="camera-avatar" />
          <span className="camera-label">CAM</span>
        </span>
      ))}
    </>
  );
}
