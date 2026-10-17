import type { ExportPickerProps, ExportProgressProps } from "../types/export.types";
import { ExportPickerDialog } from "./ExportPickerDialog";
import { ExportProgressDialog } from "./ExportProgressDialog";

export type ExportDialogsProps = {
  picker: ExportPickerProps;
  progress: ExportProgressProps;
};

export function ExportDialogs({ picker, progress }: ExportDialogsProps) {
  return (
    <>
      <ExportPickerDialog picker={picker} />
      <ExportProgressDialog progress={progress} />
    </>
  );
}
