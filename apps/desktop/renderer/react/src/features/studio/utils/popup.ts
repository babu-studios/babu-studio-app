import type { PopupPosition } from "@/features/studio/types/studio.types";

export function getSidebarPopupPosition(
  sidebar: HTMLElement | null,
  anchor: HTMLElement | null,
  popup: HTMLElement | null,
): PopupPosition | null {
  if (!sidebar || !anchor || !popup) {
    return null;
  }

  const sidebarRect = sidebar.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  const left = Math.max(8, Math.min(sidebarRect.right + 8, window.innerWidth - popupRect.width - 8));
  const maxTop = Math.max(8, window.innerHeight - popupRect.height - 8);
  const top = Math.max(8, Math.min(anchorRect.top, maxTop));
  return { left, top };
}
