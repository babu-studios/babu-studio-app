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
  const showLoading = loading && !disabled;
  return (
    <div className={`dropdown${showLoading ? " dropdown--loading" : ""}`}>
      <select
        {...selectProps}
        className={`dropdown-select ${className}`.trim()}
        disabled={disabled || showLoading}
        aria-busy={showLoading}
      >
        {children}
      </select>
      {showLoading && <span className="dropdown-loader" role="status" aria-label={loadingLabel} />}
    </div>
  );
}
