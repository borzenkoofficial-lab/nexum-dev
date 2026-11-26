import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, type ReactElement } from "react";
import { KvardButton } from "./KvardButton.ts";
import { KvardField } from "./KvardField.ts";
import { KvardStatusBadge } from "./KvardStatusBadge.ts";
import { KvardTabs } from "./KvardTabs.ts";

type ElementShape = { type: unknown; props: Record<string, unknown> };

function propsOf(element: { props: unknown }): Record<string, unknown> {
  return element.props as unknown as Record<string, unknown>;
}

function childrenOf(props: Record<string, unknown>): ElementShape[] {
  const children = props.children;
  return (Array.isArray(children) ? children : [children]).filter(Boolean) as ElementShape[];
}

test("KvardButton preserves native type, variant, size, accessible name and loading semantics", () => {
  const button = KvardButton({
    variant: "primary",
    size: "sm",
    type: "submit",
    loading: true,
    "aria-label": "Сохранить",
    children: "Сохранить",
  });
  const props = propsOf(button);

  assert.equal(props.type, "submit");
  assert.match(String(props.className), /kv-button--primary/);
  assert.match(String(props.className), /kv-button--sm/);
  assert.equal(props.disabled, true);
  assert.equal(props["aria-busy"], true);
  assert.equal(props["aria-label"], "Сохранить");

  const [content, spinner] = childrenOf(props);
  assert.equal(content.props.className, "kv-button__content");
  assert.equal(spinner.props.className, "kv-button__spinner");
  assert.equal(spinner.props["aria-hidden"], true);
});

test("uses safe defaults for ordinary buttons", () => {
  const props = propsOf(KvardButton({ children: "Открыть" }));

  assert.equal(props.type, "button");
  assert.match(String(props.className), /kv-button--secondary/);
  assert.match(String(props.className), /kv-button--md/);
  assert.equal(props.disabled, false);
  assert.equal(props["aria-busy"], undefined);
});

test("KvardField connects its label, hint and error to the native control", () => {
  const field = KvardField({
    id: "email",
    label: "Рабочая почта",
    hint: "Используйте корпоративный адрес",
    error: "Некорректный адрес",
    required: true,
    children: createElement("input", { "aria-describedby": "external-help" }) as ReactElement,
  });
  const fieldProps = propsOf(field);
  const [label, control, hint, error] = childrenOf(fieldProps);
  const input = childrenOf(propsOf(control))[0];
  const inputProps = input.props;

  assert.equal(label.props.htmlFor, "email");
  assert.equal(inputProps.id, "email");
  assert.equal(inputProps.required, true);
  assert.equal(inputProps["aria-invalid"], true);
  assert.equal(inputProps["aria-describedby"], "external-help email-hint email-error");
  assert.equal(hint.props.id, "email-hint");
  assert.equal(error.props.id, "email-error");
  assert.equal(error.props.role, "alert");
});

test("KvardStatusBadge exposes a visible label and semantic tone class", () => {
  const badge = KvardStatusBadge({ tone: "success", label: "Опубликован" });
  const props = propsOf(badge);

  assert.match(String(props.className), /kv-status-badge--success/);
  assert.equal(props.children, "Опубликован");
});


test("KvardTabs exposes linked tab semantics and an accessible badge label", () => {
  const onChange = () => undefined;
  const tabs = KvardTabs({
    id: "business",
    ariaLabel: "Разделы бизнес-агентов",
    value: "approvals",
    onChange,
    items: [
      { id: "agents", label: "Агенты" },
      { id: "approvals", label: "Согласования", badge: 3 },
      { id: "usage", label: "Использование", disabled: true },
    ],
  });
  const props = propsOf(tabs);
  const [agents, approvals, usage] = childrenOf(props);
  const agentsProps = propsOf(agents);
  const approvalsProps = propsOf(approvals);
  const usageProps = propsOf(usage);
  const [approvalLabel, badge] = childrenOf(approvalsProps);

  assert.equal(props.role, "tablist");
  assert.equal(props["aria-label"], "Разделы бизнес-агентов");
  assert.equal(props["aria-orientation"], "horizontal");
  assert.equal(agentsProps.id, "business-tab-agents");
  assert.equal(agentsProps["aria-controls"], "business-panel-agents");
  assert.equal(agentsProps["aria-selected"], false);
  assert.equal(agentsProps.tabIndex, -1);
  assert.equal(approvalsProps.id, "business-tab-approvals");
  assert.equal(approvalsProps["aria-selected"], true);
  assert.equal(approvalsProps.tabIndex, 0);
  assert.equal(approvalLabel.props.children, "Согласования");
  assert.equal(approvalsProps["aria-label"], "Согласования, 3");
  assert.equal(badge.props["aria-hidden"], true);
  assert.equal(usageProps.disabled, true);
  assert.equal(usageProps.tabIndex, -1);
});

test("KvardTabs moves focus and selection with wrapping arrow-key navigation", () => {
  const selected: string[] = [];
  const focused: string[] = [];
  const buttons = [
    { dataset: { tabId: "agents" }, focus: () => focused.push("agents") },
    { dataset: { tabId: "approvals" }, focus: () => focused.push("approvals") },
    { dataset: { tabId: "usage" }, focus: () => focused.push("usage") },
  ];
  const tabs = KvardTabs({
    id: "business",
    ariaLabel: "Разделы",
    value: "approvals",
    onChange: value => selected.push(value),
    items: [
      { id: "agents", label: "Агенты" },
      { id: "approvals", label: "Согласования" },
      { id: "usage", label: "Использование", disabled: true },
    ],
  });
  const props = propsOf(tabs);
  let prevented = false;
  const event = {
    key: "ArrowRight",
    target: buttons[1],
    currentTarget: { querySelectorAll: () => buttons },
    preventDefault: () => { prevented = true; },
  };

  (props.onKeyDown as (value: unknown) => void)(event);
  assert.equal(prevented, true);
  assert.deepEqual(selected, ["agents"]);
  assert.deepEqual(focused, ["agents"]);
});
