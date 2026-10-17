import type { AudioTrack } from "@/features/studio/types/studio.types";

type AudioVolumeControlProps = {
  track: AudioTrack;
  disabled: boolean;
  onChange: (volume: number) => void;
};

export function AudioVolumeControl({ track, disabled, onChange }: AudioVolumeControlProps) {
  const inputId = `audio-volume-${track.id}`;
  return (
    <div className="audio-controls">
      <label className="audio-control-label" htmlFor={inputId}>Volume</label>
      <input
        id={inputId}
        type="range"
        min="0"
        max="100"
        value={track.volume}
        disabled={disabled}
        aria-label={`${track.name} volume`}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ background: `linear-gradient(to right, #92e6c6 ${track.volume}%, #30353c ${track.volume}%)` }}
      />
      <output className="volume-value" htmlFor={inputId}>{track.volume}%</output>
    </div>
  );
}
