type ToolRisk = "READ" | "WRITE" | "EXECUTE" | "DESTRUCTIVE";

export interface AgentApprovalView {
  id: string;
  toolName: string;
  risk: ToolRisk;
  inputPreview: string;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
  createdAt: number;
  expiresAt: number;
}

const TOOL_LABELS: Record<string, string> = {
  writeFile: "Запись файла",
  patchFile: "Изменение файла",
  scaffoldProject: "Создание структуры проекта",
  runCommand: "Запуск команды",
  runSandbox: "Запуск команды в sandbox",
  testProject: "Запуск тестов",
  readFile: "Чтение файла",
  listFiles: "Список файлов",
  searchFiles: "Поиск по проекту",
  git: "Операция Git",
  github: "Операция GitHub",
  validateProject: "Проверка проекта",
};

const RISK_LABELS: Record<ToolRisk, string> = {
  READ: "Чтение",
  WRITE: "Изменение данных",
  EXECUTE: "Выполнение команды",
  DESTRUCTIVE: "Потенциально разрушительное действие",
};

export function AgentApprovalPanel({ approval, loading, error, onDecision }: {
  approval: AgentApprovalView;
  loading: boolean;
  error?: string;
  onDecision: (decision: "approve" | "reject") => void;
}) {
  const expiresAt = new Date(approval.expiresAt);
  const expiryLabel = Number.isNaN(expiresAt.getTime())
    ? "через 10 минут"
    : expiresAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  return (
    <section className="kv-agent-approval" role="region" aria-labelledby="kv-agent-approval-title">
      <div className="kv-agent-approval-head">
        <div>
          <p className="kv-home-eyebrow">ТРЕБУЕТСЯ РЕШЕНИЕ</p>
          <h2 id="kv-agent-approval-title">Агент ожидает подтверждения</h2>
          <p>Предлагаемое действие ещё не выполнено. Проверьте инструмент и аргументы перед разрешением.</p>
        </div>
        <span className={`kv-agent-approval-risk ${approval.risk.toLowerCase()}`}>{RISK_LABELS[approval.risk]}</span>
      </div>
      <div className="kv-agent-approval-meta">
        <div><span>Действие</span><strong>{TOOL_LABELS[approval.toolName] ?? approval.toolName}</strong></div>
        <div><span>Инструмент</span><strong>{approval.toolName}</strong></div>
        <div><span>Срок решения</span><strong>до {expiryLabel}</strong></div>
      </div>
      <div className="kv-agent-approval-preview">
        <div><strong>Аргументы действия</strong><span>Секретные значения скрыты</span></div>
        <pre>{approval.inputPreview}</pre>
      </div>
      {error && <p className="kv-agent-approval-error" role="alert">{error}</p>}
      <div className="kv-agent-approval-actions">
        <span>Разрешение действует только для этого одного вызова инструмента.</span>
        <div>
          <button type="button" className="kv-agent-approval-reject" disabled={loading} onClick={() => onDecision("reject")}>{loading ? "Отправляю…" : "Отклонить"}</button>
          <button type="button" className="kv-agent-approval-approve" disabled={loading} onClick={() => onDecision("approve")}>{loading ? "Отправляю…" : "Разрешить действие"}</button>
        </div>
      </div>
    </section>
  );
}
