import type { AiDialogProps, ExportPickerProps, ExportProgressProps } from "../types/export.types";
import { AiDialog } from "./AiDialog";
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
      <AiDialog dialog={ai} />
    </>
  );
}
