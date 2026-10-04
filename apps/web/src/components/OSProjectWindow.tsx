import type { ReactNode } from "react";
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
  const busy = Boolean(agentStage && !["completed", "error"].includes(agentStage));
  const status = agentStage === "error"
    ? "Agent error"
    : busy
      ? "Building"
      : previewOnline
        ? "Preview live"
        : "Ready";

  if (minimized) {
    return (
      <section className="nexum-os-project nexum-os-project-minimized" aria-label={"NEXUM project " + projectName + " minimized"}>
        <div className="os-minimized-card">
          <span className="os-window-project-mark">{projectName.slice(0, 1).toUpperCase()}</span>
          <div><strong>{projectName}</strong><small>Workspace свернут</small></div>
          <button type="button" onClick={onRestore}>Открыть</button>
        </div>
      </section>
    );
  }

  return (
    <section className="nexum-os-project" aria-label={"NEXUM project " + projectName}>
      <div className="os-window-shell">
        <header className="os-window-titlebar">
          <div className="os-window-title">
            <span className="os-window-project-mark">{projectName.slice(0, 1).toUpperCase()}</span>
            <strong>{projectName}</strong>
            <span className="os-window-separator">/</span>
            <span>Builder</span>
          </div>
          <div className="os-window-status">
            <span className={"os-status-pulse " + (agentStage === "error" ? "error" : previewOnline || busy ? "active" : "")} />
            {status}
          </div>
          <div className="os-window-top-actions">
            <button type="button" onClick={onMinimize}>Свернуть</button>
            <button type="button" onClick={onClose}>Закрыть</button>
          </div>
        </header>

        <div className="os-window-toolbar">
          <div className="os-window-apps" role="tablist" aria-label="Builder tools">
            <button type="button" role="tab" aria-selected={activeTab === "preview"} className={activeTab === "preview" ? "active" : ""} onClick={() => onTabChange("preview")}>
              <span>◫</span> Preview
            </button>
            <button type="button" role="tab" aria-selected={activeTab === "agent"} className={activeTab === "agent" ? "active" : ""} onClick={onAgent}>
              <span>◉</span> Agent
            </button>
            <button type="button" role="tab" aria-selected={activeTab === "files"} className={activeTab === "files" ? "active" : ""} onClick={onFiles}>
              <span>□</span> Files
            </button>
            <button type="button" aria-pressed={workspaceMode === "code"} className={"os-window-code" + (workspaceMode === "code" ? " active" : "")} onClick={onCode}>
              <span>{"{ }"}</span> Code
            </button>
          </div>
          <div className="os-window-actions">
            <button type="button" onClick={onConnect}>Connect</button>
            <button type="button" onClick={onShare}>Share</button>
            <button type="button" className="primary" onClick={onOpenPreview}>Open preview ↗</button>
          </div>
        </div>

        <div className="os-window-body">{children}</div>
      </div>
    </section>
  );
}
