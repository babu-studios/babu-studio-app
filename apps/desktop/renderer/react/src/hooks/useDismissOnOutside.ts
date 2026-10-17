import { useEffect, useRef } from "react";

export function useDismissOnOutside(
  active: boolean,
  isInside: (target: Node) => boolean,
  onDismiss: () => void,
): void {
  const latest = useRef({ isInside, onDismiss });
  latest.current = { isInside, onDismiss };

  useEffect(() => {
    if (!active) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      if (event.target instanceof Node && !latest.current.isInside(event.target)) {
        latest.current.onDismiss();
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        latest.current.onDismiss();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [active]);
}
