interface RightPanelProps {
  tab: "preview" | "terminal";
  onTabChange: (tab: "preview" | "terminal") => void;
  onOpenTerminal: () => void;
  projectName: string;
}

export function RightPanel({ tab, onTabChange, onOpenTerminal, projectName }: RightPanelProps) {
  return (
    <aside className={`right-panel ${tab === "terminal" ? "terminal-tab" : ""}`} aria-label="Workspace preview">
      <div className="panel-tabs" role="tablist">
        <button className={tab === "preview" ? "active" : ""} type="button" role="tab" aria-selected={tab === "preview"} onClick={() => onTabChange("preview")}>Preview</button>
        <button className={tab === "terminal" ? "active" : ""} type="button" role="tab" aria-selected={tab === "terminal"} onClick={() => onTabChange("terminal")}>Terminal</button>
      </div>
      {tab === "preview" ? (
        <div className="preview-content"><div className="preview-icon" aria-hidden="true">{projectName.slice(0, 1) || "N"}</div><div>{projectName} project preview</div><span className="coming-soon">Preview Manager not connected</span></div>
      ) : (
        <div className="terminal-empty"><span className="terminal-prompt">$</span><span>Terminal execution is not connected</span><button type="button" onClick={onOpenTerminal}>Open panel</button></div>
      )}
    </aside>
  );
}
