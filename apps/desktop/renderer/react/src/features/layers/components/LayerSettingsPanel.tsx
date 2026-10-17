import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Dropdown } from "@/components/common/Dropdown";
import { CAPTURE_RESOLUTIONS, DEVICE_OPTIONS, LAYER_SOURCE_LABELS } from "@/features/studio/constants/layers";
import type { LayerSidebarProps } from "@/features/studio/components/sidebar.types";
import type { StudioLayer } from "@/features/studio/types/studio.types";
import { isCaptureResolutionId } from "@/features/studio/utils/guards";
import { useSupportedResolutions } from "../hooks/useSupportedResolutions";
import { LayerCropControls } from "./LayerCropControls";

type LayerSettingsPanelProps = Pick<
  LayerSidebarProps,
  | "videoInputDevices"
  | "videoInputLoading"
  | "videoInputError"
  | "layerSettingsPosition"
  | "layerSettingsRef"
  | "updateLayer"
  | "changeVideoInputDevice"
  | "changeLayerCaptureResolution"
> & {
  layer: StudioLayer;
  sceneId: string;
  isRecordingActive: boolean;
};

export function LayerSettingsPanel({
  layer,
  sceneId,
  isRecordingActive,
  videoInputDevices,
  videoInputLoading,
  videoInputError,
  layerSettingsPosition,
  layerSettingsRef,
  updateLayer,
  changeVideoInputDevice,
  changeLayerCaptureResolution,
}: LayerSettingsPanelProps) {
  const isVideoSource = layer.kind === "camera-device" || layer.kind === "game-capture";
  const deviceListLoading = isVideoSource && videoInputLoading && !isRecordingActive;
  const emptyOptionLabel = !isVideoSource
    ? "Select a device"
    : videoInputLoading ? "Device" : videoInputDevices.length ? "Select a video input" : "No video inputs found";
  const supportedIds = useSupportedResolutions(layer.deviceId, isVideoSource && !isRecordingActive);
  const resolutionOptions = supportedIds
    ? CAPTURE_RESOLUTIONS.filter((resolution) => supportedIds.includes(resolution.id))
    : CAPTURE_RESOLUTIONS;

  // Move off a resolution the device cannot capture to the best one it supports.
  useEffect(() => {
    if (!supportedIds || supportedIds.includes(layer.captureResolution) || isRecordingActive) {
      return;
    }
    const best = resolutionOptions[resolutionOptions.length - 1];
    if (best) {
      void changeLayerCaptureResolution(sceneId, layer, best.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportedIds, layer.captureResolution, layer.deviceId]);

  const deviceOptions = isVideoSource ? videoInputDevices : DEVICE_OPTIONS[layer.kind];

  return createPortal(
    <div
      className="layer-settings-panel"
      ref={layerSettingsRef}
      role="dialog"
      aria-label={`${layer.name} settings`}
      style={{
        left: layerSettingsPosition?.left ?? 0,
        top: layerSettingsPosition?.top ?? 0,
        visibility: layerSettingsPosition ? "visible" : "hidden",
      }}
    >
      <label className="layer-settings-name">
        <span>Layer name</span>
        <input
          value={layer.name}
          maxLength={12}
          aria-label={`Rename layer ${layer.name}`}
          onChange={(event) => updateLayer(sceneId, layer.id, { name: event.target.value })}
          onBlur={() => updateLayer(sceneId, layer.id, { name: layer.name.trim() || LAYER_SOURCE_LABELS[layer.kind] })}
        />
      </label>
      <label className="layer-device-select">
        <span>Device</span>
        <Dropdown
          loading={deviceListLoading}
          disabled={isRecordingActive}
          loadingLabel="Loading device list"
          value={deviceListLoading ? "" : layer.deviceId}
          aria-label={`Device for ${layer.name}`}
          onChange={(event) => {
            if (layer.kind === "camera-device" || layer.kind === "game-capture") {
              void changeVideoInputDevice(sceneId, layer.id, layer.kind, event.target.value, layer.captureResolution);
            } else {
              updateLayer(sceneId, layer.id, { deviceId: event.target.value });
            }
          }}
        >
          <option value="">{emptyOptionLabel}</option>
          {deviceOptions.map((device) => (
            <option key={device.id} value={device.id}>{device.name}</option>
          ))}
        </Dropdown>
      </label>
      {isVideoSource && (
        <label className="layer-device-select">
          <span>Resolution (Preview &amp; Record)</span>
          <Dropdown
            value={layer.captureResolution}
            disabled={isRecordingActive}
            aria-label={`Resolution for ${layer.name}`}
            onChange={(event) => {
              if (isCaptureResolutionId(event.target.value)) {
                void changeLayerCaptureResolution(sceneId, layer, event.target.value);
              }
            }}
          >
            {resolutionOptions.map((resolution) => (
              <option key={resolution.id} value={resolution.id}>
                {resolution.label} ({resolution.width} × {resolution.height})
              </option>
            ))}
          </Dropdown>
        </label>
      )}
      {isVideoSource && (
        <LayerCropControls layer={layer} onChange={(crop) => updateLayer(sceneId, layer.id, { crop })} />
      )}
      {isVideoSource && videoInputError && (
        <span className="layer-device-error" role="alert">{videoInputError}</span>
      )}
    </div>,
    document.body,
    layer.id,
  );
}
