import "../nexum-os.css";
import type { Project } from "./types";

type SidebarView = "home" | "project" | "connectors" | "settings" | "news" | "diagnostics";

interface SidebarProps {
  projects: Project[];
  activeProjectId: string;
  projectsLoading: boolean;
  projectActionLoading: boolean;
  onNewProject: () => void;
  onSelectProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  mobileOpen: boolean;
  view: SidebarView;
  onViewChange: (view: SidebarView) => void;
}

export function Sidebar({
  projects, activeProjectId, projectsLoading, projectActionLoading, onNewProject,
  onSelectProject, onDeleteProject, mobileOpen, view, onViewChange,
}: SidebarProps) {
  const activeProjects = projects.filter((project) => project.status === "active");
  const firstProject = activeProjects[0];

  const openFirstProject = () => {
    if (firstProject) onSelectProject(firstProject.id);
    else onNewProject();
  };

  return (
    <aside className={\`sidebar \${mobileOpen ? "mobile-open" : ""}\`}>
      <div className="logo" aria-label="NEXUM.DEV">NEXUM<span>.DEV</span></div>

      <nav className="sidebar-nav os-primary-nav" aria-label="NEXUM OS">
        <button className={view === "home" ? "nav-item active" : "nav-item"} type="button" onClick={() => onViewChange("home")} title="Рабочий стол">
          <span aria-hidden="true">⌂</span><b>Рабочий стол</b>
        </button>
        <button className={view === "news" ? "nav-item active" : "nav-item"} type="button" onClick={() => onViewChange("news")} title="Журнал NEXUM">
          <span aria-hidden="true">✦</span><b>Журнал</b>
        </button>
        <button className={view === "connectors" ? "nav-item active" : "nav-item"} type="button" onClick={() => onViewChange("connectors")} title="Интеграции">
          <span aria-hidden="true">◇</span><b>Интеграции</b>
        </button>
        <button className={view === "diagnostics" ? "nav-item active" : "nav-item"} type="button" onClick={() => onViewChange("diagnostics")} title="Диагностика">
          <span aria-hidden="true">⌁</span><b>Диагностика</b>
        </button>
      </nav>

      <div className="os-dock-apps" aria-label="Приложения NEXUM OS">
        <div className="os-dock-caption">ПРИЛОЖЕНИЯ</div>
        <button type="button" className="os-dock-app" onClick={openFirstProject} title="Проекты">
          <span className="os-dock-icon projects">N</span><b>Проекты</b>
        </button>
        <button type="button" className="os-dock-app" onClick={openFirstProject} title="AI Agent">
          <span className="os-dock-icon agent">✦</span><b>AI Agent</b>
        </button>
        <button type="button" className="os-dock-app" onClick={openFirstProject} title="Code">
          <span className="os-dock-icon code">{"{}"}</span><b>Code</b>
        </button>
        <button type="button" className="os-dock-app" onClick={openFirstProject} title="Preview">
          <span className="os-dock-icon preview">◫</span><b>Preview</b>
        </button>
        <button type="button" className="os-dock-app" onClick={() => onViewChange("connectors")} title="Connectors">
          <span className="os-dock-icon connectors">◇</span><b>Connectors</b>
        </button>
        <button type="button" className="os-dock-app" onClick={() => onViewChange("diagnostics")} title="Diagnostics">
          <span className="os-dock-icon diagnostics">⌁</span><b>Diagnostics</b>
        </button>
      </div>

      <button className="new-project" type="button" aria-label="Создать новый проект" onClick={onNewProject}>
        <span aria-hidden="true">＋</span><b>Новый проект</b>
      </button>

      <div className="section-title">ПРОЕКТЫ</div>
      <div className="projects" aria-label="Проекты">
        {projectsLoading ? <div className="project-placeholder" role="status">Загрузка проектов…</div> :
          activeProjects.length === 0 ? <div className="project-placeholder">Проектов пока нет</div> :
          activeProjects.map((project) => (
            <div className={\`project-row \${project.id === activeProjectId ? "active" : ""}\`} key={project.id}>
              <button className="project" type="button" aria-current={project.id === activeProjectId ? "page" : undefined}
                aria-label={\`Выбрать проект \${project.name}\`} disabled={projectActionLoading} onClick={() => onSelectProject(project.id)}>
                <span className="project-mark" aria-hidden="true">{project.name.slice(0, 1)}</span><span>{project.name}</span>
              </button>
              {project.id !== "nexum" && <button className="project-delete" type="button" aria-label={\`Удалить проект \${project.name}\`} title="Удалить проект" disabled={projectActionLoading} onClick={() => onDeleteProject(project.id)}>×</button>}
            </div>
          ))}
      </div>

      <div className="sidebar-bottom">
        <button className={view === "settings" ? "sidebar-setting active" : "sidebar-setting"} type="button" aria-label="Открыть настройки" onClick={() => onViewChange("settings")}>
          <span>⚙</span><b>Настройки</b>
        </button>
      </div>
    </aside>
  );
}
