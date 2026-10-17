import { Icon } from "@/components/common/Icon";
import type { AudioSidebarProps } from "@/features/studio/components/sidebar.types";
import { AudioAddMenu } from "./AudioAddMenu";
import { AudioTrackItem } from "./AudioTrackItem";

export function AudioMixer({ audio, isRecordingActive }: { audio: AudioSidebarProps; isRecordingActive: boolean }) {
  return (
    <section className="inspector-section audio-section">
      <div className="section-title">
        <Icon name="audio" />
        <h3>Audio mixer</h3>
        <AudioAddMenu {...audio} isRecordingActive={isRecordingActive} />
      </div>
      <div className="audio-track-list">
        {audio.audioTracks.map((track) => (
          <AudioTrackItem key={track.id} {...audio} track={track} isRecordingActive={isRecordingActive} />
        ))}
      </div>
    </section>
  );
}
