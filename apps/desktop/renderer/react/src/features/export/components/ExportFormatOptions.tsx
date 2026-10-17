import type { Dispatch, SetStateAction } from "react";
import type { RecordingMode } from "@shared/types/media";

const FORMATS = [
  { mode: "HORIZONTAL", name: "Horizontal", ratio: "16:9" },
  { mode: "VERTICAL", name: "Vertical", ratio: "9:16" },
] as const;

type ExportFormatOptionsProps = {
  modes: RecordingMode[];
  setModes: Dispatch<SetStateAction<RecordingMode[]>>;
  disabled: boolean;
};

export function ExportFormatOptions({ modes, setModes, disabled }: ExportFormatOptionsProps) {
  return (
    <div className="export-format-options" role="group" aria-label="Layouts to export">
      {FORMATS.map(({ mode, name, ratio }) => {
        const selected = modes.includes(mode);
        return (
          <label className={`export-format-option${selected ? " export-format-option--selected" : ""}`} key={mode}>
            <input
              type="checkbox"
              checked={selected}
              disabled={disabled || (selected && modes.length === 1)}
              onChange={() => setModes((current) => (
                current.includes(mode)
                  ? current.length > 1 ? current.filter((entry) => entry !== mode) : current
                  : [...current, mode]
              ))}
            />
            <span className="export-format-copy">
              <strong>{name}</strong>
              <small>{ratio} · MP4</small>
            </span>
          </label>
        );
      })}
    </div>
  );
}
