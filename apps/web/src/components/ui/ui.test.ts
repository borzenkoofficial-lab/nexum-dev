import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, type ReactElement } from "react";
import { KvardButton } from "./KvardButton.ts";
import { KvardField } from "./KvardField.ts";
import { KvardStatusBadge } from "./KvardStatusBadge.ts";
import { KvardTabs } from "./KvardTabs.ts";
import { KvardSegmentedControl } from "./KvardSegmentedControl.ts";

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
  assert.equal(props.className, "kv-tabs");
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

test("KvardTabs accepts a consumer class without replacing its shared class", () => {
  const tabs = KvardTabs({
    id: "builder",
    className: "nx-builder-nav",
    ariaLabel: "Инструменты проекта",
    value: "preview",
    onChange: () => undefined,
    items: [{ id: "preview", label: "Предпросмотр" }],
  });
  assert.equal(propsOf(tabs).className, "kv-tabs nx-builder-nav");
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

  (props.onKeyDown as unknown as (value: typeof event) => void)(event);
  assert.equal(prevented, true);
  assert.deepEqual(selected, ["agents"]);
  assert.deepEqual(focused, ["agents"]);
});


test("KvardSegmentedControl exposes a labelled toggle group with controlled pressed state", () => {
  const selected: string[] = [];
  const control = KvardSegmentedControl({
    ariaLabel: "Размер предпросмотра",
    value: "tablet",
    onChange: value => selected.push(value),
    items: [
      { id: "desktop", label: "Компьютер" },
      { id: "tablet", label: "Планшет" },
      { id: "mobile", label: "Телефон", disabled: true },
    ],
  });
  const props = propsOf(control);
  const [desktop, tablet, mobile] = childrenOf(props);

  assert.equal(props.role, "group");
  assert.equal(props["aria-label"], "Размер предпросмотра");
  assert.equal(props.className, "kv-segmented");
  assert.equal(propsOf(desktop)["aria-pressed"], false);
  assert.equal(propsOf(tablet)["aria-pressed"], true);
  assert.equal(propsOf(mobile).disabled, true);
  (propsOf(desktop).onClick as () => void)();
  assert.deepEqual(selected, ["desktop"]);
});


test("KvardDialog renders an accessible modal frame with stable naming", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { KvardDialog } = await import("./KvardDialog.ts");
  const markup = renderToStaticMarkup(createElement(KvardDialog, {
    open: true,
    onClose: () => undefined,
    ariaLabelledBy: "dialog-title",
    ariaDescribedBy: "dialog-description",
    backdropClassName: "test-backdrop",
    dialogClassName: "test-dialog",
    children: createElement("div", null,
      createElement("h2", { id: "dialog-title" }, "Заголовок"),
      createElement("p", { id: "dialog-description" }, "Описание"),
    ),
  }));

  assert.match(markup, /class="[^"]*test-backdrop/);
  assert.match(markup, /role="dialog"/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /aria-labelledby="dialog-title"/);
  assert.match(markup, /aria-describedby="dialog-description"/);
  assert.match(markup, /tabindex="-1"/);
});

test("KvardDialog closes on Escape and prevents the key from reaching page shortcuts", async () => {
  const { handleKvardDialogKeyDown } = await import("./KvardDialog.ts");
  let closed = 0;
  let prevented = 0;
  let stopped = 0;
  const event = {
    key: "Escape",
    preventDefault: () => { prevented += 1; },
    stopPropagation: () => { stopped += 1; },
  } as unknown as KeyboardEvent;

  handleKvardDialogKeyDown(event, {} as HTMLElement, () => { closed += 1; });
  assert.equal(closed, 1);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
});

test("KvardDialog traps Tab focus at both ends of the dialog", async () => {
  const { handleKvardDialogKeyDown } = await import("./KvardDialog.ts");
  const focused: string[] = [];
  const makeFocusable = (name: string) => ({
    hidden: false,
    hasAttribute: () => false,
    getAttribute: () => null,
    closest: () => null,
    focus: () => focused.push(name),
  });
  const first = makeFocusable("first");
  const last = makeFocusable("last");
  const ownerDocument = { activeElement: first };
  const dialog = {
    querySelectorAll: () => [first, last],
    contains: () => true,
    ownerDocument,
    focus: () => focused.push("dialog"),
  } as unknown as HTMLElement;

  const backwards = {
    key: "Tab",
    shiftKey: true,
    currentTarget: dialog,
    relatedTarget: null,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  } as unknown as KeyboardEvent;
  handleKvardDialogKeyDown(backwards, dialog, () => undefined);
  assert.deepEqual(focused, ["last"]);

  focused.length = 0;
  const forwards = {
    key: "Tab",
    shiftKey: false,
    currentTarget: dialog,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  } as unknown as KeyboardEvent;
  ownerDocument.activeElement = last;
  handleKvardDialogKeyDown(forwards, dialog, () => undefined);
  assert.deepEqual(focused, ["first"]);
});


test("KvardAlert uses assertive semantics for errors and polite semantics for notices", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { KvardAlert } = await import("./KvardAlert.ts");
  const error = renderToStaticMarkup(createElement(KvardAlert, {
    tone: "danger",
    title: "Не удалось сохранить",
    children: "Проверьте соединение",
    onDismiss: () => undefined,
  }));
  const notice = renderToStaticMarkup(createElement(KvardAlert, {
    tone: "success",
    children: "Изменения сохранены",
  }));

  assert.match(error, /role="alert"/);
  assert.match(error, /aria-live="assertive"/);
  assert.match(error, /Не удалось сохранить/);
  assert.match(error, /aria-label="Закрыть уведомление"/);
  assert.match(notice, /role="status"/);
  assert.match(notice, /aria-live="polite"/);
});

test("KvardToast is a polite atomic live region and preserves consumer classes", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { KvardToast } = await import("./KvardToast.ts");
  const markup = renderToStaticMarkup(createElement(KvardToast, {
    tone: "info",
    className: "toast",
    children: "Проект создан",
  }));

  assert.match(markup, /class="kv-toast kv-toast--info toast"/);
  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /aria-atomic="true"/);
  assert.match(markup, /Проект создан/);
});

test("KvardEmptyState exposes a labelled section, description and real action slot", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { KvardEmptyState } = await import("./KvardEmptyState.ts");
  const markup = renderToStaticMarkup(createElement(KvardEmptyState, {
    title: "Пока нет агентов",
    description: "Создайте первого агента для этой организации.",
    action: createElement("button", { type: "button" }, "Создать агента"),
    className: "kv-business-empty",
  }));

  assert.match(markup, /role="region"/);
  assert.match(markup, /aria-labelledby=/);
  assert.match(markup, /Пока нет агентов/);
  assert.match(markup, /Создайте первого агента/);
  assert.match(markup, /Создать агента/);
});


test("KvardSurface exposes semantic element, variant, padding and consumer classes", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { KvardSurface } = await import("./KvardSurface.ts");
  const markup = renderToStaticMarkup(createElement(KvardSurface, {
    as: "section",
    variant: "raised",
    padding: "lg",
    className: "kv-home-create-section",
    "aria-label": "Создание проекта",
    children: "Содержимое",
  }));

  assert.match(markup, /^<section/);
  assert.match(markup, /class="kv-surface kv-surface--raised kv-surface--padding-lg kv-home-create-section"/);
  assert.match(markup, /aria-label="Создание проекта"/);
  assert.match(markup, /Содержимое/);
});

test("KvardSurface defaults to a neutral div surface without implicit interaction semantics", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { KvardSurface } = await import("./KvardSurface.ts");
  const markup = renderToStaticMarkup(createElement(KvardSurface, {
    children: "Карточка",
  }));

  assert.match(markup, /^<div class="kv-surface kv-surface--default kv-surface--padding-md">/);
  assert.doesNotMatch(markup, /role="button"|tabindex=/i);
});
