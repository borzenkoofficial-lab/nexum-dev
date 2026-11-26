import { createElement, type ReactElement } from "react";

export interface KvardSegmentedControlItem {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface KvardSegmentedControlProps {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  items: KvardSegmentedControlItem[];
}

export function KvardSegmentedControl({
  ariaLabel,
  value,
  onChange,
  items,
}: KvardSegmentedControlProps): ReactElement {
  return createElement(
    "div",
    {
      className: "kv-segmented",
      role: "group",
      "aria-label": ariaLabel,
    },
    ...items.map(item => createElement(
      "button",
      {
        key: item.id,
        type: "button",
        className: "kv-segmented__option",
        "aria-pressed": item.id === value,
        disabled: Boolean(item.disabled),
        onClick: () => onChange(item.id),
      },
      item.label,
    )),
  );
}
