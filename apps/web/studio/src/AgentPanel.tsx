import { useEffect, useRef, useState } from "react";
import { nexumRuntime } from "../../src/runtime/Runtime";
import { KvardStatusBadge } from "../../src/components/ui/index.ts";
import { isTerminal, parseJobSnapshot, type JobSnapshot } from "./model.ts";

const STATUS_LABEL: Record<JobSnapshot["status"], { label: string; tone: "info" | "success" | "danger" | "neutral" }> = {
  queued: { label: "В очереди", tone: "neutral" },
  running: { label: "Работает", tone: "info" },
  completed: { label: "Готово", tone: "success" },
  failed: { label: "Ошибка", tone: "danger" },
  cancelled: { label: "Отменено", tone: "neutral" },
};

/**
 * AI agent panel. Every status shown here comes from the backend ChatJob
 * (SSE /api/chat/jobs/:id/events, REST snapshot on reconnect); nothing is simulated.
 */
export function AgentPanel({ projectId, jobId, onJobStarted, onJobUpdate }: {
  projectId: string;
  jobId: string | null;
  onJobStarted: (jobId: string) => void;
  onJobUpdate: (job: JobSnapshot) => void;
}) {
  const [message, setMessage] = useState("");
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<"live" | "reconnecting" | "closed">("closed");
  const feedRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const onUpdate = useRef(onJobUpdate);
  useEffect(() => { onUpdate.current = onJobUpdate; }, [onJobUpdate]);

  useEffect(() => {
    if (!jobId) return;
    let closed = false;
    const source = new EventSource(`/api/chat/jobs/${encodeURIComponent(jobId)}/events`);
    const apply = (value: unknown) => {
      const snapshot = parseJobSnapshot(value);
      if (!snapshot || closed) return;
      setJob(snapshot);
      onUpdate.current(snapshot);
      if (isTerminal(snapshot.status)) { closed = true; source.close(); setConnection("closed"); }
    };
    source.addEventListener("job", (event) => {
      try { apply(JSON.parse((event as MessageEvent<string>).data)); } catch { /* malformed event ignored; next snapshot replaces state */ }
    });
    source.onopen = () => { if (!closed) setConnection("live"); };
    source.onerror = () => {
      if (closed) return;
      setConnection("reconnecting");
      // Resynchronise from the canonical snapshot while EventSource retries.
      void nexumRuntime.network.fetch(`/api/chat/jobs/${encodeURIComponent(jobId)}`, { dedupe: false, operation: "studio-job" })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { job?: unknown } | null) => { if (body?.job) apply(body.job); })
        .catch(() => undefined);
    };
    return () => { closed = true; source.close(); };
  }, [jobId]);

  // Follow new events only while the user is already at the bottom of the feed.
  const eventCount = job?.events.length ?? 0;
  useEffect(() => {
    const element = feedRef.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [eventCount]);

  const busy = Boolean(job && !isTerminal(job.status)) || sending;

  async function send() {
    const task = message.trim();
    if (!task || busy) return;
    setSending(true);
    setError("");
    try {
      const response = await nexumRuntime.network.fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ message: task, projectId }),
        operation: "studio-chat",
      });
      const body = await response.json().catch(() => null) as { jobId?: string; error?: string } | null;
      if (!response.ok || !body?.jobId) throw new Error(body?.error ?? `HTTP ${response.status}`);
      setMessage("");
      setJob(null);
      onJobStarted(body.jobId);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Не удалось отправить задачу.");
    } finally {
      setSending(false);
    }
  }

  async function cancel() {
    if (!jobId) return;
    const response = await nexumRuntime.network.fetch(`/api/chat/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST", retries: 0, operation: "studio-cancel" }).catch(() => null);
    if (!response?.ok) setError("Не удалось отменить задачу. Повторите.");
  }

  const status = job ? STATUS_LABEL[job.status] : null;
  return (
    <section className="st-agent" aria-label="AI-агент">
      <header className="st-pane-head">
        <strong>AI-агент</strong>
        {status && <KvardStatusBadge tone={status.tone} label={status.label} />}
      </header>
      {job && (
        // Outcome first: what the agent is doing now, or why it stopped and what to do next.
        <div className="st-agent-summary" aria-live="polite">
          {connection === "reconnecting" && <p className="st-warn">Связь с задачей прервалась — восстанавливаю…</p>}
          {!isTerminal(job.status) && <p className="st-agent-now">{job.currentMessage ?? "Агент работает…"}</p>}
          {job.status === "completed" && job.reply && <div className="st-reply">{job.reply}</div>}
          {job.status === "failed" && (
            <div className="st-agent-failure" role="alert">
              <strong>Задача остановлена</strong>
              <span>{job.errorInfo?.message ?? job.error ?? "Неизвестная ошибка."}</span>
              <small>{job.errorInfo?.recoveryStrategy ?? "Проверьте вкладки «Изменения» и «Проверки», затем уточните задачу и отправьте её снова."}</small>
            </div>
          )}
          {job.status === "cancelled" && <p className="st-muted">Задача отменена. Изменения, сделанные до отмены, видны во вкладке «Изменения».</p>}
        </div>
      )}
      <div className="st-agent-feed" ref={feedRef} onScroll={(event) => {
        const element = event.currentTarget;
        stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
      }}>
        {!job && !jobId && <p className="st-muted">Опишите задачу: что создать или изменить в проекте. Агент изучит проект, внесёт изменения и проверит результат.</p>}
        {jobId && !job && <p className="st-muted">Подключаюсь к задаче…</p>}
        {job && job.events.length > 0 && (
          <ol className="st-events" aria-label="История шагов агента">
            {job.events.slice(-60).map((event) => <EventItem key={event.id} tool={event.tool ?? event.type} message={event.message} />)}
          </ol>
        )}
      </div>
      {error && <p className="st-error" role="alert">{error}</p>}
      <form className="st-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <textarea
          aria-label="Задача для AI-агента"
          placeholder="Например: добавь страницу с ценами"
          value={message}
          disabled={busy}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}
        />
        <div className="st-composer-actions">
          <small className="st-muted">Enter — отправить, Shift+Enter — новая строка</small>
          {busy && jobId ? <button type="button" onClick={() => void cancel()}>Остановить</button>
            : <button type="submit" disabled={!message.trim() || sending}>Отправить</button>}
        </div>
      </form>
    </section>
  );
}

const EVENT_PREVIEW = 240;

/** One agent event; long tool output is collapsed so it does not flood the feed. */
function EventItem({ tool, message }: { tool: string; message: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = message.length > EVENT_PREVIEW;
  return (
    <li>
      <span className="st-mono">{tool}</span> {long && !expanded ? message.slice(0, EVENT_PREVIEW) + "…" : message}
      {long && <button type="button" className="st-link" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Свернуть" : "Показать полностью"}</button>}
    </li>
  );
}

