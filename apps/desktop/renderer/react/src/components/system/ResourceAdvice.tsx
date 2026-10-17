import { openActivityMonitor } from "./open-activity-monitor";
import { Icon } from "@/components/common/Icon";

type ResourceAdviceProps = {
  names: string[];
};

export function ResourceAdvice({ names }: ResourceAdviceProps) {
  if (names.length === 0) {
    return null;
  }
  const shown = names.slice(0, 4).join(", ");
  const extra = names.length > 4 ? ` and ${names.length - 4} more` : "";
  return (
    <div className="resource-advice" role="alert">
      <span className="resource-advice-text">
        <strong>Free up resources before recording.</strong>
        {" "}These apps or processes are heavy and not needed: {shown}{extra}. Closing them can reduce dropped frames.
      </span>
      <button
        className="resource-advice-action"
        type="button"
        onClick={() => void openActivityMonitor()}
      >
        <Icon name="settings" />
        Open Activity Monitor
      </button>
    </div>
  );
}
