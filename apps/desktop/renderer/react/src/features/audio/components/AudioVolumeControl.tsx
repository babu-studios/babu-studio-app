import { MAX_AUDIO_VOLUME_PERCENT } from "@shared/constants/media.constants";
import type { AudioTrack } from "@/features/studio/types/studio.types";

type AudioVolumeControlProps = {
  track: AudioTrack;
  disabled: boolean;
  onChange: (volume: number) => void;
};

export function AudioVolumeControl({ track, disabled, onChange }: AudioVolumeControlProps) {
  const inputId = `audio-volume-${track.id}`;
  const fill = (track.volume / MAX_AUDIO_VOLUME_PERCENT) * 100;
  return (
    <div className="audio-controls">
      <label className="audio-control-label" htmlFor={inputId}>Volume</label>
      <input
        id={inputId}
        type="range"
        min="0"
        max={MAX_AUDIO_VOLUME_PERCENT}
        value={track.volume}
        disabled={disabled}
        aria-label={`${track.name} volume`}
        aria-valuetext={`${track.volume}%`}
        title="100% matches the recorded level. Above 100% boosts it in the export."
        onChange={(event) => onChange(Number(event.target.value))}
        style={{
          background: [
            // Tick marking unity gain at the middle of the range.
            "linear-gradient(to right, transparent calc(50% - 1px), rgba(233,238,241,0.55) calc(50% - 1px), rgba(233,238,241,0.55) calc(50% + 1px), transparent calc(50% + 1px))",
            `linear-gradient(to right, #92e6c6 ${fill}%, #30353c ${fill}%)`,
          ].join(", "),
        }}
      />
      <output className="volume-value" htmlFor={inputId}>{track.volume}%</output>
    </div>
  );
}
