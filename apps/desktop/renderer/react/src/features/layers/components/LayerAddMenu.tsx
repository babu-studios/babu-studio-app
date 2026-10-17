import { createPortal } from "react-dom";
import { Icon } from "@/components/common/Icon";
import { LAYER_OPTIONS } from "@/features/studio/constants/layers";
import type { LayerSidebarProps } from "@/features/studio/components/sidebar.types";

type LayerAddMenuProps = Pick<
  LayerSidebarProps,
  | "currentScene"
  | "layerMenuOpen"
  | "setLayerMenuOpen"
  | "layerMenuPosition"
  | "layerMenuRef"
  | "layerMenuButtonRef"
  | "layerMenuPopupRef"
  | "addLayer"
> & { isRecordingActive: boolean };

export function LayerAddMenu({
  currentScene,
  layerMenuOpen,
  setLayerMenuOpen,
  layerMenuPosition,
  layerMenuRef,
  layerMenuButtonRef,
  layerMenuPopupRef,
  addLayer,
  isRecordingActive,
}: LayerAddMenuProps) {
  return (
    <div className="layer-add-wrap" ref={layerMenuRef}>
      <button
        className="text-icon-button"
        title={currentScene ? "Add layer: camera or capture card" : "Select a scene to add layers"}
        aria-label="Add layer"
        aria-haspopup="menu"
        aria-expanded={layerMenuOpen}
        disabled={!currentScene || isRecordingActive}
        ref={layerMenuButtonRef}
        onClick={() => setLayerMenuOpen((open) => !open)}
      >
        <Icon name="plus" />
      </button>
      {layerMenuOpen && createPortal(
        <div
          className="layer-add-menu"
          ref={layerMenuPopupRef}
          role="menu"
          aria-label="Add layer"
          style={{
            left: layerMenuPosition?.left ?? 0,
            top: layerMenuPosition?.top ?? 0,
            visibility: layerMenuPosition ? "visible" : "hidden",
          }}
        >
          {LAYER_OPTIONS.map((option) => (
            <button className="layer-add-option" key={option.kind} role="menuitem" onClick={() => addLayer(option)}>
              <Icon name={option.icon} />
              <span className="layer-add-option-copy">
                <span>{option.name}</span>
                <span className="layer-add-option-description">{option.description}</span>
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
