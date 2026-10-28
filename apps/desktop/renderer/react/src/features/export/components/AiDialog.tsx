import { Dropdown } from "@/components/common/Dropdown";
import { Icon } from "@/components/common/Icon";
import { formatRecordingLabel } from "@/features/studio/utils/recording-format";
import type { AiDialogProps } from "../types/export.types";
import { AiClipStep } from "./ai/AiClipStep";
import { AiHighlightsStep } from "./ai/AiHighlightsStep";
import { AiKeySection } from "./ai/AiKeySection";

export function AiDialog({ dialog }: { dialog: AiDialogProps }) {
  const {
    open,
    setOpen,
    busy,
    loading,
    recordings,
    selectedRecordingId,
    setSelectedRecordingId,
    aiShotExportBusy,
    aiShotExportProgress,
    aiShotExportPath,
    aiShotExportError,
    onAiShotExport,
    onCancelAiShotExport,
    aiSourceFiles,
    selectedAiSourceFile,
    onSelectAiSourceFile,
    highlightsBusy,
    highlightsStage,
    highlightsClips,
    highlightsError,
    highlightsModel,
    highlightsAnalyzedAt,
    highlightsTimeError,
    exportingIndex,
    exportingAll,
    keyConfigured,
    keySource,
    keyBusy,
    keyError,
    onRefreshKeyStatus,
    onSaveAiKey,
    onClearAiKey,
    onFindHighlights,
    onCancelFindHighlights,
    onUpdateHighlightTime,
    onExportHighlightClip,
    onExportAllHighlights,
  } = dialog;
  const highlightsExportBusy = exportingIndex !== null || exportingAll;
  // One AI job at a time: any running export, analysis, or clip export locks
  // every other AI button in this popup.
  const anyAiTaskBusy = aiShotExportBusy || highlightsBusy || highlightsExportBusy;
  if (!open) {
    return null;
  }

  return (
    <div className="export-progress-backdrop">
      <section
        className="export-progress-dialog ai-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-dialog-title"
        aria-describedby="ai-dialog-subtitle"
      >
        <div className="export-progress-heading ai-dialog-head">
          <div className="ai-dialog-title">
            <span className="ai-dialog-badge" aria-hidden="true">
              <Icon name="sparkle" />
            </span>
            <div>
              <span className="export-progress-kicker">AI</span>
              <h2 id="ai-dialog-title">AI clips</h2>
              <p id="ai-dialog-subtitle" className="ai-dialog-subtitle">
                Turn a recording into a short vertical clip in two steps.
              </p>
            </div>
          </div>
          <button
            className="export-progress-cancel"
            type="button"
            aria-label="Close AI dialog"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            <Icon name="close" />
          </button>
        </div>

        {loading ? (
          <p className="export-progress-description">Loading recordings…</p>
        ) : recordings.length === 0 ? (
          <p className="export-progress-description">No saved recordings found. Record something first.</p>
        ) : (
          <label className="export-resolution ai-dialog-recording">
            <span>Recording</span>
            <Dropdown
              value={selectedRecordingId}
              aria-label="Recording for AI"
              disabled={busy}
              onChange={(event) => setSelectedRecordingId(event.target.value)}
            >
              {recordings.map((entry) => (
                <option key={entry.id} value={entry.id}>{formatRecordingLabel(entry)}</option>
              ))}
            </Dropdown>
          </label>
        )}

        <AiKeySection
          open={open}
          busy={busy}
          keyConfigured={keyConfigured}
          keySource={keySource}
          keyBusy={keyBusy}
          keyError={keyError}
          onRefreshKeyStatus={onRefreshKeyStatus}
          onSaveAiKey={onSaveAiKey}
          onClearAiKey={onClearAiKey}
        />

        {recordings.length > 0 && (
          <ol className="ai-steps">
            <AiClipStep
              busy={busy}
              loading={loading}
              selectedRecordingId={selectedRecordingId}
              aiShotExportBusy={aiShotExportBusy}
              aiShotExportProgress={aiShotExportProgress}
              aiShotExportPath={aiShotExportPath}
              aiShotExportError={aiShotExportError}
              onAiShotExport={onAiShotExport}
              onCancelAiShotExport={onCancelAiShotExport}
              aiSourceFiles={aiSourceFiles}
              selectedAiSourceFile={selectedAiSourceFile}
              onSelectAiSourceFile={onSelectAiSourceFile}
              anyAiTaskBusy={anyAiTaskBusy}
            />

            <AiHighlightsStep
              busy={busy}
              loading={loading}
              selectedAiSourceFile={selectedAiSourceFile}
              aiShotExportPath={aiShotExportPath}
              highlightsBusy={highlightsBusy}
              highlightsStage={highlightsStage}
              highlightsClips={highlightsClips}
              highlightsError={highlightsError}
              highlightsModel={highlightsModel}
              highlightsAnalyzedAt={highlightsAnalyzedAt}
              highlightsTimeError={highlightsTimeError}
              exportingIndex={exportingIndex}
              exportingAll={exportingAll}
              keyConfigured={keyConfigured}
              onFindHighlights={onFindHighlights}
              onCancelFindHighlights={onCancelFindHighlights}
              onUpdateHighlightTime={onUpdateHighlightTime}
              onExportHighlightClip={onExportHighlightClip}
              onExportAllHighlights={onExportAllHighlights}
              anyAiTaskBusy={anyAiTaskBusy}
              highlightsExportBusy={highlightsExportBusy}
            />
          </ol>
        )}
      </section>
    </div>
  );
}
