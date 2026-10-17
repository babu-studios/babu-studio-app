import { levelFor } from "./resource-format";

export type MetricRow = [label: string, value: string];

type ResourcePopupSectionProps = {
  title: string;
  percent: number | null;
  rows: MetricRow[];
};

export function ResourcePopupSection({ title, percent, rows }: ResourcePopupSectionProps) {
  return (
    <div className={`resource-popup-section resource-metric--${levelFor(percent)}`}>
      <strong className="resource-popup-title">{title}</strong>
      <dl>
        {rows.map(([rowLabel, rowValue]) => (
          <div key={rowLabel}>
            <dt>{rowLabel}</dt>
            <dd>{rowValue}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
