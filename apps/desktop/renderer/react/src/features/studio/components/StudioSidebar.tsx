import { IconButton } from "@/components/common/IconButton";
import { Icon } from "@/components/common/Icon";
import { AudioMixer } from "@/features/audio/components/AudioMixer";
import { LayerList } from "@/features/layers/components/LayerList";
import { SceneList } from "@/features/scenes/components/SceneList";
import type { StudioSidebarProps } from "./sidebar.types";

export function StudioSidebar({ isRecordingActive, scene, layers, audio }: StudioSidebarProps) {
  const { inspectorRef } = scene;
  const { layersReloading, reloadAll } = layers;
  return (
    <aside className="inspector" ref={inspectorRef} aria-label="Studio configuration">
      <div className="inspector-heading">
        <div>
          <span className="section-kicker">SHARED CONFIGURATION</span>
          <h2 className="inspector-ratio" aria-label="16 by 9 and 9 by 16 layouts">
            <span>16:9</span>
            <span className="inspector-ratio-separator" aria-hidden="true">+</span>
            <span>9:16</span>
          </h2>
        </div>
        <div className="inspector-heading-actions">
          <IconButton
            className="section-reload-button"
            title="Reload all: reconnect the saved layer inputs and restart the audio mixer"
            aria-label="Reload layers and audio mixer"
            disabled={layersReloading || isRecordingActive}
            onClick={reloadAll}
          >
            <Icon name="reload" />
          </IconButton>
        </div>
      </div>
      <SceneList scene={scene} isRecordingActive={isRecordingActive} />
      <LayerList layers={layers} isRecordingActive={isRecordingActive} />
      <AudioMixer audio={audio} isRecordingActive={isRecordingActive} />
    </aside>
  );
}
