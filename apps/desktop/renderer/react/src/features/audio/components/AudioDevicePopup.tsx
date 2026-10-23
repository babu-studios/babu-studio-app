import { createPortal } from "react-dom";
import {
  isNoiseReductionLevel,
  NOISE_REDUCTION_LABELS,
  NOISE_REDUCTION_LEVELS,
} from "@shared/constants/media.constants";
import { Dropdown } from "@/components/common/Dropdown";
import type { AudioSidebarProps } from "@/features/studio/components/sidebar.types";
import type { AudioTrack } from "@/features/studio/types/studio.types";

type AudioDevicePopupProps = Pick<
  AudioSidebarProps,
  | "audioInputDevices"
  | "audioInputError"
  | "selectedAudioInputId"
  | "setSelectedAudioInputId"
  | "audioTrackInputIds"
  | "setAudioTrackInputIds"
  | "audioOutputDevices"
  | "audioTrackOutputIds"
  | "setAudioTrackOutputIds"
  | "audioSettingsPosition"
  | "audioSettingsPopupRef"
  | "showAudioInputLoading"
  | "updateAudioTrack"
> & {
  track: AudioTrack;
  isRecordingActive: boolean;
};

export function AudioDevicePopup({
  track,
  isRecordingActive,
  audioInputDevices,
  audioInputError,
  selectedAudioInputId,
  setSelectedAudioInputId,
  audioTrackInputIds,
  setAudioTrackInputIds,
  audioOutputDevices,
  audioTrackOutputIds,
  setAudioTrackOutputIds,
  audioSettingsPosition,
  audioSettingsPopupRef,
  showAudioInputLoading,
  updateAudioTrack,
}: AudioDevicePopupProps) {
  const trackInputId = track.id === "mic" ? selectedAudioInputId : audioTrackInputIds[track.id] ?? "";
  const inputUnavailable = trackInputId !== "" && !audioInputDevices.some((device) => device.id === trackInputId);

  return createPortal(
    <div
      className="audio-device-popup"
      ref={audioSettingsPopupRef}
      role="dialog"
      aria-label={`${track.name} settings`}
      style={{
        left: audioSettingsPosition?.left ?? 0,
        top: audioSettingsPosition?.top ?? 0,
        visibility: audioSettingsPosition ? "visible" : "hidden",
      }}
    >
      <div className="audio-device-popup-heading">{track.name}</div>
      <label className="audio-device-select">
        <span>Input device</span>
        <Dropdown
          loading={showAudioInputLoading}
          loadingLabel="Loading microphone inputs"
          value={showAudioInputLoading ? "" : trackInputId}
          onChange={(event) => {
            const value = event.target.value;
            if (track.id === "mic") {
              setSelectedAudioInputId(value);
            } else {
              setAudioTrackInputIds((ids) => ({ ...ids, [track.id]: value }));
            }
          }}
          disabled={isRecordingActive || audioInputDevices.length === 0}
          aria-label={`${track.name} input device`}
        >
          <option value="">Select input device</option>
          {!showAudioInputLoading && inputUnavailable && (
            <option value={trackInputId}>Previously selected device unavailable</option>
          )}
          {!showAudioInputLoading && audioInputDevices.map((device) => (
            <option key={device.id} value={device.id}>{device.name}</option>
          ))}
        </Dropdown>
      </label>
      {track.id === "capture-card" && (
        <label className="audio-device-select">
          <span>Output device</span>
          <Dropdown
            loading={showAudioInputLoading}
            disabled={isRecordingActive}
            loadingLabel="Loading output devices"
            value={showAudioInputLoading ? "" : audioTrackOutputIds[track.id] ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              setAudioTrackOutputIds((ids) => ({ ...ids, [track.id]: value }));
            }}
            aria-label={`${track.name} output device`}
          >
            <option value="">Select output device</option>
            {!showAudioInputLoading && audioOutputDevices.map((device) => (
              <option key={device.id} value={device.id}>{device.name}</option>
            ))}
          </Dropdown>
        </label>
      )}
      {track.id === "mic" && (
        <>
          <label className="audio-device-select">
            <span>Noise reduction</span>
            <Dropdown
              disabled={isRecordingActive}
              value={track.noiseReduction}
              onChange={(event) => {
                const value = event.target.value;
                if (isNoiseReductionLevel(value)) {
                  updateAudioTrack(track.id, { noiseReduction: value });
                }
              }}
              aria-label={`${track.name} noise reduction`}
            >
              {NOISE_REDUCTION_LEVELS.map((level) => (
                <option key={level} value={level}>{NOISE_REDUCTION_LABELS[level]}</option>
              ))}
            </Dropdown>
          </label>
          <p className="audio-device-hint">
            Removes background hiss and rumble from the exported microphone track.
          </p>
        </>
      )}
      {audioInputError && <p className="audio-device-error" role="alert">{audioInputError}</p>}
    </div>,
    document.body,
  );
}
