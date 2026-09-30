import type { AIProviderStatus } from "./types";

type QuickView = "home" | "project" | "connectors" | "settings" | "news" | "diagnostics";

interface StatusBarProps {
  projectName: string;
  provider: string;
  aiStatus: AIProviderStatus | null;
  previewOnline: boolean;
  activeView: QuickView;
  osActiveWindow: "project" | "home";
  osFocusTick: number;
  onHome: () => void;
  onProjects: () => void;
  onConnectors: () => void;
  onDiagnostics: () => void;
  onNews: () => void;
  onSettings: () => void;
  onNewProject: () => void;
}

const items = [
  ["home", "home", "Домой", "home"],
  ["projects", "projects", "Проекты", "projects"],
  ["connectors", "connectors", "Связи", "connectors"],
  ["diagnostics", "diagnostics", "Диагностика", "diagnostics"],
  ["news", "news", "Журнал", "news"],
  ["settings", "settings", "Настройки", "settings"],
] as const;

function MenuIcon({ name }: { name: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "home") return <svg {...common}><path d="m4 10 8-6 8 6v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9Z"/><path d="M9 20v-5h6v5"/></svg>;
  if (name === "projects") return <svg {...common}><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>;
  if (name === "connectors") return <svg {...common}><path d="M8.5 12h7M12 8.5v7"/><circle cx="12" cy="12" r="8"/></svg>;
  if (name === "diagnostics") return <svg {...common}><path d="M4 15.5 8 11l3 3 5-7 4 4.5"/><path d="M4 19h16"/></svg>;
  if (name === "news") return <svg {...common}><path d="M5 5h14v14H5z"/><path d="M8 9h8M8 12h8M8 15h5"/></svg>;
  return <svg {...common}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3.5"/></svg>;
}

export function StatusBar({
  projectName,
  provider,
  aiStatus,
  previewOnline,
  activeView,
  osActiveWindow,
  osFocusTick,
  onHome,
  onProjects,
  onConnectors,
  onDiagnostics,
  onNews,
  onSettings,
  onNewProject,
}: StatusBarProps) {
  const actions: Record<string, () => void> = {
    home: onHome,
    projects: onProjects,
    connectors: onConnectors,
    diagnostics: onDiagnostics,
    news: onNews,
    settings: onSettings,
  };

  return (
    <footer className="status-bar nexum-global-menu" data-os-window={osActiveWindow} data-os-focus={osFocusTick} aria-label="NEXUM quick menu">
      <div className="status-quick-menu">
        {items.map(([key, icon, label, tone]) => (
          <button
            key={key}
            type="button"
            className={`status-menu-item status-tone-${tone} ${
              (key === "home" && activeView === "home") ||
              (key === "projects" && (activeView === "home" || activeView === "project")) ||
              (key !== "home" && key !== "projects" && activeView === key)
                ? "active"
                : ""
            }`}
            onClick={actions[key]}
            title={label}
            aria-label={label}
          >
            <span className="status-menu-icon"><MenuIcon name={icon} /></span>
            <span className="status-menu-label">{label}</span>
          </button>
        ))}
        <span className="status-menu-divider" aria-hidden="true" />
        <button type="button" className="status-menu-item status-tone-new" onClick={onNewProject} title="Новый проект" aria-label="Новый проект">
          <span className="status-menu-icon status-menu-plus" aria-hidden="true">＋</span>
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
