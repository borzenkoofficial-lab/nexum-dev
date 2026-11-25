import { cloneElement, createElement, type ReactElement } from "react";

type FieldControlProps = {
  id?: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

export interface KvardFieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactElement;
}

export function KvardField({
  id,
  label,
  hint,
  error,
  required = false,
  className,
  children,
}: KvardFieldProps): ReactElement {
  const childProps = children.props as unknown as FieldControlProps;
  const describedBy = [
    childProps["aria-describedby"],
    hint ? `${id}-hint` : undefined,
    error ? `${id}-error` : undefined,
  ].filter((value): value is string => Boolean(value)).join(" ");

  const control = cloneElement(children as ReactElement<FieldControlProps>, {
    id,
    required: required || Boolean(childProps.required),
    "aria-invalid": error ? true : childProps["aria-invalid"],
    "aria-describedby": describedBy || undefined,
  });

  const classes = ["kv-field", error ? "is-invalid" : undefined, className].filter(Boolean).join(" ");

  return createElement(
    "div",
    { className: classes, "data-invalid": error ? "true" : undefined },
    createElement(
      "label",
      { className: "kv-field__label", htmlFor: id },
      label,
      required ? createElement("span", { className: "kv-field__required", "aria-hidden": true }, "*") : null,
    ),
    createElement("div", { className: "kv-field__control" }, control),
    hint ? createElement("p", { id: `${id}-hint`, className: "kv-field__hint" }, hint) : null,
    error ? createElement("p", { id: `${id}-error`, className: "kv-field__error", role: "alert" }, error) : null,
  );
}
