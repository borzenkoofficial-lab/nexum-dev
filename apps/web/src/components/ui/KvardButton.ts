import { createElement, type ButtonHTMLAttributes, type ReactElement } from "react";

export type KvardButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type KvardButtonSize = "sm" | "md" | "lg";

export interface KvardButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
  variant?: KvardButtonVariant;
  size?: KvardButtonSize;
  loading?: boolean;
}

export function KvardButton({
  variant = "secondary",
  size = "md",
  loading = false,
  disabled = false,
  type = "button",
  className,
  children,
  ...buttonProps
}: KvardButtonProps): ReactElement {
  const classes = ["kv-button", `kv-button--${variant}`, `kv-button--${size}`, className]
    .filter(Boolean)
    .join(" ");

  return createElement(
    "button",
    {
      ...buttonProps,
      type,
      className: classes,
      disabled: disabled || loading,
      "aria-busy": loading ? true : buttonProps["aria-busy"],
    },
    createElement("span", { className: "kv-button__content" }, children),
    loading ? createElement("span", { className: "kv-button__spinner", "aria-hidden": true }) : null,
  );
}
