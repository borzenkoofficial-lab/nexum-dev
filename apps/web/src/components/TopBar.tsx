import type { AIProviderInfo, AIProviderStatus, AgentStage } from "./types";

interface TopBarProps {
  projectName: string;
  providers: AIProviderInfo[];
  models: string[];
  provider: string;
  model: string;
  aiStatus: AIProviderStatus | null;
  stage: AgentStage;
  onProviderChange: (id: string) => void;
  onModelChange: (model: string) => void;
  onToggleSidebar: () => void;
}

export function TopBar({ projectName, aiStatus, stage, onToggleSidebar }: TopBarProps) {
  const stageLabel = stage === "thinking" ? "Думаю…" : stage === "analyzing" ? "Анализирую…" : stage === "planning" ? "Планирую…" : stage === "reading" ? "Читаю файлы…" : stage === "editing" ? "Изменяю…" : stage === "running" ? "Агент работает…" : stage === "building" ? "Собираю…" : stage === "testing" ? "Проверяю…" : stage === "completed" ? "Готово" : stage === "error" ? "Требуется внимание" : "Готов";

  return (
    <header className="header nexum-topbar">
      <div className="header-brand">
        <button className="mobile-menu" type="button" aria-label="Открыть меню проектов" onClick={onToggleSidebar}>☰</button>
        <div className="topbar-mark" aria-hidden="true">N</div>
        <div className="topbar-copy"><div className="title">{projectName}</div><div className="subtitle">NEXUM.DEV · AI workspace</div></div>
      </div>
      <div className="header-tools">
        <div className="topbar-ai-state" title={aiStatus?.error ?? ((aiStatus?.provider ?? "AI") + " · " + (aiStatus?.model ?? "model"))}>
          <i className={aiStatus?.available ? "online" : ""} aria-hidden="true" />
          <span>{aiStatus?.available ? "AI online" : "AI ready"}</span>
          {aiStatus?.available && aiStatus.latencyMs != null ? <small>{aiStatus.latencyMs}ms</small> : null}
        </div>
        <div className={"status " + (stage ? "status-working" : "")} role="status" aria-live="polite"><span className="status-dot" aria-hidden="true">●</span> {stageLabel}</div>
        <button className="topbar-more" type="button" aria-label="Дополнительные действия">•••</button>
      </div>
    </header>
  );
}
