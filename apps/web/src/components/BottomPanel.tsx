import type { AgentStage } from "./types";

interface BottomPanelProps {
  jobId: string | null;
  stage: AgentStage;
  activitySteps: Array<{ iteration: number; tool: string; success: boolean }>;
  activityEvents: Array<{ id: number; timestamp: number; iteration: number; type: string; tool?: string; message: string }>;
  currentActivity: string;
  problems: Array<{ message: string; source?: string }>;
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

export function BottomPanel({ jobId, stage, activitySteps, activityEvents, currentActivity, problems, productPlan }: BottomPanelProps) {
  const live = Boolean(jobId) && stage !== "completed" && stage !== "error";
  return <div className="agent-panel">
    <div className="agent-panel-header">
      <div><span className="eyebrow">ИИ-АГЕНТ</span><h2>{live ? "Агент работает" : stage === "completed" ? "Работа завершена" : stage === "error" ? "Агент остановлен" : "Агент готов"}</h2></div>
      <span className={`agent-status-pill ${live ? "live" : stage === "error" ? "error" : "done"}`}><i />{labels[stage ?? ""] ?? "Готов"}</span>
    </div>
    <div className="agent-current"><span className={live ? "activity-dot working" : "activity-dot"} /><div><strong>{labels[stage ?? ""] ?? "Готов"}</strong><p>{currentActivity || "Отправьте задачу — NEXUM выполнит её здесь, без терминала."}</p></div></div>
    <div className="agent-stages">{(["analyzing","planning","reading","editing","building","testing","completed"] as const).map((item) => <span key={item} className={stage === item ? "active" : stage === "completed" ? "done" : ""}><i />{labels[item]}</span>)}</div>
    {problems.length > 0 && <div className="agent-problems">{problems.map((problem, index) => <div key={index}><strong>!</strong><span>{problem.source ? `${problem.source}: ` : ""}{problem.message}</span></div>)}</div>}
    {productPlan && <div className="agent-plan-card">
      <div className="agent-timeline-title"><strong>План продукта</strong><span>{productPlan.productType}</span></div>
      <p className="agent-plan-goal">{productPlan.goal}</p>
      <div className="agent-plan-section"><strong>Страницы</strong><span>{productPlan.pages.join(" · ") || "—"}</span></div>
      <div className="agent-plan-section"><strong>Компоненты</strong><span>{productPlan.components.slice(0, 8).join(" · ") || "—"}</span></div>
      <div className="agent-plan-section"><strong>Критерии приёмки</strong><span>{productPlan.acceptanceCriteria.slice(0, 5).join(" · ") || "—"}</span></div>
    </div>}
    <div className="agent-timeline"><div className="agent-timeline-title"><strong>Работа в реальном времени</strong><span>{activitySteps.length} действий</span></div>
      {activityEvents.length ? [...activityEvents].reverse().map((event) => <div className={`agent-event agent-event-${event.type}`} key={event.id}><div className="agent-event-marker">{event.type === "tool-error" || event.type === "failed" ? "!" : event.type === "tool-success" || event.type === "completed" ? "✓" : "•"}</div><div className="agent-event-copy"><strong>{event.tool ?? "Agent"} · step {event.iteration}</strong><p>{event.message}</p></div><time>{new Date(event.timestamp).toLocaleTimeString()}</time></div>) : <div className="agent-empty">No действий yet. The agent will show every important step here.</div>}
    </div>
  </div>;
}
