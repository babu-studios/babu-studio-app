import { useEffect, useRef, useState } from "react";
import type { AudioTrack } from "@/features/studio/types/studio.types";

// Chromium exposes AudioContext.setSinkId, but the DOM typings do not cover it yet.
type RoutableAudioContext = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

type RoutedOutput = {
  context: RoutableAudioContext;
  gain: GainNode;
};

type UseAudioMonitorOptions = {
  audioReloadToken: number;
  audioMonitoringEnabled: boolean;
  selectedAudioInputId: string;
  audioTracks: AudioTrack[];
  audioTrackInputIds: Record<string, string>;
  audioTrackOutputIds: Record<string, string>;
  setAudioInputError: (error: string | null) => void;
};

export function useAudioMonitor({
  audioReloadToken,
  audioMonitoringEnabled,
  selectedAudioInputId,
  audioTracks,
  audioTrackInputIds,
  audioTrackOutputIds,
  setAudioInputError,
}: UseAudioMonitorOptions) {
  const [audioMeterLevels, setAudioMeterLevels] = useState<Record<string, number>>({});
  const audioPlaybackRef = useRef<Record<string, HTMLAudioElement>>({});
  const audioStreamsRef = useRef<Record<string, MediaStream>>({});
  const audioRoutedRef = useRef<Record<string, RoutedOutput>>({});
  const audioPlaybackSettingsRef = useRef({ outputIds: audioTrackOutputIds, tracks: audioTracks });
  audioPlaybackSettingsRef.current = { outputIds: audioTrackOutputIds, tracks: audioTracks };

  async function applyAudioPlaybackSettings(trackId: string): Promise<void> {
    const track = audioPlaybackSettingsRef.current.tracks.find((item) => item.id === trackId);
    if (!track) {
      return;
    }
    const outputId = audioPlaybackSettingsRef.current.outputIds[trackId] ?? "";
    const gain = track.muted || !outputId ? 0 : track.volume / 100;

    // Web Audio can exceed unity gain, unlike a media element, so it is the preferred path.
    const routed = audioRoutedRef.current[trackId];
    if (routed) {
      if (routed.context.setSinkId) {
        try {
          if (outputId) {
            await routed.context.setSinkId(outputId);
          }
          routed.gain.gain.value = gain;
          return;
        } catch (error) {
          console.error("Unable to route audio through the Web Audio output:", error);
        }
      }
      routed.gain.disconnect();
      delete audioRoutedRef.current[trackId];
    }

    // Fallback for contexts that cannot pick an output device. Media elements cap at unity gain.
    const stream = audioStreamsRef.current[trackId];
    if (!stream) {
      return;
    }
    let playback = audioPlaybackRef.current[trackId];
    if (!playback) {
      playback = new Audio();
      playback.srcObject = stream;
      audioPlaybackRef.current[trackId] = playback;
      void playback.play().catch((error: unknown) => {
        console.error("Unable to play capture card audio:", error);
      });
    }
    playback.muted = track.muted || !outputId;
    playback.volume = Math.max(0, Math.min(1, track.volume / 100));
    try {
      await playback.setSinkId(outputId);
    } catch (error) {
      console.error("Unable to route audio to the selected output:", error);
      setAudioInputError("Unable to use the selected output device.");
    }
  }

  useEffect(() => {
    Object.keys(audioPlaybackRef.current).forEach((trackId) => void applyAudioPlaybackSettings(trackId));
    Object.keys(audioRoutedRef.current).forEach((trackId) => void applyAudioPlaybackSettings(trackId));
  }, [audioTrackOutputIds, audioTracks]);

  const audioMonitorKey = JSON.stringify([
    audioReloadToken,
    ...(audioMonitoringEnabled ? [["mic", selectedAudioInputId]] : []),
    ...audioTracks
      .filter((track) => track.id !== "mic" && audioTrackInputIds[track.id])
      .map((track) => [track.id, audioTrackInputIds[track.id]]),
  ]);

  useEffect(() => {
    const sources = (JSON.parse(audioMonitorKey) as [number, ...[string, string][]]).slice(1) as [string, string][];
    setAudioMeterLevels({});
    if (sources.length === 0) {
      return;
    }

    let cancelled = false;
    const cleanups: Array<() => void> = [];
    setAudioInputError(null);

    async function monitorSource(trackId: string, deviceId: string): Promise<void> {
      try {
        if (!navigator.mediaDevices?.getUserMedia || typeof window.AudioContext !== "function") {
          throw new Error("Live audio monitoring is not supported in this environment.");
        }
        const rawAudio = trackId !== "mic";
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
            ...(rawAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : {}),
          },
          video: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const audioContext = new AudioContext();
        let animationFrame = 0;
        cleanups.push(() => {
          window.cancelAnimationFrame(animationFrame);
          stream.getTracks().forEach((track) => track.stop());
          if (audioContext.state !== "closed") {
            void audioContext.close().catch((error: unknown) => {
              console.error("Unable to close audio meter context:", error);
            });
          }
        });
        if (audioContext.state === "suspended") {
          await audioContext.resume();
        }
        if (cancelled) {
          return;
        }

        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);

        if (trackId === "capture-card") {
          audioStreamsRef.current[trackId] = stream;
          const gainNode = audioContext.createGain();
          gainNode.gain.value = 0;
          source.connect(gainNode);
          gainNode.connect(audioContext.destination);
          audioRoutedRef.current[trackId] = { context: audioContext, gain: gainNode };
          cleanups.push(() => {
            delete audioRoutedRef.current[trackId];
            delete audioStreamsRef.current[trackId];
          });
          await applyAudioPlaybackSettings(trackId);
        }

        const samples = new Float32Array(analyser.fftSize);
        let smoothedLevel = 0;
        let lastUpdateTime = 0;

        function updateMeter(timestamp: number): void {
          analyser.getFloatTimeDomainData(samples);
          let sumSquares = 0;
          for (const sample of samples) {
            sumSquares += sample * sample;
          }
          const rms = Math.sqrt(sumSquares / samples.length);
          const decibels = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
          const targetLevel = Math.max(0, Math.min(100, ((decibels + 48) / 40) * 100));
          smoothedLevel += (targetLevel - smoothedLevel) * (targetLevel > smoothedLevel ? 0.65 : 0.25);

          if (timestamp - lastUpdateTime >= 50) {
            const level = Math.round(smoothedLevel);
            setAudioMeterLevels((levels) => (levels[trackId] === level ? levels : { ...levels, [trackId]: level }));
            lastUpdateTime = timestamp;
          }
          animationFrame = window.requestAnimationFrame(updateMeter);
        }

        animationFrame = window.requestAnimationFrame(updateMeter);
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error("Unable to monitor audio input:", error);
        setAudioInputError(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Microphone permission was denied. Allow Babu Studio under System Settings > Privacy & Security > Microphone, then reopen these settings."
            : error instanceof Error ? error.message : String(error),
        );
      }
    }

    sources.forEach(([trackId, deviceId]) => void monitorSource(trackId, deviceId));
    return () => {
      cancelled = true;
      cleanups.forEach((cleanup) => cleanup());
      Object.keys(audioPlaybackRef.current).forEach((trackId) => {
        const playback = audioPlaybackRef.current[trackId];
        playback.pause();
        playback.srcObject = null;
        delete audioPlaybackRef.current[trackId];
      });
    };
  }, [audioMonitorKey]);


  return { audioMeterLevels };
}
