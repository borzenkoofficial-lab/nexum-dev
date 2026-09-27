import type { AgentStage } from "./types";

interface BottomPanelProps {
  jobId: string | null;
  stage: AgentStage;
  activitySteps: Array<{ iteration: number; tool: string; success: boolean }>;
  activityEvents: Array<{ id: number; timestamp: number; iteration: number; type: string; tool?: string; message: string }>;
  currentActivity: string;
  problems: Array<{ message: string; source?: string }>;
}

const labels: Record<string, string> = {
  thinking: "Analyzing request",
  analyzing: "Analyzing project",
  planning: "Planning next action",
  reading: "Reading project files",
  editing: "Editing project",
  building: "Building project",
  testing: "Running checks",
  completed: "Work completed",
  error: "Needs attention",
};

export function BottomPanel({ jobId, stage, activitySteps, activityEvents, currentActivity, problems }: BottomPanelProps) {
  const live = Boolean(jobId) && stage !== "completed" && stage !== "error";
  return <div className="agent-panel">
    <div className="agent-panel-header">
      <div><span className="eyebrow">AI AGENT</span><h2>{live ? "Agent is working" : stage === "completed" ? "Work completed" : stage === "error" ? "Agent stopped" : "Agent ready"}</h2></div>
      <span className={`agent-status-pill ${live ? "live" : stage === "error" ? "error" : "done"}`}><i />{labels[stage ?? ""] ?? "Ready"}</span>
    </div>
    <div className="agent-current"><span className={live ? "activity-dot working" : "activity-dot"} /><div><strong>{labels[stage ?? ""] ?? "Ready"}</strong><p>{currentActivity || "Send a task and NEXUM will work here without opening a terminal."}</p></div></div>
    <div className="agent-stages">{(["analyzing","planning","reading","editing","building","testing","completed"] as const).map((item) => <span key={item} className={stage === item ? "active" : stage === "completed" ? "done" : ""}><i />{labels[item]}</span>)}</div>
    {problems.length > 0 && <div className="agent-problems">{problems.map((problem, index) => <div key={index}><strong>!</strong><span>{problem.source ? `${problem.source}: ` : ""}{problem.message}</span></div>)}</div>}
    <div className="agent-timeline"><div className="agent-timeline-title"><strong>Live activity</strong><span>{activitySteps.length} actions</span></div>
      {activityEvents.length ? [...activityEvents].reverse().map((event) => <div className={`agent-event agent-event-${event.type}`} key={event.id}><div className="agent-event-marker">{event.type === "tool-error" || event.type === "failed" ? "!" : event.type === "tool-success" || event.type === "completed" ? "✓" : "•"}</div><div className="agent-event-copy"><strong>{event.tool ?? "Agent"} · step {event.iteration}</strong><p>{event.message}</p></div><time>{new Date(event.timestamp).toLocaleTimeString()}</time></div>) : <div className="agent-empty">No actions yet. The agent will show every important step here.</div>}
    </div>
  </div>;
}
