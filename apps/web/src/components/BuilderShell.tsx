import type { ReactNode } from "react";
import type { AgentStage } from "./types";

type Tool = "preview" | "agent" | "files" | "code";

interface BuilderShellProps {
  projectName: string;
  previewOnline: boolean;
  agentStage: AgentStage;
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
  onClose: () => void;
  onConnect: () => void;
  onShare: () => void;
  onOpenPreview: () => void;
  children: ReactNode;
}

export function BuilderShell({
  projectName, previewOnline, agentStage, activeTool,
  onToolChange, onClose, onConnect, onShare, onOpenPreview, children,
}: BuilderShellProps) {
  const building = Boolean(agentStage && !["completed", "error"].includes(agentStage));
  const status = agentStage === "error" ? "Error" : building ? "Building" : previewOnline ? "Live" : "Ready";

  return (
    <section className="nx-builder" aria-label={"NEXUM Builder — " + projectName}>
      <header className="nx-builder-header">
        <button className="nx-builder-project" type="button" onClick={onClose} aria-label="Back to projects">
          <span className="nx-builder-logo">N</span>
          <span className="nx-builder-project-copy">
            <strong>{projectName}</strong>
            <small>Project</small>
          </span>
        </button>

        <nav className="nx-builder-nav" aria-label="Builder tools">
          {(["preview", "agent", "files", "code"] as Tool[]).map((tool) => (
            <button key={tool} type="button" className={activeTool === tool ? "active" : ""} onClick={() => onToolChange(tool)}>
              {tool === "preview" ? "Preview" : tool === "agent" ? "Agent" : tool === "files" ? "Files" : "Code"}
            </button>
          ))}
        </nav>

        <div className="nx-builder-header-actions">
          <span className={"nx-builder-status " + (building ? "building" : agentStage === "error" ? "error" : previewOnline ? "live" : "")}>
            <i />{status}
          </span>
          <button type="button" onClick={onConnect}>Connect</button>
          <button type="button" onClick={onShare}>Share</button>
          <button className="nx-builder-open" type="button" onClick={onOpenPreview}>Open preview ↗</button>
        </div>
      </header>
      <div className="nx-builder-body">{children}</div>
    </section>
  );
}
