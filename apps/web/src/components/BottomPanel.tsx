import { useEffect, useState } from "react";

interface BottomPanelProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  jobId: string | null;
  activitySteps: Array<{ iteration: number; tool: string; success: boolean }>;
  activityEvents: Array<{ id: number; timestamp: number; iteration: number; type: string; tool?: string; message: string }>;
  currentActivity: string;
  problems: Array<{ message: string; source?: string }>;
  onRunCommand: (command: string) => Promise<{ success?: boolean; stdout?: string; stderr?: string; error?: string }>;
}

type Tab = "terminal" | "problems" | "logs" | "git" | "activity" | "diagnostics";

export function BottomPanel({ open, onClose, projectId, jobId, activitySteps, activityEvents, currentActivity, problems, onRunCommand }: BottomPanelProps) {
  const [tab, setTab] = useState<Tab>("terminal");
  const [gitText, setGitText] = useState("Loading…");
  const [gitError, setGitError] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [command, setCommand] = useState("npm run build");
  const [terminalOutput, setTerminalOutput] = useState("Ready.");
  const [running, setRunning] = useState(false);
  const [diagnostics, setDiagnostics] = useState("");
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState("");
  const [diagnosticsRefresh, setDiagnosticsRefresh] = useState(0);

  useEffect(() => {
    if (!open || !projectId || tab !== "git") return;
    let cancelled = false;
    setGitError(""); setGitText("Loading…");
    fetch(`/api/projects/${encodeURIComponent(projectId)}/git/status`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { stdout?: string; stderr?: string; error?: string };
        if (!response.ok) throw new Error(data.error || data.stderr || `Git API: HTTP ${response.status}`);
        if (!cancelled) setGitText(data.stdout || "Working tree clean");
      })
      .catch((error) => { if (!cancelled) setGitError(error instanceof Error ? error.message : "Git status unavailable"); });
    return () => { cancelled = true; };
  }, [open, projectId, tab]);

  useEffect(() => {
    if (!open || !projectId || tab !== "logs") return;
    fetch(`/api/projects/${encodeURIComponent(projectId)}/git/log`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { stdout?: string; stderr?: string };
        setLogs((data.stdout || data.stderr || "").split("\n").filter(Boolean));
      })
      .catch(() => setLogs([]));
  }, [open, projectId, tab]);

  useEffect(() => {
    if (!open || tab !== "diagnostics") return;
    let cancelled = false;
    setDiagnosticsLoading(true);
    setDiagnosticsError("");
    fetch("/api/agent/diagnostics?limit=100", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Diagnostics API: HTTP ${response.status}`);
        if (!cancelled) setDiagnostics(JSON.stringify(data, null, 2));
      })
      .catch((error) => { if (!cancelled) setDiagnosticsError(error instanceof Error ? error.message : "Diagnostics unavailable"); })
      .finally(() => { if (!cancelled) setDiagnosticsLoading(false); });
    return () => { cancelled = true; };
  }, [open, tab, jobId, diagnosticsRefresh]);

  if (!open) return null;

  const tabs: Array<[Tab, string]> = [["terminal", "TERMINAL"], ["problems", "PROBLEMS"], ["logs", "LOGS"], ["git", "GIT"], ["activity", "AI ACTIVITY"], ["diagnostics", "DIAGNOSTICS"]];

  return <section className="bottom-panel" aria-label="Project output panel">
    <div className="bottom-panel-header">
      <div className="bottom-tabs">{tabs.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} type="button" onClick={() => setTab(id)}>{label}</button>)}</div>
      <button type="button" aria-label="Close panel" onClick={onClose}>×</button>
    </div>
    {tab === "terminal" && <div className="bottom-output">
      <div className="terminal-command-row"><span className="terminal-prompt">$</span><input value={command} onChange={(event) => setCommand(event.target.value)} aria-label="Project command" /><button type="button" disabled={running} onClick={async () => { setRunning(true); setTerminalOutput("Running…"); const result = await onRunCommand(command); setTerminalOutput(result.stdout || result.stderr || result.error || (result.success ? "Command completed." : "Command failed.")); setRunning(false); }}>Run</button></div>
      <pre>{terminalOutput}</pre>
    </div>}
    {tab === "problems" && <div className="bottom-output">{problems.length ? problems.map((problem, i) => <div key={i} className="problem-row"><strong>×</strong><span>{problem.source ? `${problem.source}: ` : ""}{problem.message}</span></div>) : <span>No problems reported.</span>}</div>}
    {tab === "logs" && <div className="bottom-output">{logs.length ? logs.map((line, i) => <div key={i}>{line}</div>) : <span>No Git commits yet.</span>}</div>}
    {tab === "git" && <div className="bottom-output">{gitError ? <span className="error-state-inline">{gitError}</span> : <pre>{gitText}</pre>}</div>}
    {tab === "activity" && <div className="bottom-output">
      <div className="activity-live-status"><span className={jobId ? "activity-dot live" : "activity-dot"}></span><strong>{jobId ? "AI WORKING" : "AI IDLE"}</strong><span className="activity-job">{jobId ? jobId.slice(0, 8) : "—"}</span></div>
      {currentActivity && <div className="activity-current">{currentActivity}</div>}
      {activityEvents.length ? [...activityEvents].reverse().map((event) => <div key={event.id} className={`activity-event activity-event-${event.type}`}><span className="activity-event-icon">{event.type === "tool-success" ? "✓" : event.type === "tool-error" || event.type === "failed" ? "×" : event.type === "completed" ? "●" : "→"}</span><div><strong>{event.tool ? `${event.tool} · ` : ""}Шаг ${event.iteration}</strong><p>{event.message}</p></div><time>{new Date(event.timestamp).toLocaleTimeString()}</time></div>) : activitySteps.length ? activitySteps.map((step, i) => <div key={i} className="activity-row"><span>{step.success ? "✓" : "×"}</span><span>#{step.iteration} {step.tool}</span></div>) : <span>Ожидаю первый шаг агента…</span>}
    </div>}
    {tab === "diagnostics" && <div className="bottom-output diagnostics-output">
      <div className="diagnostics-toolbar">
        <strong>Agent diagnostics</strong>
        <button type="button" disabled={diagnosticsLoading} onClick={() => setDiagnosticsRefresh((value) => value + 1)}>{diagnosticsLoading ? "Loading…" : "Refresh"}</button>
        {diagnostics && <button type="button" onClick={() => void navigator.clipboard?.writeText(diagnostics)}>Copy JSON</button>}
      </div>
      {diagnosticsError ? <span className="error-state-inline">{diagnosticsError}</span> : diagnosticsLoading && !diagnostics ? <span>Collecting diagnostics…</span> : <pre>{diagnostics || "No diagnostics yet."}</pre>}
    </div>}
  </section>;
}
