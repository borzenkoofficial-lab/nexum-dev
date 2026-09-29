import { useEffect, useMemo, useState } from "react";

export type NexumOSWindowMode = "preview" | "agent" | "files" | "code";

interface Props {
  projectName?: string;
  projects?: Array<{ id: string; name: string; active?: boolean; minimized?: boolean }>;
  onSelectProject?: (id: string) => void;
  mode: NexumOSWindowMode;
  running: boolean;
  minimized: boolean;
  onSelectMode: (mode: NexumOSWindowMode) => void;
  onMinimize: () => void;
  onRestore: () => void;
  onClose: () => void;
}

const apps = [
  { id: "agent" as const, label: "AI Agent", glyph: "✦" },
  { id: "preview" as const, label: "Preview", glyph: "◫" },
  { id: "files" as const, label: "Files", glyph: "□" },
  { id: "code" as const, label: "Code", glyph: "{ }" },
];

export function NexumApplicationManager({ projectName, projects, running, minimized, mode, onSelectMode, onMinimize, onRestore, onClose, onSelectProject }: Props) {
  const [open, setOpen] = useState(false);
  const windows = useMemo(() => apps, []);
  const projectItems = projects ?? (projectName ? [{ id: "active", name: projectName, active: true, minimized }] : []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "tab") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!running) return null;

  return <>
    <div className="nexum-os-app-strip" aria-label="Application Manager">
      <span className="nexum-os-app-strip-title">WINDOWS</span>
      {windows.map((item) => (
        <button key={item.id} type="button" className={"nexum-os-app-chip" + (mode === item.id && !minimized ? " active" : "")} onClick={() => { if (minimized) onRestore(); onSelectMode(item.id); }}>
          <i>{item.glyph}</i><span>{item.label}</span>
        </button>
      ))}
      <button type="button" className="nexum-os-app-more" onClick={() => setOpen(true)} aria-label="Application Manager">⌘⇥</button>
    </div>
    {open && <div className="nexum-os-switcher-backdrop" role="dialog" aria-modal="true" aria-label="Application Manager" onMouseDown={() => setOpen(false)}>
      <div className="nexum-os-switcher" onMouseDown={(event) => event.stopPropagation()}>
        <div className="nexum-os-switcher-head"><span>APPLICATION MANAGER</span><small>{projectName ?? "NEXUM"} · {windows.length} windows</small></div>
        <div className="nexum-os-switcher-projects" aria-label="Running projects">
          {projectItems.map((project) => <button key={project.id} type="button" className={"nexum-os-project-chip" + (project.active ? " active" : "")} onClick={() => onSelectProject?.(project.id)}>
            <span>{project.name.slice(0, 1).toUpperCase()}</span><strong>{project.name}</strong><small>{project.minimized ? "Minimized" : project.active ? "Active project" : "Running"}</small>
          </button>)}
        </div>
        <div className="nexum-os-switcher-grid">
          {windows.map((item) => <button key={item.id} type="button" className={"nexum-os-switcher-card" + (mode === item.id && !minimized ? " active" : "")} onClick={() => { onRestore(); onSelectMode(item.id); setOpen(false); }}>
            <span className="nexum-os-switcher-icon">{item.glyph}</span><strong>{item.label}</strong><small>{mode === item.id && !minimized ? "Active window" : "Open window"}</small>
          </button>)}
        </div>
        <div className="nexum-os-switcher-actions">
          <button type="button" onClick={minimized ? onRestore : onMinimize}>{minimized ? "Restore workspace" : "Minimize workspace"}</button>
          <button type="button" className="danger" onClick={() => { onClose(); setOpen(false); }}>Close project</button>
        </div>
      </div>
    </div>}
  </>;
}