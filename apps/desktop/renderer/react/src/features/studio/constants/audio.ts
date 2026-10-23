import { DEFAULT_NOISE_REDUCTION } from "@shared/constants/media.constants";
import type { PersistedAudioMixer } from "@/features/studio/types/studio.types";

export const AUDIO_SOURCE_OPTIONS = [
  { id: "capture-card", name: "Capture card", description: "Audio from a capture device" },
] as const;

export const DEFAULT_AUDIO_MIXER: PersistedAudioMixer = {
  tracks: [{ id: "mic", name: "Microphone", icon: "audio", volume: 100, noiseReduction: DEFAULT_NOISE_REDUCTION, muted: false }],
  selectedInputId: "",
  monitoringEnabled: false,
  trackInputIds: {},
  trackOutputIds: {},
};
