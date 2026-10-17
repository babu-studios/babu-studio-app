import { Icon } from "@/components/common/Icon";
import type { SceneSidebarProps } from "@/features/studio/components/sidebar.types";

export function SceneList({ scene, isRecordingActive }: { scene: SceneSidebarProps; isRecordingActive: boolean }) {
  const {
    currentScenes,
    activeScene,
    editingScene,
    setEditingScene,
    sceneNameDraft,
    setSceneNameDraft,
    renameInputRef,
    ignoreRenameBlur,
    addScene,
    selectScene,
    startSceneRename,
    finishSceneRename,
    deleteScene,
  } = scene;
  return (
          <section className="inspector-section">
            <div className="section-title">
              <Icon name="scenes" />
              <h3>Scenes</h3>
              <button
                className="text-icon-button"
                title="Add scene"
                aria-label="Add scene"
                disabled={isRecordingActive}
                onClick={addScene}
              >
                <Icon name="plus" />
              </button>
            </div>
            <div className="scene-list" role="group" aria-label="Shared scenes">
              {currentScenes.map((scene) => {
                const active = activeScene === scene.id;
                const editing = editingScene === scene.id;
                return (
                  <div className={`scene-item${active ? " scene-item--active" : ""}`} key={scene.id}>
                    {editing ? (
                      <div className="scene-row scene-row--editing">
                        <input
                          ref={renameInputRef}
                          className="scene-name-input"
                          value={sceneNameDraft}
                          maxLength={12}
                          aria-label={`Rename scene ${scene.name}`}
                          onChange={(event) => setSceneNameDraft(event.target.value)}
                          onBlur={() => finishSceneRename(scene.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.currentTarget.blur();
                            } else if (event.key === "Escape") {
                              ignoreRenameBlur.current = true;
                              setEditingScene(null);
                              event.currentTarget.blur();
                            }
                          }}
                        />
                        {active && <span className="scene-active-dot" aria-label="Active scene" />}
                      </div>
                    ) : (
                      <button
                        className="scene-row"
                        disabled={isRecordingActive}
                        onClick={() => selectScene(scene.id)}
                        onDoubleClick={() => startSceneRename(scene)}
                        onKeyDown={(event) => {
                          if (event.key === "F2") {
                            event.preventDefault();
                            startSceneRename(scene);
                          }
                        }}
                        title="Double-click to rename"
                        aria-pressed={active}
                      >
                        <span>{scene.name}</span>
                        {active && <span className="scene-active-dot" aria-label="Active scene" />}
                      </button>
                    )}
                    <button
                      className="delete-scene-button"
                      title={`Delete ${scene.name}`}
                      aria-label={`Delete scene ${scene.name}`}
                      disabled={isRecordingActive}
                      onClick={() => deleteScene(scene.id)}
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
  );
}
