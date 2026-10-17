import { createPortal } from "react-dom";
import { Icon } from "@/components/common/Icon";
import { AUDIO_SOURCE_OPTIONS } from "@/features/studio/constants/audio";
import type { AudioSidebarProps } from "@/features/studio/components/sidebar.types";

type AudioAddMenuProps = Pick<
  AudioSidebarProps,
  | "audioTracks"
  | "audioAddMenuOpen"
  | "setAudioAddMenuOpen"
  | "audioAddMenuPosition"
  | "audioAddMenuRef"
  | "audioAddMenuButtonRef"
  | "audioAddMenuPopupRef"
  | "addAudioSourceTrack"
> & { isRecordingActive: boolean };

export function AudioAddMenu({
  audioTracks,
  audioAddMenuOpen,
  setAudioAddMenuOpen,
  audioAddMenuPosition,
  audioAddMenuRef,
  audioAddMenuButtonRef,
  audioAddMenuPopupRef,
  addAudioSourceTrack,
  isRecordingActive,
}: AudioAddMenuProps) {
  return (
    <div className="layer-add-wrap" ref={audioAddMenuRef}>
      <button
        className="text-icon-button"
        title="Add audio source: capture card"
        aria-label="Add audio source"
        aria-haspopup="menu"
        aria-expanded={audioAddMenuOpen}
        type="button"
        ref={audioAddMenuButtonRef}
        disabled={isRecordingActive}
        onClick={() => setAudioAddMenuOpen((open) => !open)}
      >
        <Icon name="plus" />
      </button>
      {audioAddMenuOpen && createPortal(
        <div
          className="layer-add-menu"
          ref={audioAddMenuPopupRef}
          role="menu"
          aria-label="Add audio source"
          style={{
            left: audioAddMenuPosition?.left ?? 0,
            top: audioAddMenuPosition?.top ?? 0,
            visibility: audioAddMenuPosition ? "visible" : "hidden",
          }}
        >
          {AUDIO_SOURCE_OPTIONS.map((option) => (
            <button
              className="layer-add-option"
              key={option.id}
              role="menuitem"
              disabled={audioTracks.some((track) => track.id === option.id)}
              onClick={() => addAudioSourceTrack(option.id, option.name)}
            >
              <Icon name="audio" />
              <span className="layer-add-option-copy">
                <span>{option.name}</span>
                <span className="layer-add-option-description">{option.description}</span>
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
