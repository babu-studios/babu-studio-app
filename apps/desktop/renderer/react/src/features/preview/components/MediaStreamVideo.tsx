import { useEffect, useRef, useState } from "react";
import type { CaptureResolution, CropInsets, SourceDimensions } from "@/features/studio/types/studio.types";
import { getCroppedVideoStyle, getSourceDimensions } from "@/features/studio/utils/crop";

type MediaStreamVideoProps = {
  stream: MediaStream;
  resolution: CaptureResolution;
  crop: CropInsets;
  onSourceDimensions: (dimensions: SourceDimensions) => void;
};

export function MediaStreamVideo({ stream, resolution, crop, onSourceDimensions }: MediaStreamVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoSize, setVideoSize] = useState({ width: resolution.width, height: resolution.height });

  useEffect(() => {
    const settings = stream.getVideoTracks()[0]?.getSettings();
    setVideoSize({
      width: settings?.width ?? resolution.width,
      height: settings?.height ?? resolution.height,
    });
    const dimensions = getSourceDimensions(stream);
    if (dimensions) {
      onSourceDimensions(dimensions);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
    return () => {
      if (videoRef.current?.srcObject === stream) {
        videoRef.current.srcObject = null;
      }
    };
  }, [stream]);

  return (
    <video
      className="source-preview-video"
      ref={videoRef}
      autoPlay
      muted
      playsInline
      style={getCroppedVideoStyle(crop, videoSize.width, videoSize.height)}
      onLoadedMetadata={(event) => {
        const dimensions = {
          width: event.currentTarget.videoWidth || resolution.width,
          height: event.currentTarget.videoHeight || resolution.height,
        };
        setVideoSize(dimensions);
        onSourceDimensions(dimensions);
      }}
    />
  );
}
