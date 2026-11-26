import { useCallback, useEffect, useMemo, useState } from "react";
import { KvardSegmentedControl } from "./ui/KvardSegmentedControl.ts";

type DiagnosticEvent = {
  id?: string;
  timestamp?: string;
  type?: string;
  level?: string;
  message?: string;
  route?: string;
  projectId?: string;
  jobId?: string;
  metadata?: Record<string, unknown>;
};

type Job = {
  id: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
  problems?: Array<{ message: string; source?: string }>;
};

type DiagnosticsResponse = {
  jobs?: Job[];
  recent?: DiagnosticEvent[];
  failures?: DiagnosticEvent[];
  failureCount?: number;
  generatedAt?: string;
};

function statusLabel(status: string) {
  const labels: Record<string, string> = { queued: "В очереди", running: "Выполняется", completed: "Завершено", failed: "Ошибка", cancelled: "Отменено" };
  return labels[status] ?? status;
}

export function DiagnosticsPage() {
  const [data, setData] = useState<DiagnosticsResponse>({});
  const [selectedJob, setSelectedJob] = useState<string>("");
  const [jobEvents, setJobEvents] = useState<DiagnosticEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobLoading, setJobLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "errors" | "jobs">("all");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setNotice("");
    try {
      const response = await fetch("/api/agent/diagnostics?limit=50");
      if (!response.ok) throw new Error(`Диагностика HTTP ${response.status}`);
      setData(await response.json() as DiagnosticsResponse);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось загрузить диагностику");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadJob = useCallback(async (jobId: string) => {
    setSelectedJob(jobId);
    setJobLoading(true);
    setNotice("");
    try {
      const response = await fetch(`/api/chat/jobs/${encodeURIComponent(jobId)}`);
      if (!response.ok) throw new Error(`Задание HTTP ${response.status}`);
      const result = await response.json() as { job?: { events?: DiagnosticEvent[]; problems?: Array<{ message: string; source?: string }>; error?: string } };
      setJobEvents([
        ...(result.job?.events ?? []),
        ...(result.job?.problems ?? []).map((problem) => ({ type: "problem", level: "error", message: problem.message, metadata: { source: problem.source } })),
        ...(result.job?.error ? [{ type: "job-error", level: "error", message: result.job.error }] : []),
      ]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось загрузить задание");
      setJobEvents([]);
    } finally {
      setJobLoading(false);
    }
  }, []);

  const visibleEvents = useMemo(() => {
    const source = selectedJob ? jobEvents : (data.recent ?? []);
    if (filter === "errors") return source.filter((event) => event.level === "error" || event.type === "tool-error" || event.type === "failed" || event.type === "job-error");
    if (filter === "jobs") return source.filter((event) => event.jobId || event.type?.includes("job"));
    return source;
  }, [data.recent, filter, jobEvents, selectedJob]);

  function exportDiagnostics() {
    const payload = { exportedAt: new Date().toISOString(), diagnostics: data, selectedJob, jobEvents };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kvard-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice("Диагностика экспортирована");
  }

  const jobs = data.jobs ?? [];
  const errors = data.failures ?? [];
  const latest = data.generatedAt ? new Date(data.generatedAt).toLocaleString("ru-RU") : "—";

  return (
    <section className="diagnostics-page">
      <header className="diagnostics-hero">
        <div>
          <h1>Диагностика</h1>
          <p>История заданий, события Runtime и ошибки инструментов.</p>
        </div>
        <div className="diagnostics-actions">
          <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "Обновляю…" : "Обновить"}</button>
          <button type="button" onClick={exportDiagnostics}>Экспорт JSON</button>
        </div>
      </header>

      <div className="diagnostics-stats">
        <div><span>Задания</span><strong>{jobs.length}</strong><small>последние задания</small></div>
        <div><span>Ошибки</span><strong>{data.failureCount ?? errors.length}</strong><small>агент · провайдеры · инструменты</small></div>
        <div><span>События</span><strong>{(data.recent ?? []).length}</strong><small>последние 50 событий</small></div>
        <div><span>Обновлено</span><strong>{latest}</strong><small>данные сервера</small></div>
      </div>

      <div className="diagnostics-layout">
        <aside className="diagnostics-jobs" aria-label="История заданий">
          <div className="diagnostics-panel-head"><h2>Задания агента</h2><b>{jobs.length}</b></div>
          {jobs.length === 0 && <div className="diagnostics-empty">Запустите задачу в рабочей среде, чтобы здесь появилась история.</div>}
          {jobs.slice().reverse().map((job) => (
            <button key={job.id} type="button" className={selectedJob === job.id ? "diagnostics-job selected" : "diagnostics-job"} aria-pressed={selectedJob === job.id} onClick={() => void loadJob(job.id)}>
              <span className={`diagnostics-job-dot ${job.status}`} />
              <span className="diagnostics-job-main"><strong>{job.id.slice(0, 8)}</strong><small>{new Date(job.createdAt).toLocaleString("ru-RU")}</small></span>
              <span className="diagnostics-job-status">{statusLabel(job.status)}</span>
            </button>
          ))}
        </aside>

        <section className="diagnostics-main" aria-label="Журнал событий">
          <div className="diagnostics-panel-head">
            <h2>{selectedJob ? `Задание ${selectedJob.slice(0, 12)}` : "Последние события"}</h2>
            <div className="diagnostics-filters">
              <KvardSegmentedControl
                ariaLabel="Фильтр событий"
                value={filter}
                onChange={value => setFilter(value as "all" | "errors" | "jobs")}
                items={[
                  { id: "all", label: "Все" },
                  { id: "errors", label: "Ошибки" },
                  { id: "jobs", label: "Задания" },
                ]}
              />
            </div>
          </div>
          {jobLoading && <div className="diagnostics-empty">Загружаю историю задания…</div>}
          {!jobLoading && visibleEvents.length === 0 && <div className="diagnostics-empty">Событий пока нет.</div>}
          <div className="diagnostics-timeline">
            {visibleEvents.map((event, index) => {
              const message = event.message ?? "Без сообщения";
              const isLong = message.length > 220;
              return (
                <article className={`diagnostics-event ${event.level === "error" ? "error" : event.level === "warn" ? "warn" : ""}`} key={event.id ?? `${event.timestamp}-${index}`}>
                  <div className="diagnostics-event-meta"><span>{event.type ?? "Событие"}</span><time>{event.timestamp ? new Date(event.timestamp).toLocaleTimeString("ru-RU") : "—"}</time></div>
                  <strong>{isLong ? `${message.slice(0, 220)}…` : message}</strong>
                  <div className="diagnostics-event-tags">
                    {event.jobId && <span>Задание: {event.jobId.slice(0, 8)}</span>}
                    {event.projectId && <span>Проект: {event.projectId}</span>}
                    {event.route && <span>{event.route}</span>}
                  </div>
                  {(isLong || event.metadata) && (
                    <details className="diagnostics-event-details">
                      <summary>Подробности события</summary>
                      {isLong && <pre>{message}</pre>}
                      {event.metadata && <pre>{JSON.stringify(event.metadata, null, 2)}</pre>}
                    </details>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </div>
      {notice && <div className="toast" role="status" onClick={() => setNotice("")}>{notice}</div>}
    </section>
  );
}
