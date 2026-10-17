import { useRef, useState, type RefObject } from "react";
import { useDismissOnOutside } from "@/hooks/useDismissOnOutside";
import { usePopupPosition } from "@/hooks/usePopupPosition";
import type { LayerId } from "@/features/studio/types/studio.types";

export function useLayerPanel(inspectorRef: RefObject<HTMLElement | null>) {
  const [settingsLayerId, setSettingsLayerId] = useState<LayerId | null>(null);
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const [draggedLayerId, setDraggedLayerId] = useState<LayerId | null>(null);
  const [dragOverLayerId, setDragOverLayerId] = useState<LayerId | null>(null);
  const layerMenuRef = useRef<HTMLDivElement>(null);
  const layerMenuButtonRef = useRef<HTMLButtonElement>(null);
  const layerMenuPopupRef = useRef<HTMLDivElement>(null);
  const layerSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const layerSettingsRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside(
    layerMenuOpen,
    (target) => Boolean(layerMenuRef.current?.contains(target) || layerMenuPopupRef.current?.contains(target)),
    () => setLayerMenuOpen(false),
  );
  useDismissOnOutside(
    Boolean(settingsLayerId),
    (target) => Boolean(
      layerSettingsRef.current?.contains(target)
      || (target instanceof Element && target.closest(".layer-settings-trigger")),
    ),
    () => setSettingsLayerId(null),
  );

  const layerMenuPosition = usePopupPosition(layerMenuOpen, inspectorRef, layerMenuButtonRef, layerMenuPopupRef);
  const layerSettingsPosition = usePopupPosition(
    Boolean(settingsLayerId),
    inspectorRef,
    layerSettingsButtonRef,
    layerSettingsRef,
    settingsLayerId,
  );

  return {
    settingsLayerId,
    setSettingsLayerId,
    layerMenuOpen,
    setLayerMenuOpen,
    draggedLayerId,
    setDraggedLayerId,
    dragOverLayerId,
    setDragOverLayerId,
    layerMenuRef,
    layerMenuButtonRef,
    layerMenuPopupRef,
    layerMenuPosition,
    layerSettingsButtonRef,
    layerSettingsRef,
    layerSettingsPosition,
  };
}
