import { useEffect, useState } from "react";
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

export function OSAppWindow({ title, subtitle, icon = "N", status = "Готово", children, onClose, onMinimize, minHeight }: OSAppWindowProps) {
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    if (!maximized) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMaximized(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximized]);

  return (
    <section className={"nx-system-window-layer" + (maximized ? " is-maximized" : "")} onPointerDown={() => setFocused(true)}>
      <div className={"nx-system-window" + (focused ? " is-focused" : "") + (maximized ? " is-maximized" : "")} style={minHeight ? {"--nx-window-min-height": minHeight} as CSSProperties : undefined}>
        <header className="nx-app-titlebar" onDoubleClick={() => setMaximized((value) => !value)}>
          <div className="nx-app-window-controls" aria-label={"Управление окном " + title}>
            <button type="button" className="close" aria-label="Закрыть" onClick={onClose} />
            {onMinimize && <button type="button" className="minimize" aria-label="Свернуть" onClick={onMinimize} />}
            <button type="button" className="maximize" aria-label={maximized ? "Восстановить" : "Развернуть"} onClick={() => setMaximized((value) => !value)} />
          </div>
          <div className="nx-app-window-title">
            <span className="nx-app-window-icon">{icon}</span>
            <div><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}</div>
          </div>
          <div className="nx-app-window-state"><i />{status}</div>
        </header>
        <div className="nx-app-window-content">{children}</div>
      </div>
    </section>
  );
}
