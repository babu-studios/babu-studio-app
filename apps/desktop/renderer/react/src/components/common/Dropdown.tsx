import type { ReactNode, SelectHTMLAttributes } from "react";

type DropdownProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  loading?: boolean;
  loadingLabel?: string;
  children: ReactNode;
};

export function Dropdown({
  loading = false,
  loadingLabel = "Loading options",
  disabled,
  className = "",
  children,
  ...selectProps
}: DropdownProps) {
  return (
    <div className={`dropdown${loading ? " dropdown--loading" : ""}`}>
      <select
        {...selectProps}
        className={`dropdown-select ${className}`.trim()}
        disabled={disabled || loading}
        aria-busy={loading}
      >
        {children}
      </select>
      {loading && <span className="dropdown-loader" role="status" aria-label={loadingLabel} />}
    </div>
  );
}
