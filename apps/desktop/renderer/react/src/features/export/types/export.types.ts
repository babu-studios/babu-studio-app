import type { Dispatch, SetStateAction } from "react";
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
