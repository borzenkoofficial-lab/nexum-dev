import type { AIProviderStatus } from "./types";

type QuickView = "home" | "project" | "connectors" | "settings" | "news" | "diagnostics";

interface StatusBarProps {
  projectName: string;
  provider: string;
  aiStatus: AIProviderStatus | null;
  previewOnline: boolean;
  activeView: QuickView;
  onHome: () => void;
  onProjects: () => void;
  onAgent: () => void;
  onCode: () => void;
  onPreview: () => void;
  onConnectors: () => void;
  onDiagnostics: () => void;
  onNews: () => void;
  onSettings: () => void;
  onNewProject: () => void;
}

const items = [
  ["home", "⌂", "Домой", "home"],
  ["projects", "◈", "Проекты", "projects"],
  ["agent", "✦", "Агент", "agent"],
  ["code", "</>", "Code", "code"],
  ["preview", "◫", "Preview", "preview"],
  ["connectors", "⊕", "Связи", "connectors"],
  ["diagnostics", "◌", "Диагностика", "diagnostics"],
  ["news", "◍", "Журнал", "news"],
  ["settings", "⚙", "Настройки", "settings"],
] as const;

export function StatusBar({
  projectName,
  provider,
  aiStatus,
  previewOnline,
  activeView,
  onHome,
  onProjects,
  onAgent,
  onCode,
  onPreview,
  onConnectors,
  onDiagnostics,
  onNews,
  onSettings,
  onNewProject,
}: StatusBarProps) {
  const actions: Record<string, () => void> = {
    home: onHome,
    projects: onProjects,
    agent: onAgent,
    code: onCode,
    preview: onPreview,
    connectors: onConnectors,
    diagnostics: onDiagnostics,
    news: onNews,
    settings: onSettings,
  };

  return (
    <footer className="status-bar nexum-global-menu" aria-label="NEXUM quick menu">
      <div className="status-quick-menu">
        {items.map(([key, glyph, label, tone]) => (
          <button
            key={key}
            type="button"
            className={`status-menu-item status-tone-${tone} ${activeView === key || (key !== "home" && key !== "projects" && activeView === "project" && key === "preview") ? "active" : ""}`}
            onClick={actions[key]}
            title={label}
            aria-label={label}
          >
            <span className="status-menu-icon">{glyph}</span>
            <span className="status-menu-label">{label}</span>
          </button>
        ))}
        <span className="status-menu-divider" aria-hidden="true" />
        <button type="button" className="status-menu-item status-tone-new" onClick={onNewProject} title="Новый проект" aria-label="Новый проект">
          <span className="status-menu-icon">＋</span>
          <span className="status-menu-label">Новый</span>
        </button>
      </div>
      <div className="status-runtime">
        <span className="status-runtime-project">{projectName}</span>
        <span className={`status-runtime-dot ${aiStatus?.available ? "online" : "offline"}`} />
        <span>{aiStatus?.available ? provider + " · онлайн" : provider + " · офлайн"}</span>
        <span className={`status-runtime-preview ${previewOnline ? "online" : "offline"}`}>{previewOnline ? "Preview" : "Offline"}</span>
      </div>
    </footer>
  );
}
