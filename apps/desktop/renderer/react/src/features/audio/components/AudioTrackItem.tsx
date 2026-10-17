import { Icon } from "@/components/common/Icon";
import { IconButton } from "@/components/common/IconButton";
import type { AudioSidebarProps } from "@/features/studio/components/sidebar.types";
import type { AudioTrack } from "@/features/studio/types/studio.types";
import { AudioDevicePopup } from "./AudioDevicePopup";
import { AudioMeter } from "./AudioMeter";
import { AudioVolumeControl } from "./AudioVolumeControl";

type AudioTrackItemProps = AudioSidebarProps & {
  track: AudioTrack;
  isRecordingActive: boolean;
};

export function AudioTrackItem({ track, isRecordingActive, ...audio }: AudioTrackItemProps) {
  const {
    audioMeterLevels,
    audioSettingsOpen,
    audioSettingsTrackId,
    audioSettingsRef,
    audioSettingsButtonRef,
    updateAudioTrack,
    removeAudioTrack,
    toggleAudioSettings,
  } = audio;
  const isSettingsTrack = track.id === audioSettingsTrackId;
  const settingsOpen = audioSettingsOpen && isSettingsTrack;
  const meterLevel = track.muted ? 0 : Math.round(((audioMeterLevels[track.id] ?? 0) * track.volume) / 100);

  return (
    <div className={`audio-track${track.muted ? " audio-track--muted" : ""}`}>
      <div className="audio-track-heading">
        <span className="audio-track-name">
          <Icon name={track.icon} />
          {track.name}
        </span>
        <div className="audio-track-actions" ref={isSettingsTrack ? audioSettingsRef : undefined}>
          <IconButton
            active={settingsOpen}
            disabled={isRecordingActive}
            onClick={() => void toggleAudioSettings(track.id)}
            ref={isSettingsTrack ? audioSettingsButtonRef : undefined}
            title={`${track.name} settings`}
            aria-label={`${track.name} settings`}
            aria-expanded={settingsOpen}
            aria-haspopup="dialog"
          >
            <Icon name="settings" />
          </IconButton>
          <IconButton
            tone={track.muted ? "alert" : "default"}
            disabled={isRecordingActive}
            onClick={() => updateAudioTrack(track.id, { muted: !track.muted })}
            aria-label={`${track.muted ? "Unmute" : "Mute"} ${track.name}`}
            aria-pressed={track.muted}
          >
            <Icon name={track.muted ? "speaker-muted" : "speaker"} />
          </IconButton>
          {track.id !== "mic" && (
            <IconButton
              tone="danger"
              title={`Remove ${track.name}`}
              aria-label={`Remove ${track.name}`}
              disabled={isRecordingActive}
              onClick={() => removeAudioTrack(track.id)}
            >
              <Icon name="trash" />
            </IconButton>
          )}
        </div>
      </div>
      {settingsOpen && <AudioDevicePopup {...audio} track={track} isRecordingActive={isRecordingActive} />}
      <AudioMeter label={track.name} level={meterLevel} />
      <AudioVolumeControl
        track={track}
        disabled={isRecordingActive}
        onChange={(volume) => updateAudioTrack(track.id, { volume })}
      />
    </div>
  );
}
