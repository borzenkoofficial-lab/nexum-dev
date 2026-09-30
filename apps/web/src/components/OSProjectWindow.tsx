import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AgentStage } from "./types";

interface OSProjectWindowProps {
  projectName: string;
  projectId: string;
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
  projectId,
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
  useEffect(() => {
    if (!maximized) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMaximized(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximized]);
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
        <div className="os-minimized-card" role="button" tabIndex={0} onClick={onRestore} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onRestore(); }}>
          <span className="os-window-project-mark">{projectName.slice(0, 1).toUpperCase()}</span>
          <div><strong>{projectName}</strong><small>Workspace свернут в Dock</small></div>
          <button type="button" onClick={(event) => { event.stopPropagation(); onRestore(); }}>Открыть</button>
        </div>
      </section>
    );
  }

  return (
    <section className="nexum-os-project" aria-label={"NEXUM OS project " + projectName}>
      <div className={"os-window-shell" + (maximized ? " is-maximized" : "")}>
        <header className="os-window-titlebar" onDoubleClick={() => setMaximized((value) => !value)}>
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
            <button type="button" role="tab" aria-selected={workspaceMode === "code"} tabIndex={workspaceMode === "code" ? 0 : -1} className={"os-window-code" + (workspaceMode === "code" ? " active" : "")} onClick={onCode}>
              <span>{"{ }"}</span> Code
            </button>
          </div>
          <div className="os-window-actions">
            <button type="button" onClick={onConnect}>◇ Connect</button>
            <button type="button" onClick={onShare}>Share</button>
            <button type="button" className="primary" onClick={onOpenPreview}>Open ↗</button>
          </div>
        </div>

        <div className="os-window-context">
          <div>
            <span>PROJECT</span>
            <strong>{projectName}</strong>
          </div>
          <div>
            <span>ID</span>
            <strong>{projectId}</strong>
          </div>
          <div>
            <span>MODE</span>
            <strong>{workspaceMode === "code" ? "Code" : workspaceMode === "agent" ? "AI Agent" : workspaceMode === "files" ? "Files" : "Preview"}</strong>
          </div>
          <div className="os-context-right">
            <kbd>⌘</kbd><kbd>K</kbd><span>Command Center</span>
          </div>
        </div>

        <div className="os-window-body">{children}</div>
      </div>
    </section>
  );
}
