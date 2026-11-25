import { createElement, type ReactElement } from "react";

export type KvardStatusTone = "neutral" | "success" | "warning" | "danger" | "info";

export interface KvardStatusBadgeProps {
  label: string;
  tone?: KvardStatusTone;
  className?: string;
}

export function KvardStatusBadge({
  label,
  tone = "neutral",
  className,
}: KvardStatusBadgeProps): ReactElement {
  const classes = ["kv-status-badge", `kv-status-badge--${tone}`, className]
    .filter(Boolean)
    .join(" ");

  return createElement("span", { className: classes, "data-tone": tone }, label);
}
