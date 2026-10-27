import type { Dispatch, SetStateAction } from "react";
import type { AiKeySource } from "@shared/types/media";
import type { ExportResolutionId } from "@shared/constants/media.constants";
import type { PostProcessingState, RecordingExport, RecordingMode, RecordingSummary } from "@shared/types/media";

type Setter<T> = Dispatch<SetStateAction<T>>;

export type ExportPickerProps = {
  open: boolean;
  setOpen: Setter<boolean>;
  busy: boolean;
  loading: boolean;
  error: string | null;
  recordings: RecordingSummary[];
  selectedRecordingId: string;
  setSelectedRecordingId: Setter<string>;
  modes: RecordingMode[];
  setModes: Setter<RecordingMode[]>;
  resolution: ExportResolutionId;
  setResolution: Setter<ExportResolutionId>;
  freeBytes: number | null;
  onExport: () => Promise<void>;
};

export type AiDialogProps = {
  open: boolean;
  setOpen: Setter<boolean>;
  busy: boolean;
  loading: boolean;
  recordings: RecordingSummary[];
  selectedRecordingId: string;
  setSelectedRecordingId: Setter<string>;
  aiShotExportBusy: boolean;
  aiShotExportProgress: number;
  aiShotExportPath: string | null;
  aiShotExportError: string | null;
  onAiShotExport: () => Promise<void>;
  onCancelAiShotExport: () => void;
  aiSourceFiles: string[];
  selectedAiSourceFile: string | null;
  onSelectAiSourceFile: (file: string) => void;
  highlightsBusy: boolean;
  highlightsStage: string | null;
  highlightsClips: Array<import("@shared/types/media").AiHighlightSuggestion & { exportPath: string | null }>;
  highlightsError: string | null;
  highlightsModel: string | null;
  highlightsAnalyzedAt: string | null;
  highlightsTimeError: string | null;
  exportingIndex: number | null;
  exportingAll: boolean;
  keyConfigured: boolean;
  keySource: AiKeySource | null;
  keyBusy: boolean;
  keyError: string | null;
  onRefreshKeyStatus: () => Promise<void>;
  onSaveAiKey: (key: string) => Promise<void>;
  onClearAiKey: () => Promise<void>;
  onFindHighlights: (sourceFile: string | null) => Promise<void>;
  onCancelFindHighlights: () => void;
  onUpdateHighlightTime: (index: number, field: "startTime" | "endTime", raw: string) => void;
  onExportHighlightClip: (index: number) => Promise<void>;
  onExportAllHighlights: () => Promise<void>;
};

export type ExportProgressProps = {
  open: boolean;
  setOpen: Setter<boolean>;
  state: PostProcessingState;
  completed: boolean;
  activeExport: RecordingExport | undefined;
  overallProgress: number;
  exports: RecordingExport[];
  onCancel: () => void;
};
