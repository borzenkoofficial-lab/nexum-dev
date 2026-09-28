import { useCallback, useEffect, useMemo, useState } from "react";

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
    try {
      const response = await fetch("/api/agent/diagnostics?limit=300");
      if (!response.ok) throw new Error(`Diagnostics HTTP ${response.status}`);
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
    try {
      const response = await fetch(`/api/chat/jobs/${encodeURIComponent(jobId)}`);
      if (!response.ok) throw new Error(`Job HTTP ${response.status}`);
      const result = await response.json() as { job?: { events?: DiagnosticEvent[]; problems?: Array<{ message: string; source?: string }>; error?: string } };
      setJobEvents([
        ...(result.job?.events ?? []),
        ...(result.job?.problems ?? []).map((problem) => ({ type: "problem", level: "error", message: problem.message, metadata: { source: problem.source } })),
        ...(result.job?.error ? [{ type: "job-error", level: "error", message: result.job.error }] : []),
      ]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось загрузить job");
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
    const payload = {
      exportedAt: new Date().toISOString(),
      diagnostics: data,
      selectedJob,
      jobEvents,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `nexum-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Диагностика экспортирована");
  }

  const jobs = data.jobs ?? [];
  const errors = data.failures ?? [];
  const latest = data.generatedAt ? new Date(data.generatedAt).toLocaleString("ru-RU") : "—";

  return (
    <section className="diagnostics-page">
      <div className="diagnostics-hero">
        <div>
          <span className="eyebrow">NEXUM.DEV / DIAGNOSTICS</span>
          <h1>Что реально делает Agent</h1>
          <p>Живой журнал выполнения: этапы, инструменты, ошибки, провайдеры, job и результат проверки.</p>
        </div>
        <div className="diagnostics-actions">
          <button type="button" onClick={() => void load()}>{loading ? "Обновляю…" : "Обновить"}</button>
          <button type="button" className="home-primary" onClick={exportDiagnostics}>Экспорт JSON</button>
        </div>
      </div>

      <div className="diagnostics-stats">
        <div><span>Jobs</span><strong>{jobs.length}</strong><small>последние задания</small></div>
        <div><span>Ошибки</span><strong>{data.failureCount ?? errors.length}</strong><small>agent / provider / tools</small></div>
        <div><span>Events</span><strong>{(data.recent ?? []).length}</strong><small>событий в журнале</small></div>
        <div><span>Последнее обновление</span><strong>{latest}</strong><small>серверный журнал</small></div>
      </div>

      <div className="diagnostics-layout">
        <aside className="diagnostics-jobs">
          <div className="diagnostics-panel-head"><div><span>RUNS</span><h2>Задания Agent</h2></div><b>{jobs.length}</b></div>
          {jobs.length === 0 && <div className="diagnostics-empty">Запустите первую задачу в Builder.</div>}
          {jobs.slice().reverse().map((job) => (
            <button key={job.id} type="button" className={selectedJob === job.id ? "diagnostics-job selected" : "diagnostics-job"} onClick={() => void loadJob(job.id)}>
              <span className={`diagnostics-job-dot ${job.status}`} />
              <span className="diagnostics-job-main"><strong>{job.id.slice(0, 8)}</strong><small>{new Date(job.createdAt).toLocaleString("ru-RU")}</small></span>
              <span className="diagnostics-job-status">{job.status}</span>
            </button>
          ))}
        </aside>

        <main className="diagnostics-main">
          <div className="diagnostics-panel-head">
            <div><span>{selectedJob ? "JOB TRACE" : "SYSTEM TRACE"}</span><h2>{selectedJob ? `Job ${selectedJob.slice(0, 12)}` : "Последние события"}</h2></div>
            <div className="diagnostics-filters">
              {(["all", "errors", "jobs"] as const).map((value) => <button key={value} type="button" className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{value === "all" ? "Все" : value === "errors" ? "Ошибки" : "Jobs"}</button>)}
            </div>
          </div>
          {jobLoading && <div className="diagnostics-empty">Загружаю трассировку job…</div>}
          {!jobLoading && visibleEvents.length === 0 && <div className="diagnostics-empty">Событий пока нет.</div>}
          <div className="diagnostics-timeline">
            {visibleEvents.map((event, index) => (
              <article className={`diagnostics-event ${event.level === "error" ? "error" : event.level === "warn" ? "warn" : ""}`} key={event.id ?? `${event.timestamp}-${index}`}>
                <div className="diagnostics-event-meta"><span>{event.type ?? "event"}</span><time>{event.timestamp ? new Date(event.timestamp).toLocaleTimeString("ru-RU") : "—"}</time></div>
                <strong>{event.message ?? "Без сообщения"}</strong>
                <div className="diagnostics-event-tags">
                  {event.jobId && <span>job:{event.jobId.slice(0, 8)}</span>}
                  {event.projectId && <span>project:{event.projectId}</span>}
                  {event.route && <span>{event.route}</span>}
                  {event.metadata && <span>{JSON.stringify(event.metadata).slice(0, 240)}</span>}
                </div>
              </article>
            ))}
          </div>
        </main>
      </div>
      {notice && <div className="toast" role="status" onClick={() => setNotice("")}>{notice}</div>}
    </section>
  );
}
