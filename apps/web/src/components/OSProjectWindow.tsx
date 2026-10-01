import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { AgentStage } from "./types";

interface OSProjectWindowProps {
  projectName: string;
  previewOnline: boolean;
  agentStage: AgentStage;
  activeTab: "preview" | "files" | "agent";
  workspaceMode: "preview" | "agent" | "files" | "code";
  onTabChange: (tab: "preview" | "files" | "agent") => void;
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  minimized: boolean;
  onConnect: () => void;
  onShare: () => void;
  onOpenPreview: () => void;
  onCode: () => void;
  onAgent: () => void;
  onFiles: () => void;
  children: ReactNode;
}

export function OSProjectWindow({
  projectName,
  previewOnline,
  agentStage,
  activeTab,
  workspaceMode,
  onTabChange,
  onClose,
  onMinimize,
  onRestore,
  minimized,
  onConnect,
  onShare,
  onOpenPreview,
  onCode,
  onAgent,
  onFiles,
  children,
}: OSProjectWindowProps) {
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(true);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const interactionRef = useRef<{ type: "drag" | "resize"; startX: number; startY: number; startPosition: { x: number; y: number }; startSize: { width: number; height: number } | null } | null>(null);
  useEffect(() => {
    if (!maximized) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMaximized(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximized]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction || maximized) return;
      if (interaction.type === "drag") {
        const nextX = Math.round(interaction.startPosition.x + event.clientX - interaction.startX);
        const nextY = Math.round(interaction.startPosition.y + event.clientY - interaction.startY);
        const limitX = Math.max(0, Math.min(nextX, window.innerWidth - 240));
        const limitY = Math.max(0, Math.min(nextY, window.innerHeight - 120));
        setPosition({ x: limitX, y: limitY });
        return;
      }
      const start = interaction.startSize;
      if (!start) return;
      setSize({
        width: Math.max(720, Math.min(window.innerWidth - 24, start.width + event.clientX - interaction.startX)),
        height: Math.max(520, Math.min(window.innerHeight - 90, start.height + event.clientY - interaction.startY)),
      });
    };
    const onPointerUp = () => { interactionRef.current = null; };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [maximized]);

  function beginDrag(event: ReactPointerEvent<HTMLElement>) {
    if (maximized || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button")) return;
    setFocused(true);
    interactionRef.current = {
      type: "drag",
      startX: event.clientX,
      startY: event.clientY,
      startPosition: position,
      startSize: size,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function beginResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (maximized || event.button !== 0) return;
    setFocused(true);
    interactionRef.current = {
      type: "resize",
      startX: event.clientX,
      startY: event.clientY,
      startPosition: position,
      startSize: size ?? {
        width: event.currentTarget.parentElement?.getBoundingClientRect().width ?? 1100,
        height: event.currentTarget.parentElement?.getBoundingClientRect().height ?? 720,
      },
    };
    event.stopPropagation();
    event.preventDefault();
  }
  const busy = Boolean(agentStage && !["completed", "error"].includes(agentStage));
  const status = agentStage === "error"
    ? "Agent error"
    : busy
      ? "Agent working"
      : previewOnline
        ? "Preview ready"
        : "Ready";

  if (minimized) {
    return (
      <section className="nexum-os-project nexum-os-project-minimized" aria-label={"NEXUM OS project " + projectName + " minimized"}>
        <div className="os-minimized-card">
          <span className="os-window-project-mark">{projectName.slice(0, 1).toUpperCase()}</span>
          <div><strong>{projectName}</strong><small>Workspace свернут в Dock</small></div>
          <button type="button" onClick={onRestore}>Открыть</button>
        </div>
      </section>
    );
  }

  return (
    <section className="nexum-os-project" aria-label={"NEXUM OS project " + projectName}>
      <div className={"os-window-shell" + (focused ? " is-focused" : "") + (maximized ? " is-maximized nexum-os-maximized" : "")} style={!maximized ? ({ transform: `translate3d(${position.x}px, ${position.y}px, 0)`, ...(size ? { width: `${size.width}px`, height: `${size.height}px`, minHeight: "520px" } : {}) } as CSSProperties) : undefined} onPointerDown={() => setFocused(true)}>
        <header className="os-window-titlebar" onPointerDown={beginDrag} onDoubleClick={() => setMaximized((value) => !value)}>
          <div className="os-window-controls" aria-label="Window controls">
            <button type="button" className="os-window-dot close" aria-label="Close project" onClick={onClose} />
            <button type="button" className="os-window-dot minimize" aria-label="Minimize project" onClick={onMinimize} />
            <button type="button" className="os-window-dot maximize" aria-label="Maximize project" onClick={() => setMaximized((value) => !value)} />
          </div>
          <div className="os-window-title">
            <span className="os-window-project-mark">{projectName.slice(0, 1).toUpperCase()}</span>
            <strong>{projectName}</strong>
            <span className="os-window-separator">/</span>
            <span>Workspace</span>
          </div>
          <div className="os-window-status">
            <span className={"os-status-pulse " + (agentStage === "error" ? "error" : previewOnline || busy ? "active" : "")} />
            {status}
          </div>
        </header>

        <div className="os-window-toolbar">
          <div className="os-window-apps" role="tablist" aria-label="Workspace applications">
            <button type="button" role="tab" aria-selected={activeTab === "preview"} tabIndex={activeTab === "preview" ? 0 : -1} className={activeTab === "preview" ? "active" : ""} onClick={() => onTabChange("preview")}>
              <span>◫</span> Preview
            </button>
            <button type="button" role="tab" aria-selected={activeTab === "agent"} tabIndex={activeTab === "agent" ? 0 : -1} className={activeTab === "agent" ? "active" : ""} onClick={onAgent}>
              <span>✦</span> AI Agent
            </button>
            <button type="button" role="tab" aria-selected={activeTab === "files"} tabIndex={activeTab === "files" ? 0 : -1} className={activeTab === "files" ? "active" : ""} onClick={onFiles}>
              <span>□</span> Files
            </button>
            <button type="button" aria-pressed={workspaceMode === "code"} tabIndex={workspaceMode === "code" ? 0 : -1} className={"os-window-code" + (workspaceMode === "code" ? " active" : "")} onClick={onCode}>
              <span>{"{ }"}</span> Code
            </button>
          </div>
          <div className="os-window-actions">
            <button type="button" onClick={onConnect}>◇ Connect</button>
            <button type="button" onClick={onShare}>Share</button>
            <button type="button" className="primary" onClick={onOpenPreview}>Open ↗</button>
          </div>
        </div>
        <div className="os-window-resize-handle" role="presentation" onPointerDown={beginResize} />

        <div className="os-window-body">{children}</div>
      </div>
    </section>
  );
}
