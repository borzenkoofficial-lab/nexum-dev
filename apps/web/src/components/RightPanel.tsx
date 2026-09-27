interface RightPanelProps {
  tab: "preview" | "terminal";
  onTabChange: (tab: "preview" | "terminal") => void;
  onOpenTerminal: () => void;
  projectName: string;
  projectId: string;
  previewOnline: boolean;
  previewKey: number;
  onRefreshPreview: () => void;
}

export function RightPanel({
  tab,
  onTabChange,
  onOpenTerminal,
  projectName,
  projectId,
  previewOnline,
  previewKey,
  onRefreshPreview,
}: RightPanelProps) {
  const previewUrl = projectId ? `/api/preview/${projectId}/index.html` : "";

  return (
    <aside className={`right-panel ${tab === "terminal" ? "terminal-tab" : ""}`} aria-label="Workspace preview">
      <div className="panel-tabs" role="tablist">
        <button className={tab === "preview" ? "active" : ""} type="button" role="tab" aria-selected={tab === "preview"} onClick={() => onTabChange("preview")}>Preview</button>
        <button className={tab === "terminal" ? "active" : ""} type="button" role="tab" aria-selected={tab === "terminal"} onClick={() => onTabChange("terminal")}>Terminal</button>
        {tab === "preview" && previewOnline && (
          <button className="preview-refresh" type="button" onClick={onRefreshPreview} aria-label="Refresh preview">↻</button>
        )}
      </div>

      {tab === "preview" ? (
        previewOnline ? (
          <div className="preview-frame-wrap">
            <iframe
              key={previewKey}
              className="preview-frame"
              title={`${projectName} live preview`}
              src={previewUrl}
              sandbox="allow-scripts allow-forms allow-modals"
            />
          </div>
        ) : (
          <div className="preview-content">
            <div className="preview-icon" aria-hidden="true">{projectName.slice(0, 1) || "N"}</div>
            <strong>{projectName}</strong>
            <div className="coming-soon">Preview is waiting for an index.html</div>
            <span>Ask the Agent: “Создай приложение и запусти preview”</span>
          </div>
        )
      ) : (
        <div className="terminal-empty">
          <span className="terminal-prompt">$</span>
          <span>Use the Agent to run safe build and test commands.</span>
          <button type="button" onClick={onOpenTerminal}>Open panel</button>
        </div>
      )}
    </aside>
  );
}
