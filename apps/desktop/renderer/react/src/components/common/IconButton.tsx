import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "default" | "danger" | "alert";
  active?: boolean;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { tone = "default", active = false, className = "", type = "button", ...buttonProps },
  ref,
) {
  const classes = [
    "icon-button",
    tone !== "default" ? `icon-button--${tone}` : "",
    active ? "icon-button--active" : "",
    className,
  ].filter(Boolean).join(" ");

  return <button {...buttonProps} ref={ref} type={type} className={classes} />;
});
