import { createElement, type ReactElement, type ReactNode } from "react";
import type { KvardStatusTone } from "./KvardStatusBadge.ts";

export interface KvardAlertProps {
  children: ReactNode;
  tone?: Exclude<KvardStatusTone, "neutral">;
  title?: string;
  onDismiss?: () => void;
  className?: string;
}

export function KvardAlert({
  children,
  tone = "info",
  title,
  onDismiss,
  className,
}: KvardAlertProps): ReactElement {
  const role = tone === "danger" ? "alert" : "status";
  const classes = ["kv-alert", `kv-alert--${tone}`, className].filter(Boolean).join(" ");
  return createElement("div", {
    className: classes,
    role,
    "aria-live": tone === "danger" ? "assertive" : "polite",
  },
  title ? createElement("strong", { className: "kv-alert__title" }, title) : null,
  createElement("div", { className: "kv-alert__content" }, children),
  onDismiss ? createElement("button", {
    className: "kv-alert__dismiss",
    type: "button",
    onClick: onDismiss,
    "aria-label": "Закрыть уведомление",
  }, "×") : null);
}
