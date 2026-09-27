import { useEffect, useState } from "react";

interface BottomPanelProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  jobId: string | null;
}

type Tab = "terminal" | "problems" | "logs" | "git" | "activity";

export function BottomPanel({ open, onClose, projectId, jobId }: BottomPanelProps) {
  const [tab, setTab] = useState<Tab>("terminal");
  const [gitText, setGitText] = useState("Loading…");
  const [gitError, setGitError] = useState("");
  const [logs, setLogs] = useState<string[]>([]);

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

  if (!open) return null;

  const tabs: Array<[Tab, string]> = [["terminal", "TERMINAL"], ["problems", "PROBLEMS"], ["logs", "LOGS"], ["git", "GIT"], ["activity", "AI ACTIVITY"]];

  return <section className="bottom-panel" aria-label="Project output panel">
    <div className="bottom-panel-header">
      <div className="bottom-tabs">{tabs.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} type="button" onClick={() => setTab(id)}>{label}</button>)}</div>
      <button type="button" aria-label="Close panel" onClick={onClose}>×</button>
    </div>
    {tab === "terminal" && <div className="terminal-empty"><span className="terminal-prompt">$</span><span>Interactive terminal is not exposed yet. Run build/test commands through the Agent.</span></div>}
    {tab === "problems" && <div className="terminal-empty"><span>Problems are reported here after Agent build/test checks.</span><span className="coming-soon">No problems reported</span></div>}
    {tab === "logs" && <div className="bottom-output">{logs.length ? logs.map((line, i) => <div key={i}>{line}</div>) : <span>No Git commits yet.</span>}</div>}
    {tab === "git" && <div className="bottom-output">{gitError ? <span className="error-state-inline">{gitError}</span> : <pre>{gitText}</pre>}</div>}
    {tab === "activity" && <div className="bottom-output"><div>Current job: {jobId ?? "idle"}</div><div>AI Activity is linked to the active chat job.</div></div>}
  </section>;
}
