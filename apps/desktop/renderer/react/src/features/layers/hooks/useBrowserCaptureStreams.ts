import { useEffect, useRef, useState } from "react";
import type { LayerId } from "@/features/studio/types/studio.types";

export function useBrowserCaptureStreams() {
  const [browserCaptureStreams, setBrowserCaptureStreams] = useState<Record<LayerId, MediaStream>>({});
  const browserCaptureStreamsRef = useRef<Record<LayerId, MediaStream>>({});
  useEffect(() => () => {
    Object.values(browserCaptureStreamsRef.current).forEach((stream) => {
      stream.getTracks().forEach((track) => track.stop());
    });
  }, []);

  function stopBrowserCaptureStream(layerId: LayerId): void {
    browserCaptureStreamsRef.current[layerId]?.getTracks().forEach((track) => track.stop());
  }

  function setBrowserCaptureStream(layerId: LayerId, stream: MediaStream | null): void {
    const previousStream = browserCaptureStreamsRef.current[layerId];
    if (previousStream && previousStream !== stream) {
      previousStream.getTracks().forEach((track) => track.stop());
    }
    const nextStreams = { ...browserCaptureStreamsRef.current };
    if (stream) {
      nextStreams[layerId] = stream;
    } else {
      delete nextStreams[layerId];
    }
    browserCaptureStreamsRef.current = nextStreams;
    setBrowserCaptureStreams(nextStreams);
  }

  return { browserCaptureStreams, setBrowserCaptureStream, stopBrowserCaptureStream };
}
