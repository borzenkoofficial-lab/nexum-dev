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

export function TopBar({
  projectName,
  providers,
  models,
  provider,
  model,
  aiStatus,
  stage,
  onProviderChange,
  onModelChange,
  onToggleSidebar,
}: TopBarProps) {
  const stageLabel = stage === "thinking" ? "Думаю…" : stage === "analyzing" ? "Анализирую проект…" : stage === "planning" ? "Планирую…" : stage === "reading" ? "Читаю файлы…" : stage === "editing" ? "Изменяю файлы…" : stage === "running" ? "Агент работает…" : stage === "building" ? "Собираю…" : stage === "testing" ? "Проверяю…" : stage === "completed" ? "Готово" : stage === "error" ? "Требуется внимание" : "Готов";

  return (
    <header className="header">
      <div>
        <button className="mobile-menu" type="button" aria-label="Открыть меню проектов" onClick={onToggleSidebar}>☰</button>
        <div className="title">{projectName}</div>
        <div className="subtitle">Рабочее пространство разработки с ИИ</div>
      </div>
      <div className="header-tools">
        <div className="ai-controls" aria-label="Выбор провайдера и модели ИИ">
          <label><span>Провайдер</span><select value={provider} aria-label="AI provider" onChange={(event) => onProviderChange(event.target.value)}>
            {providers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select></label>
          <label><span>Модель</span><select value={model} aria-label="AI model" onChange={(event) => onModelChange(event.target.value)}>
            {(models.length > 0 ? models : [model]).map((item) => <option value={item} key={item}>{item}</option>)}
          </select></label>
          {aiStatus && (
            <span
              className={`ai-connection ${aiStatus.available ? "online" : "offline"}`}
              role="status"
              title={aiStatus.error ?? `${aiStatus.provider} · ${aiStatus.model}`}
            >
              <i aria-hidden="true" />
              {aiStatus.available
                ? `ИИ онлайн · ${aiStatus.latencyMs ?? "—"}ms`
                : aiStatus.error ?? `ИИ офлайн · ${aiStatus.model}`}
            </span>
          )}
        </div>
        <div className={`status ${stage ? "status-working" : ""}`} role="status" aria-live="polite">
          <span className="status-dot" aria-hidden="true">●</span> {stageLabel}
        </div>
      </div>
    </header>
  );
}
