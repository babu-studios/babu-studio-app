import { Icon } from "@/components/common/Icon";
import { IconButton } from "@/components/common/IconButton";
import type { LayerSidebarProps } from "@/features/studio/components/sidebar.types";
import type { StudioLayer } from "@/features/studio/types/studio.types";

type LayerRowProps = Pick<
  LayerSidebarProps,
  | "setSettingsLayerId"
  | "setDraggedLayerId"
  | "setDragOverLayerId"
  | "layerSettingsButtonRef"
  | "toggleLayer"
  | "deleteLayer"
> & {
  layer: StudioLayer;
  settingsOpen: boolean;
  isRecordingActive: boolean;
};

export function LayerRow({
  layer,
  settingsOpen,
  isRecordingActive,
  setSettingsLayerId,
  setDraggedLayerId,
  setDragOverLayerId,
  layerSettingsButtonRef,
  toggleLayer,
  deleteLayer,
}: LayerRowProps) {
  const enabled = layer.enabled;
  return (
    <>
      <div
        className={`layer-row${enabled ? "" : " layer-row--muted"}`}
        draggable={!isRecordingActive}
        title="Drag to reorder layers. Top layers appear in front."
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", layer.id);
          setDraggedLayerId(layer.id);
        }}
        onDragEnd={() => {
          setDraggedLayerId(null);
          setDragOverLayerId(null);
        }}
      >
        <Icon name={layer.icon} />
        <span className="layer-name">{layer.name}</span>
      </div>
      <IconButton
        tone={enabled ? "default" : "alert"}
        disabled={isRecordingActive}
        onClick={() => toggleLayer(layer.id)}
        role="switch"
        aria-label={layer.name}
        aria-checked={enabled}
        title={`${enabled ? "Disable" : "Enable"} ${layer.name}`}
      >
        <Icon name={enabled ? "eye" : "eye-off"} />
      </IconButton>
      <IconButton
        className="layer-settings-trigger"
        active={settingsOpen}
        title={`Settings for ${layer.name}`}
        aria-label={`Settings for ${layer.name}`}
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        disabled={isRecordingActive}
        onClick={(event) => {
          if (settingsOpen) {
            setSettingsLayerId(null);
            return;
          }
          layerSettingsButtonRef.current = event.currentTarget;
          setSettingsLayerId(layer.id);
        }}
      >
        <Icon name="settings" />
      </IconButton>
      <IconButton
        tone="danger"
        title={`Delete ${layer.name}`}
        aria-label={`Delete layer ${layer.name}`}
        disabled={isRecordingActive}
        onClick={() => deleteLayer(layer.id)}
      >
        <Icon name="trash" />
      </IconButton>
    </>
  );
}
