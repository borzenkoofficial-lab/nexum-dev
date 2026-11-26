import { createElement, type ReactElement, type ReactNode } from "react";
import type { KvardStatusTone } from "./KvardStatusBadge.ts";

export interface KvardToastProps {
  children: ReactNode;
  tone?: Exclude<KvardStatusTone, "neutral">;
  className?: string;
}

export function KvardToast({
  children,
  tone = "info",
  className,
}: KvardToastProps): ReactElement {
  const classes = ["kv-toast", `kv-toast--${tone}`, className].filter(Boolean).join(" ");
  return createElement("div", {
    className: classes,
    role: "status",
    "aria-live": "polite",
    "aria-atomic": true,
  }, children);
}
