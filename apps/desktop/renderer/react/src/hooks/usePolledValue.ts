import { useEffect, useState } from "react";

export function usePolledValue<T>(
  read: () => Promise<T>,
  intervalMs: number,
  enabled = true,
  errorMessage = "Polling failed:",
): T | null {
  const [value, setValue] = useState<T | null>(null);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await read();
        if (!cancelled) {
          setValue(next);
        }
      } catch (error) {
        console.error(errorMessage, error);
      }
      if (!cancelled) {
        timer = window.setTimeout(poll, intervalMs);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs]);

  return value;
}
