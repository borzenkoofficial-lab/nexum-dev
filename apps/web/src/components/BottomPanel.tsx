import type { AgentStage } from "./types";

interface BottomPanelProps {
  jobId: string | null;
  stage: AgentStage;
  activitySteps: Array<{ iteration: number; tool: string; success: boolean }>;
  activityEvents: Array<{ id: number; timestamp: number; iteration: number; type: string; tool?: string; message: string }>;
  currentActivity: string;
  problems: Array<{ message: string; source?: string }>;
  onOpenPreview: () => void;
  onBackToChat: () => void;
  onRepair: () => void;
  productPlan: {
    goal: string;
    productType: string;
    pages: string[];
    components: string[];
    acceptanceCriteria: string[];
  } | null;
}

const labels: Record<string, string> = {
  thinking: "Анализ запроса",
  analyzing: "Анализ проекта",
  planning: "Планирование",
  reading: "Чтение файлов",
  editing: "Изменение проекта",
  running: "Выполнение",
  building: "Сборка",
  testing: "Проверка",
  completed: "Готово",
  error: "Требуется внимание",
};

const pipeline = [
  ["analyzing", "Анализ", "01"],
  ["planning", "План", "02"],
  ["editing", "Сборка", "03"],
  ["testing", "Проверка", "04"],
  ["completed", "Готово", "05"],
] as const;

export function BottomPanel({
  jobId,
  stage,
  activitySteps,
  activityEvents,
  currentActivity,
  problems,
  productPlan,
  onOpenPreview,
  onBackToChat,
  onRepair,
}: BottomPanelProps) {
  const live = Boolean(jobId) && stage !== "completed" && stage !== "error";
  const stageMap: Record<string, string> = {
    thinking: "analyzing",
    reading: "analyzing",
    running: "planning",
    building: "editing",
  };
  const normalizedStage = stageMap[stage ?? ""] ?? stage ?? "";
  const currentIndex = pipeline.findIndex(([key]) => key === normalizedStage);
  const successCount = activitySteps.filter((step) => step.success).length;

  return (
    <div className={`agent-panel agent-stage-${stage ?? "idle"}`} data-stage={stage ?? "idle"}>
      <header className="agent-control-header">
        <div className="agent-control-identity">
          <span className="agent-control-icon">✦</span>
          <div>
            <span className="eyebrow">AGENT</span>
            <h2>{live ? "Выполняю задачу" : stage === "completed" ? "Задача завершена" : stage === "error" ? "Нужна проверка" : "Agent"}</h2>
          </div>
        </div>
        <div className={`agent-control-status ${live ? "live" : stage === "error" ? "error" : stage === "completed" ? "done" : ""}`}>
          <i />
          {labels[stage ?? ""] ?? "Готов к работе"}
        </div>
      </header>

      <section className={`agent-run-card ${live ? "is-live" : ""}`}>
        <div className="agent-run-card-top">
          <div>
            <span className="agent-run-kicker">{live ? "CURRENT RUN" : "RUN STATUS"}</span>
            <strong>{currentActivity || "Готов принять следующую задачу"}</strong>
          </div>
          <span className="agent-run-counter">{activitySteps.length.toString().padStart(2, "0")} шагов</span>
        </div>
        <div className="agent-run-meter" aria-hidden="true">
          {pipeline.map(([key], index) => (
            <span key={key} className={`${index < currentIndex || stage === "completed" ? "done " : ""}${index === currentIndex && live ? "active" : ""}`} />
          ))}
        </div>
        <div className="agent-run-meta">
          <span>{live ? "Agent выполняет изменения в проекте" : stage === "completed" ? "Все проверки завершены" : "Рабочее состояние проекта"}</span>
          <span>{successCount}/{activitySteps.length || 0} успешных действий</span>
        </div>
      </section>

      <section className="agent-pipeline-card" aria-label="Этапы работы агента">
        <div className="agent-section-heading">
          <div><span className="agent-section-kicker">WORKFLOW</span><strong>Этапы выполнения</strong></div>
          <span>{currentIndex >= 0 ? `Этап ${currentIndex + 1} из ${pipeline.length}` : "Ожидание"}</span>
        </div>
        <div className="agent-pipeline-v2">
          {pipeline.map(([key, title, number], index) => {
            const done = stage === "completed" || (currentIndex >= 0 && index < currentIndex);
            const active = currentIndex === index && live;
            return (
              <div key={key} className={`agent-pipeline-node ${done ? "done" : ""} ${active ? "active" : ""}`}>
                <div className="agent-pipeline-node-mark">{done ? "✓" : number}</div>
                <div className="agent-pipeline-node-copy"><strong>{title}</strong><span>{labels[key]}</span></div>
                {index < pipeline.length - 1 && <div className={`agent-pipeline-connector ${done ? "done" : ""}`} aria-hidden="true" />}
              </div>
            );
          })}
        </div>
      </section>

      {problems.length > 0 && (
        <section className="agent-problems-v2">
          <div className="agent-section-heading"><div><span className="agent-section-kicker">ATTENTION</span><strong>Проблемы</strong></div><span>{problems.length}</span></div>
          {problems.slice(0, 4).map((problem, index) => (
            <div className="agent-problem-row" key={index}><i>!</i><span>{problem.source ? `${problem.source}: ` : ""}{problem.message}</span></div>
          ))}
        </section>
      )}

      {stage === "completed" && (
        <section className="agent-result-card agent-result-card-v2">
          <div className="agent-result-head"><div><span className="agent-section-kicker">RESULT</span><strong>Проект готов</strong></div><span className="agent-result-check">✓</span></div>
          <div className="agent-result-grid">
            <span><b>{productPlan?.productType ?? "Проект"}</b><small>Тип</small></span>
            <span><b>{productPlan?.pages.length ?? 0}</b><small>Страниц</small></span>
            <span><b>{productPlan?.components.length ?? 0}</b><small>Компонентов</small></span>
            <span><b>{successCount}</b><small>Действий</small></span>
          </div>
          <div className="agent-result-actions"><button className="agent-result-primary" type="button" onClick={onOpenPreview}>Открыть Preview</button><button type="button" onClick={onBackToChat}>В чат</button><button type="button" onClick={onRepair}>Изменить</button></div>
        </section>
      )}

      {stage === "error" && (
        <section className="agent-result-card agent-result-card-v2 agent-result-error">
          <div className="agent-result-head"><div><span className="agent-section-kicker">RUN ERROR</span><strong>Задача остановлена</strong></div><span className="agent-result-check">!</span></div>
          <p>Контекст последнего запуска сохранён. Можно продолжить работу или запустить автоматическое исправление.</p>
          <div className="agent-result-actions"><button className="agent-result-primary" type="button" onClick={onRepair}>Исправить</button><button type="button" onClick={onBackToChat}>В чат</button></div>
        </section>
      )}

      {productPlan && (
        <section className="agent-plan-card agent-plan-card-v2">
          <div className="agent-section-heading"><div><span className="agent-section-kicker">PLAN</span><strong>Архитектура продукта</strong></div><span>{productPlan.productType}</span></div>
          <p className="agent-plan-goal">{productPlan.goal}</p>
          <div className="agent-plan-grid">
            <div><small>Страницы</small><span>{productPlan.pages.join(" · ") || "—"}</span></div>
            <div><small>Компоненты</small><span>{productPlan.components.slice(0, 8).join(" · ") || "—"}</span></div>
            <div><small>Критерии</small><span>{productPlan.acceptanceCriteria.slice(0, 5).join(" · ") || "—"}</span></div>
          </div>
        </section>
      )}

      <section className="agent-timeline agent-timeline-v2">
        <div className="agent-section-heading"><div><span className="agent-section-kicker">ACTIVITY</span><strong>Ход выполнения</strong></div><span>{activityEvents.length} событий</span></div>
        {activityEvents.length ? [...activityEvents].reverse().slice(0, 30).map((event) => (
          <div className={`agent-event agent-event-${event.type}`} key={event.id}>
            <div className="agent-event-marker">{event.type === "tool-error" || event.type === "failed" ? "!" : event.type === "tool-success" || event.type === "completed" ? "✓" : "·"}</div>
            <div className="agent-event-copy"><strong>{event.tool ?? "Agent"} <span>· шаг {event.iteration}</span></strong><p>{event.message}</p></div>
            <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
          </div>
        )) : <div className="agent-empty">События появятся здесь во время работы Agent.</div>}
      </section>
    </div>
  );
}
