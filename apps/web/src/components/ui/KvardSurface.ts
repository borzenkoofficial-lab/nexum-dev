import { createElement, type HTMLAttributes, type ReactElement, type ReactNode } from "react";

export type KvardSurfaceElement = "div" | "section" | "article";
export type KvardSurfaceVariant = "default" | "subtle" | "raised" | "outline";
export type KvardSurfacePadding = "none" | "sm" | "md" | "lg";

export interface KvardSurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: KvardSurfaceElement;
  variant?: KvardSurfaceVariant;
  padding?: KvardSurfacePadding;
  children?: ReactNode;
}

export function KvardSurface({
  as = "div",
  variant = "default",
  padding = "md",
  className,
  children,
  ...surfaceProps
}: KvardSurfaceProps): ReactElement {
  const classes = [
    "kv-surface",
    `kv-surface--${variant}`,
    `kv-surface--padding-${padding}`,
    className,
  ].filter(Boolean).join(" ");

  return createElement(as, { ...surfaceProps, className: classes }, children);
}
