import type { Project } from "./types";

type SidebarView = "home" | "project" | "connectors" | "settings" | "news" | "diagnostics" | "agents" | "business-agents";

interface SidebarProps {
  projects: Project[];
  activeProjectId: string;
  projectsLoading: boolean;
  projectActionLoading: boolean;
  onNewProject: () => void;
  onSelectProject: (id: string) => void;
  mobileOpen: boolean;
  view: SidebarView;
  onViewChange: (view: SidebarView) => void;
}

const sections: Array<{ id: Exclude<SidebarView, "project">; label: string }> = [
  { id: "home", label: "Обзор" },
  { id: "agents", label: "AI-агенты" },
  { id: "business-agents", label: "Бизнес-агенты" },
  { id: "connectors", label: "Интеграции" },
  { id: "diagnostics", label: "Диагностика" },
  { id: "news", label: "Журнал" },
  { id: "settings", label: "Настройки" },
];

export function Sidebar({
  projects, activeProjectId, projectsLoading, projectActionLoading, onNewProject,
  onSelectProject, mobileOpen, view, onViewChange,
}: SidebarProps) {
  const activeProjects = projects.filter((project) => project.status === "active");

  return (
    <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`} aria-label="Боковая панель КВАРД">
      <div className="logo" aria-label="КВАРД">
        <span className="logo-mark" aria-hidden="true">К</span>
        <strong>КВАРД</strong>
      </div>

      <button className="new-project" type="button" onClick={onNewProject}>
        <span aria-hidden="true">＋</span><b>Новый проект</b>
      </button>

      <div className="section-title">РАБОЧАЯ СРЕДА</div>
      <nav className="sidebar-nav" aria-label="Основная навигация">
        {sections.map((section) => (
          <button
            key={section.id}
            className={view === section.id || (view === "project" && section.id === "home") ? "nav-item active" : "nav-item"}
            type="button"
            aria-current={view === section.id || (view === "project" && section.id === "home") ? "page" : undefined}
            onClick={() => onViewChange(section.id)}
          >
            <b>{section.label}</b>
          </button>
        ))}
      </nav>

      <div className="section-title projects-heading">ПРОЕКТЫ <span>{activeProjects.length}</span></div>
      <div className="projects" aria-label="Проекты">
        {projectsLoading ? <div className="project-placeholder" role="status">Загрузка проектов…</div> :
          activeProjects.length === 0 ? <div className="project-placeholder">Проектов пока нет</div> :
          activeProjects.map((project) => (
            <div className={`project-row ${project.id === activeProjectId ? "active" : ""}`} key={project.id}>
              <button
                className="project"
                type="button"
                aria-current={project.id === activeProjectId && view === "project" ? "page" : undefined}
                aria-label={`Открыть проект ${project.name}`}
                disabled={projectActionLoading}
                onClick={() => onSelectProject(project.id)}
              >
                <span className="project-mark" aria-hidden="true">{project.name.slice(0, 1).toUpperCase()}</span>
                <span>{project.name}</span>
              </button>
            </div>
          ))}
      </div>
    </aside>
  );
}
