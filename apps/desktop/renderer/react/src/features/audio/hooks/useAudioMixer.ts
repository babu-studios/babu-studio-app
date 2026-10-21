import { useRef, useState, type RefObject } from "react";
import { DEFAULT_NOISE_REDUCTION } from "@shared/constants/media.constants";
import { useDismissOnOutside } from "@/hooks/useDismissOnOutside";
import { usePopupPosition } from "@/hooks/usePopupPosition";
import type { useStudioConfiguration } from "@/features/studio/hooks/useStudioConfiguration";
import type { AudioTrack } from "@/features/studio/types/studio.types";
import { useAudioDevices } from "./useAudioDevices";
import { useAudioMonitor } from "./useAudioMonitor";

type StudioConfiguration = ReturnType<typeof useStudioConfiguration>;

type UseAudioMixerOptions = {
  config: StudioConfiguration;
  inspectorRef: RefObject<HTMLElement | null>;
  isRecordingActive: boolean;
};

export function useAudioMixer({ config, inspectorRef, isRecordingActive }: UseAudioMixerOptions) {
  const {
    selectedAudioInputId,
    setSelectedAudioInputId,
    audioMonitoringEnabled,
    setAudioMonitoringEnabled,
    audioTracks,
    setAudioTracks,
    audioTrackInputIds,
    setAudioTrackInputIds,
    audioTrackOutputIds,
    setAudioTrackOutputIds,
  } = config;
  const devices = useAudioDevices();
  const {
    audioInputDevices,
    audioInputLoading,
    audioInputError,
    audioOutputDevices,
    discoverAudioInputs,
    setAudioInputDevices,
    setAudioInputLoading,
    setAudioInputError,
  } = devices;
  const [audioReloadToken, setAudioReloadToken] = useState(0);
  const [audioSettingsOpen, setAudioSettingsOpen] = useState(false);
  const [audioSettingsTrackId, setAudioSettingsTrackId] = useState("mic");
  const [audioAddMenuOpen, setAudioAddMenuOpen] = useState(false);
  const audioAddMenuRef = useRef<HTMLDivElement>(null);
  const audioAddMenuButtonRef = useRef<HTMLButtonElement>(null);
  const audioAddMenuPopupRef = useRef<HTMLDivElement>(null);
  const audioSettingsRef = useRef<HTMLDivElement>(null);
  const audioSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const audioSettingsPopupRef = useRef<HTMLDivElement>(null);

  const { audioMeterLevels } = useAudioMonitor({
    audioReloadToken,
    audioMonitoringEnabled,
    selectedAudioInputId,
    audioTracks,
    audioTrackInputIds,
    audioTrackOutputIds,
    setAudioInputError,
  });

  useDismissOnOutside(
    audioSettingsOpen,
    (target) => Boolean(audioSettingsRef.current?.contains(target) || audioSettingsPopupRef.current?.contains(target)),
    () => setAudioSettingsOpen(false),
  );
  useDismissOnOutside(
    audioAddMenuOpen,
    (target) => Boolean(audioAddMenuRef.current?.contains(target) || audioAddMenuPopupRef.current?.contains(target)),
    () => setAudioAddMenuOpen(false),
  );
  const audioSettingsPosition = usePopupPosition(
    audioSettingsOpen,
    inspectorRef,
    audioSettingsButtonRef,
    audioSettingsPopupRef,
    audioSettingsTrackId,
  );
  const audioAddMenuPosition = usePopupPosition(
    audioAddMenuOpen,
    inspectorRef,
    audioAddMenuButtonRef,
    audioAddMenuPopupRef,
  );

  function updateAudioTrack(trackId: string, update: Partial<AudioTrack>): void {
    setAudioTracks((tracks) => tracks.map((track) => (
      track.id === trackId ? { ...track, ...update } : track
    )));
  }

  function addAudioSourceTrack(id: string, name: string): void {
    setAudioTracks((tracks) => (
      tracks.some((track) => track.id === id)
        ? tracks
        : [...tracks, { id, name, icon: "audio", volume: 100, noiseReduction: DEFAULT_NOISE_REDUCTION, muted: false }]
    ));
    setAudioAddMenuOpen(false);
  }

  function removeAudioTrack(trackId: string): void {
    if (audioSettingsOpen && audioSettingsTrackId === trackId) {
      setAudioSettingsOpen(false);
    }
    setAudioTracks((tracks) => tracks.filter((track) => track.id !== trackId));
    setAudioTrackOutputIds((ids) => {
      const { [trackId]: _removedOutput, ...rest } = ids;
      return rest;
    });
    setAudioTrackInputIds((ids) => {
      const { [trackId]: _removed, ...rest } = ids;
      return rest;
    });
  }


  async function toggleAudioSettings(trackId: string): Promise<void> {
    if (audioSettingsOpen && audioSettingsTrackId === trackId) {
      setAudioSettingsOpen(false);
      return;
    }
    setAudioSettingsTrackId(trackId);
    setAudioSettingsOpen(true);
    setAudioInputLoading(true);
    setAudioInputError(null);

    try {
      await discoverAudioInputs();
      if (trackId === "mic") {
        setAudioMonitoringEnabled(true);
      }
    } catch (error) {
      console.error("Unable to enumerate microphone input devices:", error);
      const message = error instanceof Error ? error.message : String(error);
      setAudioInputError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow Babu Studio under System Settings > Privacy & Security > Microphone, then reopen these settings."
          : message,
      );
      setAudioInputDevices([]);
    } finally {
      setAudioInputLoading(false);
    }
  }


  function reloadAudioMixer(): void {
    setAudioMonitoringEnabled(true);
    setAudioReloadToken((token) => token + 1);
  }


  const audioProps = {
    audioInputDevices,
    audioInputError,
    selectedAudioInputId,
    setSelectedAudioInputId,
    audioMeterLevels,
    audioTracks,
    audioSettingsOpen,
    audioSettingsTrackId,
    setAudioTrackInputIds,
    audioTrackInputIds,
    audioOutputDevices,
    setAudioTrackOutputIds,
    audioTrackOutputIds,
    audioSettingsPosition,
    audioAddMenuOpen,
    setAudioAddMenuOpen,
    audioAddMenuPosition,
    audioAddMenuRef,
    audioAddMenuButtonRef,
    audioAddMenuPopupRef,
    audioSettingsRef,
    audioSettingsButtonRef,
    audioSettingsPopupRef,
    showAudioInputLoading: audioInputLoading && !isRecordingActive,
    updateAudioTrack,
    addAudioSourceTrack,
    removeAudioTrack,
    toggleAudioSettings,
  };

  return { audioProps, reloadAudioMixer, discoverAudioInputs };
}
