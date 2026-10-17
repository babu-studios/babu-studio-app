import { Icon } from "@/components/common/Icon";
import type { LayerSidebarProps } from "@/features/studio/components/sidebar.types";
import { LayerAddMenu } from "./LayerAddMenu";
import { LayerRow } from "./LayerRow";
import { LayerSettingsPanel } from "./LayerSettingsPanel";

export function LayerList({ layers, isRecordingActive }: { layers: LayerSidebarProps; isRecordingActive: boolean }) {
  const {
    currentScene,
    currentLayers,
    settingsLayerId,
    draggedLayerId,
    setDraggedLayerId,
    dragOverLayerId,
    setDragOverLayerId,
    reorderLayer,
  } = layers;

  return (
    <section className="inspector-section">
      <div className="section-title">
        <Icon name="layers" />
        <h3>Layers</h3>
        <span className="section-count">{currentLayers.filter((layer) => layer.enabled).length}</span>
        <LayerAddMenu {...layers} isRecordingActive={isRecordingActive} />
      </div>
      <div className="layer-list">
        {currentScene ? currentLayers.map((layer) => {
          const dragged = draggedLayerId === layer.id;
          const dragTarget = dragOverLayerId === layer.id;
          return (
            <div className="layer-entry" key={layer.id}>
              <div
                className={`layer-item${dragged ? " layer-item--dragging" : ""}${dragTarget ? " layer-item--drop-target" : ""}`}
                onDragOver={(event) => {
                  if (draggedLayerId && draggedLayerId !== layer.id) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDragOverLayerId(layer.id);
                  }
                }}
                onDragLeave={(event) => {
                  const relatedTarget = event.relatedTarget;
                  if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) {
                    setDragOverLayerId(null);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceLayerId = event.dataTransfer.getData("text/plain") || draggedLayerId;
                  if (sourceLayerId) {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    reorderLayer(currentScene.id, sourceLayerId, layer.id, event.clientY < bounds.top + bounds.height / 2);
                  }
                  setDraggedLayerId(null);
                  setDragOverLayerId(null);
                }}
              >
                <LayerRow
                  {...layers}
                  layer={layer}
                  settingsOpen={settingsLayerId === layer.id}
                  isRecordingActive={isRecordingActive}
                />
              </div>
              {settingsLayerId === layer.id && (
                <LayerSettingsPanel
                  {...layers}
                  layer={layer}
                  sceneId={currentScene.id}
                  isRecordingActive={isRecordingActive}
                />
              )}
            </div>
          );
        }) : (
          <p className="layer-empty-state">Select a scene to manage its layers.</p>
        )}
      </div>
    </section>
  );
}
