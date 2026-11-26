import { createElement, type ReactNode } from "react";

export interface KvardPageHeaderProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
  actionsClassName?: string;
  eyebrowClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  titleId?: string;
  descriptionId?: string;
  headingLevel?: "h1" | "h2" | "h3";
}

/**
 * Shared page/section heading structure.
 * Consumer classes intentionally remain responsible for page-specific visual
 * treatment; this component standardizes heading semantics and content slots.
 */
export function KvardPageHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
  contentClassName,
  actionsClassName,
  eyebrowClassName,
  titleClassName,
  descriptionClassName,
  titleId,
  descriptionId,
  headingLevel = "h1",
}: KvardPageHeaderProps) {
  const rootClassName = ["kv-page-header", className].filter(Boolean).join(" ");
  const contentClass = ["kv-page-header__content", contentClassName].filter(Boolean).join(" ");
  const actionClass = ["kv-page-header__actions", actionsClassName].filter(Boolean).join(" ");

  return createElement(
    "header",
    {
      className: rootClassName,
      "aria-labelledby": titleId,
      "aria-describedby": descriptionId,
    },
    createElement(
      "div",
      { className: contentClass },
      eyebrow
        ? createElement("span", {
            className: ["kv-page-header__eyebrow", eyebrowClassName].filter(Boolean).join(" "),
          }, eyebrow)
        : null,
      createElement(headingLevel, {
        id: titleId,
        className: ["kv-page-header__title", titleClassName].filter(Boolean).join(" "),
      }, title),
      description
        ? createElement("p", {
            id: descriptionId,
            className: ["kv-page-header__description", descriptionClassName].filter(Boolean).join(" "),
          }, description)
        : null,
    ),
    actions
      ? createElement("div", { className: actionClass }, actions)
      : null,
  );
}
