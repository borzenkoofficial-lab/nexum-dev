import type { Project } from "./types";

interface SidebarProps {
  projects: Project[];
  activeProjectId: string;
  projectsLoading: boolean;
  projectActionLoading: boolean;
  onNewProject: () => void;
  onSelectProject: (id: string) => void;
  mobileOpen: boolean;
}

export function Sidebar({
  projects,
  activeProjectId,
  projectsLoading,
  projectActionLoading,
  onNewProject,
  onSelectProject,
  mobileOpen,
}: SidebarProps) {
  return (
    <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="logo" aria-label="NEXUM.DEV">NEXUM<span>.DEV</span></div>
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
            <button
              className={`project ${project.id === activeProjectId ? "active" : ""}`}
              type="button"
              key={project.id}
              aria-current={project.id === activeProjectId ? "page" : undefined}
              aria-label={`Select project ${project.name}`}
              disabled={projectActionLoading}
              onClick={() => onSelectProject(project.id)}
            >
              <span className="project-mark" aria-hidden="true">{project.name.slice(0, 1)}</span>
              <span>{project.name}</span>
            </button>
          ))
        )}
      </div>
      <div className="sidebar-bottom">
        <button type="button" aria-label="Open settings">Settings</button>
      </div>
    </aside>
  );
}
