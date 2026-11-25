import type { ReactNode } from "react";
import type { AgentStage } from "./types";

type Tool = "preview" | "agent" | "files" | "code";

interface BuilderShellProps {
  projectName: string;
  previewOnline: boolean;
  agentStage: AgentStage;
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
  onClose: () => void;
  onConnect: () => void;
  onShare: () => void;
  onOpenPreview: () => void;
  children: ReactNode;
}

const tools: Array<{ id: Tool; label: string }> = [
  { id: "preview", label: "Предпросмотр" },
  { id: "agent", label: "AI-агент" },
  { id: "files", label: "Файлы" },
  { id: "code", label: "Код" },
];

export function BuilderShell({
  projectName, previewOnline, agentStage, activeTool,
  onToolChange, onClose, onConnect, onShare, onOpenPreview, children,
}: BuilderShellProps) {
  const building = Boolean(agentStage && !["completed", "error"].includes(agentStage));
  const status = agentStage === "error"
    ? "Требуется внимание"
    : building
      ? "Выполняется задача"
      : previewOnline
        ? "Предпросмотр доступен"
        : "Ожидает сборки";

  return (
    <section className="nx-builder" aria-label={"КВАРД Studio — " + projectName}>
      <header className="nx-builder-header">
        <button className="nx-builder-project" type="button" onClick={onClose} aria-label="Вернуться в рабочую среду">
          <span className="nx-builder-logo" aria-hidden="true">К</span>
          <span className="nx-builder-project-copy">
            <strong>{projectName}</strong>
            <small>Рабочее пространство</small>
          </span>
        </button>

        <nav className="nx-builder-nav" aria-label="Инструменты проекта">
          {tools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className={activeTool === tool.id ? "active" : ""}
              aria-current={activeTool === tool.id ? "page" : undefined}
              onClick={() => onToolChange(tool.id)}
            >
              {tool.label}
            </button>
          ))}
        </nav>

        <div className="nx-builder-header-actions">
          <span className={"nx-builder-status " + (building ? "building" : agentStage === "error" ? "error" : previewOnline ? "live" : "")} role="status" aria-live="polite">
            <i aria-hidden="true" />{status}
          </span>
          <button type="button" onClick={onConnect}>Интеграции</button>
          <button type="button" onClick={onShare}>Скопировать ссылку</button>
          <button className="nx-builder-open" type="button" onClick={onOpenPreview}>Открыть предпросмотр ↗</button>
        </div>
      </header>
      <div className="nx-builder-body">{children}</div>
    </section>
  );
}
