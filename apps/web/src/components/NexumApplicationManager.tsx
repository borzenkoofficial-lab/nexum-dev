import { useEffect, useMemo, useState } from "react";

export type NexumOSWindowMode = "preview" | "agent" | "files" | "code";

interface Props {
  projectName?: string;
  projects?: Array<{ id: string; name: string; active?: boolean; minimized?: boolean }>;
  projectModes?: Record<string, NexumOSWindowMode>;
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
  { id: "agent" as const, label: "AI Agent", icon: "spark" },
  { id: "preview" as const, label: "Preview", icon: "preview" },
  { id: "files" as const, label: "Files", icon: "files" },
  { id: "code" as const, label: "Code", icon: "code" },
];

function WindowIcon({ name }: { name: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "spark") return <svg {...common}><path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/></svg>;
  if (name === "preview") return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M8 13h4M8 16h7"/></svg>;
  if (name === "files") return <svg {...common}><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h4l2 2h5A2.5 2.5 0 0 1 20 8.5v9A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5v-11Z"/><path d="M4 9h16"/></svg>;
  return <svg {...common}><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg>;
}

export function NexumApplicationManager({ projectName, projects, projectModes = {}, running, minimized, mode, onSelectMode, onMinimize, onRestore, onClose, onSelectProject }: Props) {
  const [open, setOpen] = useState(false);
  const windows = apps;
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
  }, [currentIndex, onRestore, onSelectMode, open, switchIndex, switchableWindows, windows.length]);

  if (!running) return null;

  return <>
    <div className="nexum-os-app-strip" aria-label="Application Manager">
      <span className="nexum-os-app-strip-title">WINDOWS</span>
      {windows.map((item) => (
        <button key={item.id} type="button" className={"nexum-os-app-chip" + (mode === item.id && !minimized ? " active" : "")} onClick={() => { if (minimized) onRestore(); onSelectMode(item.id); setOpen(false); }}>
          <i className={"nexum-os-window-icon " + item.id}><WindowIcon name={item.icon} /></i><span>{item.label}</span>
        </button>
      ))}
      <button type="button" className="nexum-os-app-more" onClick={() => setOpen(true)} aria-label="Application Manager">⌘⇥</button>
    </div>
    {open && <div className="nexum-os-switcher-backdrop" role="dialog" aria-modal="true" aria-label="Application Manager" onMouseDown={() => setOpen(false)}>
      <div className="nexum-os-switcher" onMouseDown={(event) => event.stopPropagation()}>
        <div className="nexum-os-switcher-head"><span>APPLICATION MANAGER</span><small>{projectName ?? "NEXUM"} · {windows.length} windows</small></div>
        <div className="nexum-os-switcher-projects" aria-label="Running projects">
          {projectItems.map((project) => <button key={project.id} type="button" className={"nexum-os-project-chip" + (project.active ? " active" : "")} onClick={() => { onSelectProject?.(project.id); setOpen(false); }}>
            <span>{project.name.slice(0, 1).toUpperCase()}</span><strong>{project.name}</strong><small>{project.minimized ? "Minimized" : project.active ? "Active project" : "Running"} · {projectModes[project.id] ? projectModes[project.id].toUpperCase() : "WORKSPACE"}</small>
          </button>)}
        </div>
        <div className="nexum-os-switcher-grid">
          {windows.map((item) => <button key={item.id} type="button" className={"nexum-os-switcher-card" + (mode === item.id && !minimized ? " active" : "")} onClick={() => { onRestore(); onSelectMode(item.id); setOpen(false); }}>
            <span className={"nexum-os-switcher-icon " + item.id}><WindowIcon name={item.icon} /></span><strong>{item.label}</strong><small>{mode === item.id && !minimized ? "Active window" : "Open window"}</small>
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