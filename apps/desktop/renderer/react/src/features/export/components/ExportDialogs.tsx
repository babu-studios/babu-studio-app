import type { AiDialogProps, ExportPickerProps, ExportProgressProps } from "../types/export.types";
import { AiDialog } from "./AiDialog";
import { DialogErrorBoundary } from "./DialogErrorBoundary";
import { ExportPickerDialog } from "./ExportPickerDialog";
import { ExportProgressDialog } from "./ExportProgressDialog";

export type ExportDialogsProps = {
  picker: ExportPickerProps;
  progress: ExportProgressProps;
  ai: AiDialogProps;
};

export function ExportDialogs({ picker, progress, ai }: ExportDialogsProps) {
  return (
    <>
      <ExportPickerDialog picker={picker} />
      <ExportProgressDialog progress={progress} />
      <DialogErrorBoundary key={ai.open ? "ai-open" : "ai-closed"} onClose={() => ai.setOpen(false)}>
        <AiDialog dialog={ai} />
      </DialogErrorBoundary>
    </>
  );
}
