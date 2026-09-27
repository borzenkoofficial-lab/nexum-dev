import type { Project } from "./types";

interface SidebarProps {
  projects: Project[];
  activeProjectId: string;
  projectsLoading: boolean;
  projectActionLoading: boolean;
  onNewProject: () => void;
  onSelectProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  mobileOpen: boolean;
  view: "home" | "project" | "connectors" | "settings";
  onViewChange: (view: "home" | "project" | "connectors" | "settings") => void;
}

export function Sidebar({
  projects,
  activeProjectId,
  projectsLoading,
  projectActionLoading,
  onNewProject,
  onSelectProject,
  onDeleteProject,
  mobileOpen,
  view,
  onViewChange,
}: SidebarProps) {
  return (
    <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="logo" aria-label="NEXUM.DEV">NEXUM<span>.DEV</span></div>
      <nav className="sidebar-nav" aria-label="Workspace">
        <button className={view === "home" ? "nav-item active" : "nav-item"} type="button" onClick={() => onViewChange("home")}><span>⌂</span>Overview</button>
        <button className={view === "connectors" ? "nav-item active" : "nav-item"} type="button" onClick={() => onViewChange("connectors")}><span>◇</span>Connectors</button>
      </nav>
      <button className="new-project" type="button" aria-label="Create a new project" onClick={onNewProject}>
        + New Project
      </button>
      <div className="section-title">PROJECTS</div>
      <div className="projects" aria-label="Projects">
        {projectsLoading ? (
          <div className="project-placeholder" role="status">Loading projects...</div>
        ) : projects.length === 0 ? (
          <div className="project-placeholder">No projects yet</div>
        ) : (
          projects.filter((project) => project.status === "active").map((project) => (
            <div className={`project-row ${project.id === activeProjectId ? "active" : ""}`} key={project.id}>
              <button
                className="project"
                type="button"
                aria-current={project.id === activeProjectId ? "page" : undefined}
                aria-label={`Select project ${project.name}`}
                disabled={projectActionLoading}
                onClick={() => onSelectProject(project.id)}
              >
                <span className="project-mark" aria-hidden="true">{project.name.slice(0, 1)}</span>
                <span>{project.name}</span>
              </button>
              {project.id !== "nexum" && (
                <button
                  className="project-delete"
                  type="button"
                  aria-label={`Delete project ${project.name}`}
                  title="Delete project"
                  disabled={projectActionLoading}
                  onClick={() => onDeleteProject(project.id)}
                >×</button>
              )}
            </div>
          ))
        )}
      </div>
      <div className="sidebar-bottom">
        <button className={view === "settings" ? "sidebar-setting active" : "sidebar-setting"} type="button" aria-label="Open settings" onClick={() => onViewChange("settings")}><span>⚙</span>Settings</button>
      </div>
    </aside>
  );
}
