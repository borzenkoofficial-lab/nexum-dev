import { createElement, type KeyboardEvent, type ReactElement } from "react";

export interface KvardTabItem {
  id: string;
  label: string;
  badge?: string | number;
  disabled?: boolean;
}

export interface KvardTabsProps {
  id: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  items: KvardTabItem[];
}

export function KvardTabs({
  id,
  ariaLabel,
  value,
  onChange,
  items,
}: KvardTabsProps): ReactElement {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const navigationKeys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!navigationKeys.includes(event.key)) return;

    const enabledItems = items.filter(item => !item.disabled);
    if (enabledItems.length < 2) return;

    const currentId = (event.target as HTMLElement).dataset.tabId;
    const currentIndex = enabledItems.findIndex(item => item.id === currentId);
    if (currentIndex < 0) return;

    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = enabledItems.length - 1;
    else if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % enabledItems.length;
    else nextIndex = (currentIndex - 1 + enabledItems.length) % enabledItems.length;

    const nextItem = enabledItems[nextIndex];
    if (!nextItem) return;

    event.preventDefault();
    onChange(nextItem.id);
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)');
    buttons[nextIndex]?.focus();
  }

  return createElement(
    "div",
    {
      id,
      className: "kv-tabs",
      role: "tablist",
      "aria-label": ariaLabel,
      "aria-orientation": "horizontal",
      onKeyDown: handleKeyDown,
    },
    ...items.map(item => {
      const selected = item.id === value;
      const hasBadge = item.badge !== undefined && item.badge !== null && item.badge !== "";
      const label = createElement("span", { className: "kv-tabs__label" }, item.label);
      const badge = hasBadge
        ? createElement("span", { className: "kv-tabs__badge", "aria-hidden": true }, String(item.badge))
        : null;

      return createElement(
        "button",
        {
          key: item.id,
          id: `${id}-tab-${item.id}`,
          type: "button",
          role: "tab",
          className: "kv-tabs__tab",
          "aria-selected": selected,
          "aria-controls": `${id}-panel-${item.id}`,
          "aria-label": hasBadge ? `${item.label}, ${item.badge}` : undefined,
          tabIndex: selected ? 0 : -1,
          disabled: Boolean(item.disabled),
          "data-tab-id": item.id,
          onClick: () => onChange(item.id),
        },
        label,
        badge,
      );
    }),
  );
}
