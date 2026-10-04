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

export function OSProjectWindow(props: OSProjectWindowProps) {
  const {
    projectName, previewOnline, agentStage, activeTab, workspaceMode,
    onTabChange, onClose, onMinimize, onRestore, minimized,
    onConnect, onShare, onOpenPreview, onCode, onAgent, onFiles, children,
  } = props;

  const busy = Boolean(agentStage && !["completed", "error"].includes(agentStage));
  const status = agentStage === "error" ? "Agent error" : busy ? "Building" : previewOnline ? "Preview live" : "Ready";

  if (minimized) {
    return (
      <section className="nexum-builder-minimized" aria-label={"NEXUM project " + projectName + " minimized"}>
        <button type="button" className="nexum-builder-restore" onClick={onRestore}>
          <span className="nexum-builder-mark">{projectName.slice(0, 1).toUpperCase()}</span>
          <span><strong>{projectName}</strong><small>Project minimized</small></span>
          <b>Open</b>
        </button>
      </section>
    );
  }

  return (
    <section className="nexum-builder-root" aria-label={"NEXUM builder " + projectName}>
      <header className="nexum-builder-topbar">
        <div className="nexum-builder-brand">
          <span className="nexum-builder-mark">{projectName.slice(0, 1).toUpperCase()}</span>
          <div><strong>{projectName}</strong><small>Builder</small></div>
        </div>

        <nav className="nexum-builder-modebar" aria-label="Project tools">
          <button className={activeTab === "preview" && workspaceMode !== "code" ? "active" : ""} onClick={() => onTabChange("preview")} type="button">Preview</button>
          <button className={activeTab === "agent" ? "active" : ""} onClick={onAgent} type="button">Agent</button>
          <button className={activeTab === "files" ? "active" : ""} onClick={onFiles} type="button">Files</button>
          <button className={workspaceMode === "code" ? "active" : ""} onClick={onCode} type="button">Code</button>
        </nav>

        <div className="nexum-builder-actions">
          <span className={"nexum-builder-status " + (busy ? "busy" : agentStage === "error" ? "error" : previewOnline ? "online" : "")}>
            <i /> {status}
          </span>
          <button type="button" onClick={onConnect}>Connect</button>
          <button type="button" onClick={onShare}>Share</button>
          <button type="button" className="nexum-builder-primary" onClick={onOpenPreview}>Open preview ↗</button>
          <button type="button" className="nexum-builder-icon" onClick={onMinimize} aria-label="Minimize project">—</button>
          <button type="button" className="nexum-builder-icon" onClick={onClose} aria-label="Close project">×</button>
        </div>
      </header>

      <div className="nexum-builder-canvas">{children}</div>
    </section>
  );
}
