import { Icon } from "@/components/common/Icon";

export function PausedOverlay() {
  return (
    <span className="preview-paused">
      <Icon name="eye-off" />
      <strong>Preview paused</strong>
      <span>This layout will still be included in recordings.</span>
    </span>
  );
}

export function PreviewFooter({ previewEnabled }: { previewEnabled: boolean }) {
  return (
    <span className="preview-card-footer">
      <span />
      <span className={`preview-state${previewEnabled ? "" : " preview-state--paused"}`}>
        <span className={`preview-live-dot${previewEnabled ? "" : " preview-live-dot--paused"}`} />
        {previewEnabled ? "PREVIEW" : "PAUSED"}
      </span>
    </span>
  );
}
