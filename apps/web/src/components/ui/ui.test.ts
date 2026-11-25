import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, type ReactElement } from "react";
import { KvardButton } from "./KvardButton.ts";
import { KvardField } from "./KvardField.ts";
import { KvardStatusBadge } from "./KvardStatusBadge.ts";

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
