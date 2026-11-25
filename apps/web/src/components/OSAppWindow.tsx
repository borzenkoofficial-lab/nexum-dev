import type { CSSProperties, ReactNode } from "react";

interface OSAppWindowProps {
  title: string;
  subtitle?: string;
  icon?: string;
  status?: string;
  children: ReactNode;
  onClose: () => void;
  onMinimize?: () => void;
  minHeight?: string;
}

export function OSAppWindow({ title, children, minHeight }: OSAppWindowProps) {
  return (
    <section className="nx-system-window-layer" aria-label={title}>
      <div
        className="nx-system-window"
        style={minHeight ? { "--nx-window-min-height": minHeight } as CSSProperties : undefined}
      >
        <div className="nx-app-window-content">{children}</div>
      </div>
    </section>
  );
}
