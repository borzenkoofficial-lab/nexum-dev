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
  thinking: "Анализирую запрос",
  analyzing: "Анализирую проект",
  planning: "Планирую следующее действие",
  reading: "Читаю файлы проекта",
  editing: "Изменяю проект",
  building: "Собираю проект",
  testing: "Выполняю проверки",
  completed: "Работа завершена",
  error: "Требуется внимание",
};

export function BottomPanel({ jobId, stage, activitySteps, activityEvents, currentActivity, problems, productPlan, onOpenPreview, onBackToChat, onRepair }: BottomPanelProps) {
  const live = Boolean(jobId) && stage !== "completed" && stage !== "error";
  const order = ["analyzing", "planning", "editing", "testing", "completed"];
  const stageMap: Record<string, string> = {
    thinking: "analyzing",
    reading: "analyzing",
    running: "planning",
    building: "editing",
  };
  const normalizedStage = stageMap[stage ?? ""] ?? stage ?? "";
  const stageIndex = order.indexOf(normalizedStage);
  const effectiveIndex = stageIndex;
  return <div className={`agent-panel agent-stage-${stage ?? "idle"}`} data-stage={stage ?? "idle"}>
    <div className="agent-panel-header">
      <div><span className="eyebrow">ИИ-АГЕНТ</span><h2>{live ? "Агент работает" : stage === "completed" ? "Работа завершена" : stage === "error" ? "Агент остановлен" : "Агент готов"}</h2></div>
      <span className={`agent-status-pill ${live ? "live" : stage === "error" ? "error" : "done"}`}><i />{labels[stage ?? ""] ?? "Готов"}</span>
    </div>
    <div className="agent-hero-mockup">
      <div className="agent-hero-top"><span className="eyebrow">NEXUM / AGENT</span><span className={live ? "agent-hero-live" : "agent-hero-ready"}><i />{live ? "LIVE" : "READY"}</span></div>
      <strong>{live ? "NEXUM is building." : stage === "completed" ? "Build complete." : stage === "error" ? "Repair required." : "Ready for your next build."}</strong>
      <p>{currentActivity || "The agent turns a product brief into architecture, code, Preview and verification."}</p>
      <div className="agent-hero-track"><span className="is-done"/><span className={live ? "is-live" : stage === "completed" ? "is-done" : ""}/><span className={stage === "completed" ? "is-done" : ""}/><span className={stage === "completed" ? "is-done" : ""}/><span className={stage === "completed" ? "is-done" : ""}/></div>
      <div className="agent-hero-labels"><span>Analyze</span><span>Plan</span><span>Build</span><span>Verify</span><span>Done</span></div>
    </div>
    <div className="agent-current"><span className={live ? "activity-dot working" : "activity-dot"} /><div><strong>{labels[stage ?? ""] ?? "Готов"}</strong><p>{currentActivity || "Отправьте задачу — NEXUM выполнит её здесь, без терминала."}</p></div></div>
    <div className="agent-pipeline" aria-label="Этапы работы агента">
      {([
        ["analyzing", "Анализ"],
        ["planning", "План"],
        ["editing", "Код"],
        ["testing", "Проверка"],
        ["completed", "Готово"],
      ] as const).map(([item, title], index) => {
        const done = stage === "completed" || (effectiveIndex >= 0 && index < effectiveIndex);
        return <div key={item} className={`pipeline-step ${normalizedStage === item ? "active" : ""} ${done ? "done" : ""}`}><i>{done ? "✓" : index + 1}</i><span>{title}</span>{index < 4 && <b aria-hidden="true">→</b>}</div>;
      })}
    </div>
    {problems.length > 0 && <div className="agent-problems">{problems.map((problem, index) => <div key={index}><strong>!</strong><span>{problem.source ? `${problem.source}: ` : ""}{problem.message}</span></div>)}</div>}
    {stage === "completed" && <div className="agent-result-card"><div className="agent-result-head"><span className="eyebrow">РЕЗУЛЬТАТ</span><strong>Проект готов к просмотру</strong></div><div className="agent-result-meta"><span><b>{productPlan?.productType ?? "Проект"}</b><small>Тип продукта</small></span><span><b>{productPlan?.pages.length ?? 0}</b><small>Страниц</small></span><span><b>{productPlan?.components.length ?? 0}</b><small>Компонентов</small></span><span><b>{activitySteps.filter((step) => step.success).length}</b><small>Успешных шагов</small></span></div><div className="agent-result-actions"><button className="agent-result-primary" type="button" onClick={onOpenPreview}>Открыть Preview</button><button type="button" onClick={onRepair}>Изменить</button><button type="button" onClick={onBackToChat}>Вернуться к чату</button></div></div>}
    {stage === "error" && <div className="agent-result-card agent-result-error"><div className="agent-result-head"><span className="eyebrow">ОШИБКА</span><strong>Задача не завершена</strong></div><p>Агент сохранил контекст последней задачи. Можно запустить автоматическое исправление или продолжить вручную.</p><div className="agent-result-actions"><button className="agent-result-primary" type="button" onClick={onRepair}>Исправить автоматически</button><button type="button" onClick={onBackToChat}>Вернуться к чату</button></div></div>}
    {productPlan && <div className="agent-plan-card">
      <div className="agent-timeline-title"><strong>План продукта</strong><span>{productPlan.productType}</span></div>
      <p className="agent-plan-goal">{productPlan.goal}</p>
      <div className="agent-plan-section"><strong>Страницы</strong><span>{productPlan.pages.join(" · ") || "—"}</span></div>
      <div className="agent-plan-section"><strong>Компоненты</strong><span>{productPlan.components.slice(0, 8).join(" · ") || "—"}</span></div>
      <div className="agent-plan-section"><strong>Критерии приёмки</strong><span>{productPlan.acceptanceCriteria.slice(0, 5).join(" · ") || "—"}</span></div>
    </div>}
    <div className="agent-timeline"><div className="agent-timeline-title"><strong>Работа в реальном времени</strong><span>{activitySteps.length} действий</span></div>
      {activityEvents.length ? [...activityEvents].reverse().slice(0, 30).map((event) => <div className={`agent-event agent-event-${event.type}`} key={event.id}><div className="agent-event-marker">{event.type === "tool-error" || event.type === "failed" ? "!" : event.type === "tool-success" || event.type === "completed" ? "✓" : "•"}</div><div className="agent-event-copy"><strong>{event.tool ?? "Агент"} · шаг {event.iteration}</strong><p>{event.message}</p></div><time>{new Date(event.timestamp).toLocaleTimeString()}</time></div>) : <div className="agent-empty">Действий пока нет. Здесь появится каждый важный шаг агента.</div>}
    </div>
  </div>;
}
