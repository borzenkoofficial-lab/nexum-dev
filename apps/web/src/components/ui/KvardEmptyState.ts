import { createElement, useId, type ReactElement, type ReactNode } from "react";

export interface KvardEmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function KvardEmptyState({
  title,
  description,
  action,
  className,
}: KvardEmptyStateProps): ReactElement {
  const titleId = useId();
  const classes = ["kv-empty-state", className].filter(Boolean).join(" ");
  return createElement("section", {
    className: classes,
    role: "region",
    "aria-labelledby": titleId,
  },
  createElement("h3", { className: "kv-empty-state__title", id: titleId }, title),
  description ? createElement("p", { className: "kv-empty-state__description" }, description) : null,
  action ? createElement("div", { className: "kv-empty-state__action" }, action) : null);
}
