import { DEFAULT_NOISE_REDUCTION, MAX_AUDIO_GAIN } from "@shared/constants/media.constants";
import { getCaptureResolution } from "@/features/studio/utils/crop";
import { findAudioDeviceByName, findBuiltInMicrophone, isSupportedCaptureCard, normalizeAudioDeviceName } from "@/features/studio/utils/devices";
import type { useStudioConfiguration } from "@/features/studio/hooks/useStudioConfiguration";
import type { RecordingScene } from "@shared/types/media";
import type { Scene, StudioLayer, DeviceOption } from "@/features/studio/types/studio.types";
import type { RecordingState } from "./useRecordingState";
import { resolveRecordingSources } from "../utils/recording-sources";

type RecordingSessionOptions = {
  state: RecordingState;
  config: ReturnType<typeof useStudioConfiguration>;
  currentScene: Scene | null;
  currentLayers: StudioLayer[];
  videoInputDevices: DeviceOption[];
  discoverAudioInputs: () => Promise<DeviceOption[]>;
};

export function useRecordingSession({
  state,
  config,
  currentScene,
  currentLayers,
  videoInputDevices,
  discoverAudioInputs,
}: RecordingSessionOptions) {
  const {
    recordingActive: isRecordingActive,
    recordingBusy,
    setRecordingActive,
    setRecordingBusy,
    setRecordingNotice,
    setRecordingElapsedMs,
    setPostProcessingState,
    setRecordingExports,
    setExportDialogOpen,
    exportCancelRequestedRef,
    recordingStartedAtRef,
    recordingActionInFlightRef,
  } = state;
  const {
    exportModes,
    exportResolution,
    audioTracks,
    setAudioTracks,
    audioTrackInputIds,
    setAudioTrackInputIds,
    selectedAudioInputId,
    setSelectedAudioInputId,
  } = config;

  async function startRecording(): Promise<void> {
    if (recordingActionInFlightRef.current || recordingBusy || isRecordingActive) {
      return;
    }
    const resolved = resolveRecordingSources(currentScene, currentLayers, videoInputDevices, exportModes);
    if ("error" in resolved || !currentScene) {
      setRecordingNotice({ error: true, text: "error" in resolved ? resolved.error : "Create or select a shared scene before starting a recording." });
      return;
    }
    const { captureLayers: selectedCaptureLayers, captureNames, cameraNames } = resolved.sources;

    const trackVolume = (id: string) => {
      const track = audioTracks.find((item) => item.id === id);
      return track && !track.muted
        ? Math.max(0, Math.min(MAX_AUDIO_GAIN, track.volume / 100))
        : 0;
    };
    const recordingScene: RecordingScene = {
      scene: currentScene,
      layers: currentLayers,
    };
    const captureSize = selectedCaptureLayers
      .map((layer) => getCaptureResolution(layer.captureResolution))
      .sort((first, second) => second.width * second.height - first.width * first.height)[0];
    const micTrack = audioTracks.find((item) => item.id === "mic");
    recordingActionInFlightRef.current = true;
    setRecordingBusy(true);
    setRecordingNotice(null);
    setPostProcessingState("NOT_STARTED");
    setRecordingExports([]);
    setExportDialogOpen(false);
    try {
      const audioInputs = await discoverAudioInputs();
      const gameAudioDevice = (captureNames[0] ? findAudioDeviceByName(captureNames[0], audioInputs) : undefined)
        ?? audioInputs.find((device) => device.id === audioTrackInputIds["capture-card"]);
      if (captureNames.length > 0 && !gameAudioDevice) {
        throw new Error(`No audio input matching ${captureNames[0]} was found. Select the Elgato input in the Capture card audio settings and try again.`);
      }

      const selectedMicDevice = audioInputs.find((device) => device.id === selectedAudioInputId);
      const preferredMicDevice = findBuiltInMicrophone(
        audioInputs.filter((device) => device.id !== gameAudioDevice?.id),
      );
      const micDevice = selectedMicDevice
        && selectedMicDevice.id !== gameAudioDevice?.id
        && normalizeAudioDeviceName(selectedMicDevice.name) !== normalizeAudioDeviceName(gameAudioDevice?.name ?? "")
        ? selectedMicDevice
        : preferredMicDevice;
      if (micTrack && !micTrack.muted && !micDevice) {
        throw new Error("No MacBook Air microphone input was found. Select the built-in microphone in Microphone settings and try again.");
      }
      if (micDevice && micDevice.id !== selectedAudioInputId) {
        setSelectedAudioInputId(micDevice.id);
      }
      if (gameAudioDevice && gameAudioDevice.id !== audioTrackInputIds["capture-card"]) {
        setAudioTrackInputIds((ids) => ({ ...ids, "capture-card": gameAudioDevice.id }));
      }
      if (gameAudioDevice && !audioTracks.some((track) => track.id === "capture-card")) {
        setAudioTracks((tracks) => (
          tracks.some((track) => track.id === "capture-card")
            ? tracks
            : [...tracks, { id: "capture-card", name: "Capture card", icon: "audio", volume: 100, noiseReduction: DEFAULT_NOISE_REDUCTION, muted: false }]
        ));
      }

      const result = await window.babuStudio.startRecording({
        captureCard: captureNames[0],
        camera: cameraNames[0],
        gameAudio: gameAudioDevice?.name,
        microphone: micTrack && !micTrack.muted ? micDevice?.name : undefined,
        microphoneEnabled: Boolean(micTrack && !micTrack.muted),
        captureWidth: captureSize?.width,
        captureHeight: captureSize?.height,
        captureExactSize: videoInputDevices.some((device) => device.name === captureNames[0] && isSupportedCaptureCard(device)),
        mode: "HORIZONTAL",
        exportModes,
        exportResolution,
        fps: 60,
        gameVolume: gameAudioDevice
          ? audioTracks.some((track) => track.id === "capture-card") ? trackVolume("capture-card") : 1
          : 0,
        microphoneVolume: trackVolume("mic"),
        noiseReduction: micTrack?.noiseReduction ?? DEFAULT_NOISE_REDUCTION,
        scene: recordingScene,
      });
      if (result.success) {
        recordingStartedAtRef.current = performance.now();
        setRecordingElapsedMs(0);
        setRecordingActive(true);
      } else {
        setRecordingNotice({ error: true, text: result.error ?? "Recording could not start." });
      }
    } catch (error) {
      setRecordingNotice({ error: true, text: error instanceof Error ? error.message : "Recording could not start." });
    } finally {
      recordingActionInFlightRef.current = false;
      setRecordingBusy(false);
    }
  }

  async function stopRecording(): Promise<void> {
    if (recordingActionInFlightRef.current || recordingBusy || !isRecordingActive) {
      return;
    }
    exportCancelRequestedRef.current = false;
    const startedAt = recordingStartedAtRef.current;
    if (startedAt !== null) {
      setRecordingElapsedMs(performance.now() - startedAt);
    }
    recordingStartedAtRef.current = null;
    recordingActionInFlightRef.current = true;
    setRecordingBusy(true);
    try {
      const result = await window.babuStudio.stopRecording();
      setPostProcessingState(result.postProcessingState ?? "NOT_STARTED");
      setRecordingExports(result.exports ?? []);
      setRecordingNotice(
        result.success
          ? {
            error: false,
            text: `Saved ${(result.durationMs / 1000).toFixed(1)}s, ${(result.fileSizeBytes / 1048576).toFixed(1)} MB. Use Export to render it.`,
          }
          : { error: true, text: result.error ?? "Recording failed." },
      );
    } catch (error) {
      setRecordingNotice({ error: true, text: error instanceof Error ? error.message : "Recording failed." });
    } finally {
      setRecordingActive(false);
      recordingActionInFlightRef.current = false;
      setRecordingBusy(false);
    }
  }


  return { startRecording, stopRecording };
}
