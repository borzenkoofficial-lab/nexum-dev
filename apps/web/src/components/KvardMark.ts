import { createElement, type ReactElement } from "react";

export interface KvardMarkProps {
  size?: number;
  label?: string;
  className?: string;
}

/**
 * Canonical КВАРД brand mark.
 * Geometry is kept in sync with apps/web/public/favicon.svg.
 */
export function KvardMark({ size = 32, label, className }: KvardMarkProps): ReactElement {
  const classes = ["kvard-mark", className].filter(Boolean).join(" ");

  return createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 64 64",
      width: size,
      height: size,
      className: classes,
      focusable: "false",
      role: label ? "img" : undefined,
      "aria-label": label,
      "aria-hidden": label ? undefined : true,
    },
    createElement("rect", {
      width: 64,
      height: 64,
      rx: 15,
      fill: "var(--kv-brand-ink, #24213A)",
    }),
    createElement("path", {
      d: "M19 14v36M22 32l24-18M24 31l22 19",
      fill: "none",
      stroke: "var(--kv-on-brand, #FFFFFF)",
      strokeWidth: 6.5,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    }),
  );
}
