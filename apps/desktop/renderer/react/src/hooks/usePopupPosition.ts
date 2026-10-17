import { useLayoutEffect, useState, type RefObject } from "react";
import type { PopupPosition } from "@/features/studio/types/studio.types";
import { getSidebarPopupPosition } from "@/features/studio/utils/popup";

export function usePopupPosition(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  anchorRef: RefObject<HTMLElement | null>,
  popupRef: RefObject<HTMLElement | null>,
  extraDependency?: unknown,
): PopupPosition | null {
  const [position, setPosition] = useState<PopupPosition | null>(null);

  useLayoutEffect(() => {
    if (!active) {
      setPosition(null);
      return;
    }

    function update(): void {
      const next = getSidebarPopupPosition(containerRef.current, anchorRef.current, popupRef.current);
      if (next) {
        setPosition(next);
      }
    }

    update();
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [active, extraDependency]);

  return position;
}
