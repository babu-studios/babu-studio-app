import { useEffect, useRef } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { ExportDialogs } from "@/features/export/components/ExportDialogs";
import { useAiHighlights } from "@/features/export/hooks/useAiHighlights";
import { useExportFlow } from "@/features/export/hooks/useExportFlow";
import { useAudioMixer } from "@/features/audio/hooks/useAudioMixer";
import { useBrowserCaptureStreams } from "@/features/layers/hooks/useBrowserCaptureStreams";
import { useLayerPanel } from "@/features/layers/hooks/useLayerPanel";
import { useLayers } from "@/features/layers/hooks/useLayers";
import { useVideoInputs } from "@/features/layers/hooks/useVideoInputs";
import { CanvasWorkspace } from "@/features/preview/components/CanvasWorkspace";
import { useCanvasSelection } from "@/features/preview/hooks/useCanvasSelection";
import { RecordingControls } from "@/features/recording/components/RecordingControls";
import { Toasts } from "@/features/recording/components/Toasts";
import { useRecordingPolling } from "@/features/recording/hooks/useRecordingPolling";
import { useRecordingSession } from "@/features/recording/hooks/useRecordingSession";
import { useRecordingState } from "@/features/recording/hooks/useRecordingState";
import { useToasts } from "@/features/recording/hooks/useToasts";
import { useScenes } from "@/features/scenes/hooks/useScenes";
import { StudioSidebar } from "@/features/studio/components/StudioSidebar";
import { useStudioConfiguration } from "@/features/studio/hooks/useStudioConfiguration";

export default function App() {
  const inspectorRef = useRef<HTMLElement>(null);
  const recording = useRecordingState();
  const toasts = useToasts(recording.recordingNotice, recording.postProcessingState);
  const config = useStudioConfiguration(toasts.setInfoToast);
  const { activeScene, setActiveScene, scenes, setScenes, layersByScene, setLayersByScene } = config;
  const currentScene = scenes.find((scene) => scene.id === activeScene) ?? null;
  const currentLayers = currentScene ? layersByScene[currentScene.id] ?? [] : [];

  const captureStreams = useBrowserCaptureStreams();
  const panel = useLayerPanel(inspectorRef);
  const canvas = useCanvasSelection();
  const videoInputs = useVideoInputs(panel.settingsLayerId, layersByScene);
  const sceneActions = useScenes({
    scenes,
    setScenes,
    activeScene,
    setActiveScene,
    layersByScene,
    setLayersByScene,
    setBrowserCaptureStream: captureStreams.setBrowserCaptureStream,
    setSettingsLayerId: panel.setSettingsLayerId,
    setLayerMenuOpen: panel.setLayerMenuOpen,
    clearCanvasSelection: canvas.clearCanvasSelection,
  });
  const layerActions = useLayers({
    activeScene,
    currentScene,
    currentLayers,
    layersByScene,
    setLayersByScene,
    videoInputDevices: videoInputs.videoInputDevices,
    setVideoInputError: videoInputs.setVideoInputError,
    setVideoInputDevices: videoInputs.setVideoInputDevices,
    setBrowserCaptureStream: captureStreams.setBrowserCaptureStream,
    setSettingsLayerId: panel.setSettingsLayerId,
    setLayerMenuOpen: panel.setLayerMenuOpen,
    deselectLayer: canvas.deselectLayer,
  });
  const audio = useAudioMixer({ config, inspectorRef, isRecordingActive: recording.recordingActive });
  const { startRecording, stopRecording } = useRecordingSession({
    state: recording,
    config,
    currentScene,
    currentLayers,
    videoInputDevices: videoInputs.videoInputDevices,
    discoverAudioInputs: audio.discoverAudioInputs,
  });
  useRecordingPolling(recording, toasts.setInfoToast, stopRecording);
  const exportFlow = useExportFlow(recording, config);
  const aiHighlights = useAiHighlights(exportFlow.selectedRecordingId, recording.recordingBusy);
  const aiDialogOpen = exportFlow.aiDialogOpen;
  const selectedRecordingId = exportFlow.selectedRecordingId;
  useEffect(() => {
    if (aiDialogOpen && selectedRecordingId) {
      void exportFlow.refreshAiShotPath();
      void aiHighlights.refreshPersistedHighlights();
    }
  }, [aiDialogOpen, selectedRecordingId]);

  function reloadAll(): void {
    audio.reloadAudioMixer();
    void layerActions.reloadLayers();
  }

  return (
    <main className="studio-app">
      <Topbar>
        <RecordingControls
          recordingActive={recording.recordingActive}
          recordingBusy={recording.recordingBusy}
          recordingElapsedMs={recording.recordingElapsedMs}
          postProcessingState={recording.postProcessingState}
          onOpenExport={() => void exportFlow.openExportPicker()}
          onOpenAi={() => void exportFlow.openAiDialog()}
          exportLocked={aiHighlights.exportingIndex !== null || aiHighlights.exportingAll}
          onStart={() => void startRecording()}
          onStop={() => void stopRecording()}
        />
      </Topbar>

      <Toasts
        infoToast={toasts.infoToast}
        recordingErrorToast={toasts.recordingErrorToast}
        postProcessingState={recording.postProcessingState}
        recordingBusy={recording.recordingBusy}
        onDismissInfo={() => toasts.setInfoToast(null)}
        onDismissError={() => toasts.setRecordingErrorToast(null)}
        onRetryExport={() => void exportFlow.retryRecordingExport()}
      />

      <div className="studio-layout">
        <StudioSidebar
          isRecordingActive={recording.recordingActive}
          scene={{
            inspectorRef,
            currentScenes: scenes,
            activeScene,
            ...sceneActions,
          }}
          layers={{
            currentScene,
            currentLayers,
            settingsLayerId: panel.settingsLayerId,
            setSettingsLayerId: panel.setSettingsLayerId,
            videoInputDevices: videoInputs.videoInputDevices,
            videoInputLoading: videoInputs.videoInputLoading,
            videoInputError: videoInputs.videoInputError,
            draggedLayerId: panel.draggedLayerId,
            setDraggedLayerId: panel.setDraggedLayerId,
            dragOverLayerId: panel.dragOverLayerId,
            setDragOverLayerId: panel.setDragOverLayerId,
            layersReloading: layerActions.layersReloading,
            layerMenuOpen: panel.layerMenuOpen,
            setLayerMenuOpen: panel.setLayerMenuOpen,
            layerMenuPosition: panel.layerMenuPosition,
            layerMenuRef: panel.layerMenuRef,
            layerMenuButtonRef: panel.layerMenuButtonRef,
            layerMenuPopupRef: panel.layerMenuPopupRef,
            layerSettingsPosition: panel.layerSettingsPosition,
            layerSettingsButtonRef: panel.layerSettingsButtonRef,
            layerSettingsRef: panel.layerSettingsRef,
            reloadAll,
            addLayer: layerActions.addLayer,
            toggleLayer: layerActions.toggleLayer,
            deleteLayer: layerActions.deleteLayer,
            updateLayer: layerActions.updateLayer,
            reorderLayer: layerActions.reorderLayer,
            changeVideoInputDevice: layerActions.changeVideoInputDevice,
            changeLayerCaptureResolution: layerActions.changeLayerCaptureResolution,
          }}
          audio={audio.audioProps}
        />

        <CanvasWorkspace
          scene={currentScene}
          layers={currentLayers}
          previewEnabled={config.previewEnabled}
          browserCaptureStreams={captureStreams.browserCaptureStreams}
          selection={canvas.selectedCanvasObject}
          onSelect={canvas.selectCanvasObject}
          onTogglePreview={(outputId) => config.setPreviewEnabled((current) => ({ ...current, [outputId]: !current[outputId] }))}
          onTransformChange={(layerId, outputId, transform) => {
            if (currentScene) {
              layerActions.updateLayerTransform(currentScene.id, layerId, outputId, transform);
            }
          }}
          onSourceDimensionsChange={(layerId, sourceDimensions) => {
            if (currentScene) {
              layerActions.updateLayer(currentScene.id, layerId, { sourceDimensions });
            }
          }}
        />
      </div>

      <ExportDialogs
        picker={{
          open: exportFlow.exportPickerOpen,
          setOpen: exportFlow.setExportPickerOpen,
          busy: recording.recordingBusy,
          loading: exportFlow.exportPickerLoading,
          error: exportFlow.exportPickerError,
          recordings: exportFlow.savedRecordings,
          selectedRecordingId: exportFlow.selectedRecordingId,
          setSelectedRecordingId: exportFlow.setSelectedRecordingId,
          modes: config.exportModes,
          setModes: config.setExportModes,
          resolution: config.exportResolution,
          setResolution: config.setExportResolution,
          freeBytes: exportFlow.exportFreeBytes,
          onExport: exportFlow.startSelectedExport,
        }}
        ai={{
          open: exportFlow.aiDialogOpen,
          setOpen: exportFlow.setAiDialogOpen,
          busy: recording.recordingBusy,
          loading: exportFlow.exportPickerLoading,
          recordings: exportFlow.savedRecordings,
          selectedRecordingId: exportFlow.selectedRecordingId,
          setSelectedRecordingId: exportFlow.setSelectedRecordingId,
          aiShotExportBusy: exportFlow.aiShotExportBusy,
          aiShotExportProgress: exportFlow.aiShotExportProgress,
          aiShotExportPath: exportFlow.aiShotExportPath,
          aiShotExportError: exportFlow.aiShotExportError,
          onAiShotExport: exportFlow.startAiShotExport,
          onCancelAiShotExport: exportFlow.cancelAiShotExport,
          aiSourceFiles: exportFlow.aiSourceFiles,
          selectedAiSourceFile: exportFlow.selectedAiSourceFile,
          onSelectAiSourceFile: exportFlow.setSelectedAiSourceFile,
          highlightsBusy: aiHighlights.highlightsBusy,
          highlightsStage: aiHighlights.highlightsStage,
          highlightsClips: aiHighlights.highlightsClips,
          highlightsError: aiHighlights.highlightsError,
          highlightsModel: aiHighlights.highlightsModel,
          highlightsAnalyzedAt: aiHighlights.highlightsAnalyzedAt,
          highlightsTimeError: aiHighlights.highlightsTimeError,
          exportingIndex: aiHighlights.exportingIndex,
          exportingAll: aiHighlights.exportingAll,
          keyConfigured: aiHighlights.keyStatus?.configured ?? false,
          keySource: aiHighlights.keyStatus?.source ?? null,
          keyBusy: aiHighlights.keyBusy,
          keyError: aiHighlights.keyError,
          onRefreshKeyStatus: aiHighlights.refreshKeyStatus,
          onSaveAiKey: aiHighlights.saveAiKey,
          onClearAiKey: aiHighlights.clearAiKey,
          onFindHighlights: (sourceFile) => aiHighlights.findHighlights(sourceFile),
          onCancelFindHighlights: aiHighlights.cancelFindHighlights,
          onUpdateHighlightTime: aiHighlights.updateClipTime,
          onExportHighlightClip: aiHighlights.exportHighlightClip,
          onExportAllHighlights: aiHighlights.exportAllHighlights,
        }}
        progress={{
          open: recording.exportDialogOpen,
          setOpen: recording.setExportDialogOpen,
          state: recording.postProcessingState,
          completed: exportFlow.exportsCompleted,
          activeExport: exportFlow.activeExport,
          overallProgress: exportFlow.overallExportProgress,
          exports: recording.recordingExports,
          onCancel: exportFlow.cancelExport,
        }}
      />
    </main>
  );
}
