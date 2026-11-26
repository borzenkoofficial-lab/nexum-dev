import type { ReactNode } from "react";
import type { AgentStage } from "./types";
import { KvardMark } from "./KvardMark.ts";
import { KvardTabs } from "./ui/index.ts";

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
  const completed = agentStage === "completed";
  const status = agentStage === "error"
    ? "Требуется внимание"
    : building
      ? "Выполняется задача"
      : previewOnline
        ? "Предпросмотр доступен"
        : completed
          ? "Сборка завершена"
          : "Ожидает сборки";

  return (
    <section className="nx-builder" aria-label={"КВАРД Studio — " + projectName}>
      <header className="nx-builder-header">
        <button className="nx-builder-project" type="button" onClick={onClose} aria-label="Вернуться в рабочую среду">
          <KvardMark size={28} />
          <span className="nx-builder-project-copy">
            <strong>{projectName}</strong>
            <small>Рабочее пространство</small>
          </span>
        </button>

        <KvardTabs
          id="kv-builder-tools"
          className="nx-builder-nav"
          ariaLabel="Инструменты проекта"
          value={activeTool}
          onChange={(value) => onToolChange(value as Tool)}
          items={tools.map((tool) => ({ id: tool.id, label: tool.label }))}
        />

        <div className="nx-builder-header-actions">
          <span className={"nx-builder-status " + (building ? "building" : agentStage === "error" ? "error" : previewOnline ? "live" : completed ? "done" : "")} role="status" aria-live="polite">
            <i aria-hidden="true" />{status}
          </span>
          <button type="button" onClick={onConnect}>Интеграции</button>
          <button type="button" onClick={onShare}>Скопировать ссылку</button>
          <button className="nx-builder-open" type="button" onClick={onOpenPreview}>Открыть предпросмотр ↗</button>
        </div>
      </header>
      <div className="nx-builder-body" role="tabpanel" id={`kv-builder-tools-panel-${activeTool}`} aria-labelledby={`kv-builder-tools-tab-${activeTool}`} tabIndex={0}>{children}</div>
    </section>
  );
}
