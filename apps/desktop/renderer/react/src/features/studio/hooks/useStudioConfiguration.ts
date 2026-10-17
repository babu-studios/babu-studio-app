import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { DEFAULT_EXPORT_RESOLUTION, type ExportResolutionId } from "@shared/constants/media.constants";
import type { RecordingMode } from "@shared/types/media";
import type { StudioConfiguration } from "@shared/types/studio-config";
import { DEFAULT_AUDIO_MIXER } from "@/features/studio/constants/audio";
import { AUDIO_MIXER_STORAGE_KEY, LEGACY_AUDIO_MIXER_STORAGE_KEY, LEGACY_STUDIO_STATE_STORAGE_KEY, PORTRAIT_PLACEMENT_VERSION, STUDIO_STATE_STORAGE_KEY } from "@/features/studio/constants/storage";
import { loadAudioMixer, loadLegacyStoredValue, loadPersistedStudioState } from "@/features/studio/persistence/studio-state";
import type { AudioTrack, OutputId, PersistedAudioMixer, Scene, SceneId, StudioLayer } from "@/features/studio/types/studio.types";
import { isExportResolutionId } from "@/features/studio/utils/guards";

type InfoToast = { text: string; tone: "success" | "error" } | null;

export function useStudioConfiguration(setInfoToast: Dispatch<SetStateAction<InfoToast>>) {
  const [initialStudioState] = useState(() => loadPersistedStudioState(null));
  const [activeScene, setActiveScene] = useState<SceneId | null>(initialStudioState.activeScene);
  const [scenes, setScenes] = useState<Scene[]>(initialStudioState.scenes);
  const [layersByScene, setLayersByScene] = useState<Record<SceneId, StudioLayer[]>>(initialStudioState.layersByScene);
  const [savedAudioMixer] = useState<PersistedAudioMixer>(() => ({ ...DEFAULT_AUDIO_MIXER }));
  const [selectedAudioInputId, setSelectedAudioInputId] = useState(savedAudioMixer.selectedInputId);
  const [audioMonitoringEnabled, setAudioMonitoringEnabled] = useState(savedAudioMixer.monitoringEnabled);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>(savedAudioMixer.tracks);
  const [audioTrackInputIds, setAudioTrackInputIds] = useState<Record<string, string>>(savedAudioMixer.trackInputIds);
  const [audioTrackOutputIds, setAudioTrackOutputIds] = useState<Record<string, string>>(savedAudioMixer.trackOutputIds);
  const [exportModes, setExportModes] = useState<RecordingMode[]>(["HORIZONTAL", "VERTICAL"]);
  const [exportResolution, setExportResolution] = useState<ExportResolutionId>(DEFAULT_EXPORT_RESOLUTION);
  const [previewEnabled, setPreviewEnabled] = useState<Record<OutputId, boolean>>({
    landscape: true,
    portrait: true,
  });
  const [configurationReady, setConfigurationReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.babuStudio.loadStudioConfig().then((configuration) => {
      if (cancelled) {
        return;
      }
      if (configuration) {
        const studioState = loadPersistedStudioState(configuration.studio);
        const audioMixer = loadAudioMixer(configuration.audioMixer);
        const modes = configuration.exportSettings.modes.filter(
          (mode): mode is RecordingMode => mode === "HORIZONTAL" || mode === "VERTICAL",
        );
        setActiveScene(studioState.activeScene);
        setScenes(studioState.scenes);
        setLayersByScene(studioState.layersByScene);
        setAudioTracks(audioMixer.tracks);
        setSelectedAudioInputId(audioMixer.selectedInputId);
        setAudioMonitoringEnabled(audioMixer.monitoringEnabled);
        setAudioTrackInputIds(audioMixer.trackInputIds);
        setAudioTrackOutputIds(audioMixer.trackOutputIds);
        setExportModes(modes.length > 0 ? [...new Set(modes)] : ["HORIZONTAL", "VERTICAL"]);
        setExportResolution(
          isExportResolutionId(configuration.exportSettings.resolution)
            ? configuration.exportSettings.resolution
            : DEFAULT_EXPORT_RESOLUTION,
        );
        setPreviewEnabled({
          landscape: configuration.preview.landscape,
          portrait: configuration.preview.portrait,
        });
      } else {
        const studioState = loadPersistedStudioState(loadLegacyStoredValue([
          STUDIO_STATE_STORAGE_KEY,
          LEGACY_STUDIO_STATE_STORAGE_KEY,
        ]));
        const audioMixer = loadAudioMixer(loadLegacyStoredValue([
          AUDIO_MIXER_STORAGE_KEY,
          LEGACY_AUDIO_MIXER_STORAGE_KEY,
        ]));
        setActiveScene(studioState.activeScene);
        setScenes(studioState.scenes);
        setLayersByScene(studioState.layersByScene);
        setAudioTracks(audioMixer.tracks);
        setSelectedAudioInputId(audioMixer.selectedInputId);
        setAudioMonitoringEnabled(audioMixer.monitoringEnabled);
        setAudioTrackInputIds(audioMixer.trackInputIds);
        setAudioTrackOutputIds(audioMixer.trackOutputIds);
      }
      setConfigurationReady(true);
    }).catch((error: unknown) => {
      if (!cancelled) {
        console.error("Could not load Babu Studio configuration.", error);
        setInfoToast({
          tone: "error",
          text: `Unable to load saved settings: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    });
    return () => { cancelled = true; };
  }, [setInfoToast]);

  useEffect(() => {
    if (!configurationReady) {
      return;
    }
    const configuration: StudioConfiguration = {
      version: 1,
      studio: {
        activeScene,
        scenes,
        layersByScene,
        portraitPlacementVersion: PORTRAIT_PLACEMENT_VERSION,
      },
      audioMixer: {
        tracks: audioTracks,
        selectedInputId: selectedAudioInputId,
        monitoringEnabled: audioMonitoringEnabled,
        trackInputIds: audioTrackInputIds,
        trackOutputIds: audioTrackOutputIds,
      },
      exportSettings: { modes: exportModes, resolution: exportResolution },
      preview: previewEnabled,
    };
    const timer = window.setTimeout(() => {
      void window.babuStudio.saveStudioConfig(configuration).catch((error: unknown) => {
        console.error("Could not save Babu Studio configuration.", error);
        setInfoToast({
          tone: "error",
          text: `Unable to save settings: ${error instanceof Error ? error.message : String(error)}`,
        });
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    configurationReady,
    activeScene,
    scenes,
    layersByScene,
    audioTracks,
    selectedAudioInputId,
    audioMonitoringEnabled,
    audioTrackInputIds,
    audioTrackOutputIds,
    exportModes,
    exportResolution,
    previewEnabled,
    setInfoToast,
  ]);

  return {
    activeScene,
    setActiveScene,
    scenes,
    setScenes,
    layersByScene,
    setLayersByScene,
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
    exportModes,
    setExportModes,
    exportResolution,
    setExportResolution,
    previewEnabled,
    setPreviewEnabled,
  };
}
