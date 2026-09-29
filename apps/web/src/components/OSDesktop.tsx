import type { Project } from "./types";

interface OSDesktopProps {
  projects: Project[];
  onNewProject: () => void;
  onOpenProject: (id: string, tab?: "preview" | "files" | "agent") => void;
  onOpenView: (view: "connectors" | "diagnostics" | "settings" | "news") => void;
  runningProjectIds?: string[];
  minimizedProjectIds?: string[];
  onRestoreProject?: (id: string) => void;
}

const apps = [
  { id: "projects", label: "Проекты", icon: "N", tone: "light" },
  { id: "agent", label: "AI Agent", icon: "✦", tone: "dark" },
  { id: "code", label: "Code", icon: "{ }", tone: "code" },
  { id: "preview", label: "Preview", icon: "◫", tone: "preview" },
  { id: "connectors", label: "Connectors", icon: "◇", tone: "light" },
  { id: "diagnostics", label: "Diagnostics", icon: "⌁", tone: "light" },
  { id: "settings", label: "Settings", icon: "⚙", tone: "light" },
];

export function OSDesktop({ projects, onNewProject, onOpenProject, onOpenView, runningProjectIds = [], minimizedProjectIds = [], onRestoreProject }: OSDesktopProps) {
  const active = projects.filter((project) => project.status === "active");
  const launch = (id: string) => {
    if (id === "projects" || id === "agent" || id === "code" || id === "preview") {
      if (active[0]) onOpenProject(active[0].id, id === "agent" ? "agent" : id === "code" ? "files" : "preview");
      return;
    }
    onOpenView(id as "connectors" | "diagnostics" | "settings" | "news");
  };

  return (
    <section className="nexum-os-desktop" aria-label="NEXUM OS Desktop">
      <div className="os-menubar">
        <div className="os-brand"><span>N</span><strong>NEXUM OS</strong></div>
        <div className="os-menu-center">Desktop</div>
        <div className="os-system"><span>{active.length} projects</span><i /><span>AI Ready</span><b>⌘K</b></div>
      </div>
      <div className="os-desktop-content">
        <div className="os-desktop-copy">
          <span className="os-eyebrow">NEXUM OS · DESKTOP</span>
          <h1>Everything you build.<br /><em>One system.</em></h1>
          <p>Проекты, Agent, Code, Preview и инструменты собраны в единой рабочей среде.</p>
          <button className="os-primary-action" type="button" onClick={onNewProject}>＋ Новый проект</button>
        </div>
        <div className="os-app-grid" aria-label="Приложения">
          {apps.map((app) => (
            <button key={app.id} type="button" className="os-app-icon" onClick={() => launch(app.id)}>
              <span className={"os-app-glyph " + app.tone}>{app.icon}</span><b>{app.label}</b>
            </button>
          ))}
          <button type="button" className="os-app-icon" onClick={() => onOpenView("news")}><span className="os-app-glyph journal">✦</span><b>Journal</b></button>
        </div>
        <div className="os-projects">
          {runningProjectIds.length > 0 && (
            <div className="os-running-bar" aria-label="Running windows">
              <div className="os-section-head"><span>RUNNING</span><small>{runningProjectIds.length} window{runningProjectIds.length === 1 ? "" : "s"}</small></div>
              <div className="os-running-list">
                {runningProjectIds.map((id) => {
                  const project = active.find((item) => item.id === id);
                  if (!project) return null;
                  const minimized = minimizedProjectIds.includes(id);
                  return (
                    <button key={id} type="button" className={"os-running-item" + (minimized ? " minimized" : "")} onClick={() => onRestoreProject?.(id)}>
                      <span className="os-running-mark">{project.name.slice(0, 1).toUpperCase()}</span>
                      <span><b>{project.name}</b><small>{minimized ? "Minimized" : "Workspace open"}</small></span>
                      <i />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="os-section-head"><span>RECENT PROJECTS</span><small>{active.length} active</small></div>
          {active.length ? <div className="os-project-grid">{active.slice(0, 6).map((project) => (
            <button key={project.id} className="os-project-card" type="button" onClick={() => onOpenProject(project.id)}>
              <span className="os-project-window"><i /><i /><i /></span><span className="os-project-mark">{project.name.slice(0, 1)}</span><strong>{project.name}</strong><small>{project.type ?? "Project"} · Open workspace →</small>
            </button>
          ))}</div> : <button className="os-empty-project" type="button" onClick={onNewProject}><span>＋</span><b>Create your first project</b><small>NEXUM will create a dedicated workspace.</small></button>}
        </div>
      </div>
      <div className="os-dock" aria-label="NEXUM OS Dock">
        <button type="button" className="os-dock-item" onClick={() => launch("projects")} title="Projects"><span className="os-app-glyph light">N</span></button>
        <button type="button" className="os-dock-item" onClick={() => launch("agent")} title="AI Agent"><span className="os-app-glyph dark">✦</span></button>
        <span className="os-dock-separator" />
        <button type="button" className="os-dock-item" onClick={() => launch("code")} title="Code"><span className="os-app-glyph code">{"{ }"}</span></button>
        <button type="button" className="os-dock-item" onClick={() => launch("preview")} title="Preview"><span className="os-app-glyph preview">◫</span></button>
        <span className="os-dock-separator" />
        <button type="button" className="os-dock-item" onClick={onNewProject} title="New project"><span className="os-app-glyph new">＋</span></button>
        <button type="button" className="os-dock-item" onClick={() => onOpenView("settings")} title="Settings"><span className="os-app-glyph light">⚙</span></button>
      </div>
    </section>
  );
}
