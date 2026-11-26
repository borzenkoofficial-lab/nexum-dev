import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

export interface KvardDialogProps {
  open: boolean;
  onClose: () => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  backdropClassName?: string;
  dialogClassName?: string;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => (
    !element.hidden
    && !element.hasAttribute("disabled")
    && element.getAttribute("aria-hidden") !== "true"
    && !element.closest("[hidden], [inert]")
  ));
}

export function handleKvardDialogKeyDown(
  event: KeyboardEvent,
  dialog: HTMLElement,
  onClose: () => void,
  closeOnEscape = true,
): void {
  if (event.key === "Escape" && closeOnEscape) {
    event.preventDefault();
    event.stopPropagation();
    onClose();
    return;
  }

  if (event.key !== "Tab") return;

  const focusable = getFocusableElements(dialog);
  if (focusable.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = dialog.ownerDocument.activeElement;

  if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
    event.preventDefault();
    first?.focus();
  }
}

export function KvardDialog({
  open,
  onClose,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  closeOnEscape = true,
  closeOnBackdrop = true,
  backdropClassName = "kv-dialog-backdrop",
  dialogClassName = "kv-dialog",
  children,
}: KvardDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const initialFocus = dialog.querySelector<HTMLElement>("[autofocus]") ?? getFocusableElements(dialog)[0] ?? dialog;
    initialFocus.focus();

    return () => {
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={backdropClassName}
      role="presentation"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={dialogClassName}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
          handleKvardDialogKeyDown(event.nativeEvent, event.currentTarget, onClose, closeOnEscape);
        }}
      >
        {children}
      </div>
    </div>
  );
}
