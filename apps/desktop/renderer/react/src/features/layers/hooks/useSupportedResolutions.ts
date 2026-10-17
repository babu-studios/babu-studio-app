import { useEffect, useState } from "react";
import type { CaptureResolutionId } from "@/features/studio/types/studio.types";
import { readDeviceMaxSize, supportedResolutionIds } from "../utils/device-capabilities";

/** Resolutions the selected device reports it can capture, or null while unknown. */
export function useSupportedResolutions(deviceId: string, enabled: boolean): CaptureResolutionId[] | null {
  const [supported, setSupported] = useState<{ deviceId: string; ids: CaptureResolutionId[] } | null>(null);

  useEffect(() => {
    if (!deviceId || !enabled) {
      return undefined;
    }
    let cancelled = false;
    void readDeviceMaxSize(deviceId).then((max) => {
      if (!cancelled && max) {
        const ids = supportedResolutionIds(max);
        setSupported(ids.length > 0 ? { deviceId, ids } : null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [deviceId, enabled]);

  return supported && supported.deviceId === deviceId ? supported.ids : null;
}
