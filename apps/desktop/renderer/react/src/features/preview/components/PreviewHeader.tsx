import { Icon } from "@/components/common/Icon";
import { IconButton } from "@/components/common/IconButton";
import type { OUTPUTS } from "@/features/studio/constants/outputs";

type PreviewHeaderProps = {
  output: (typeof OUTPUTS)[number];
  previewEnabled: boolean;
  onTogglePreview: () => void;
};

export function PreviewHeader({ output, previewEnabled, onTogglePreview }: PreviewHeaderProps) {
  const action = previewEnabled ? "Disable" : "Enable";
  return (
    <span className="preview-card-heading">
      <span className="preview-output-name">
        <Icon name={output.icon} />
        {output.name}
        <span className="preview-ratio">{output.ratio}</span>
      </span>
      <span className="preview-header-actions">
        <IconButton
          className="preview-visibility-button"
          active={!previewEnabled}
          title={`${action} ${output.name} preview`}
          aria-label={`${action} ${output.name} preview`}
          aria-pressed={!previewEnabled}
          onClick={onTogglePreview}
        >
          <Icon name={previewEnabled ? "eye" : "eye-off"} />
        </IconButton>
      </span>
    </span>
  );
}
