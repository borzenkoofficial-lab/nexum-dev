import type { AgentStage } from "./types";

interface ChatPanelProps {
  message: string;
  reply: string;
  stage: AgentStage;
  apiError: string;
  onMessageChange: (message: string) => void;
  onSubmit: () => void;
  onRetry: () => void;
  onQuickTask: (task: string) => void;
}

export function ChatPanel({ message, reply, stage, apiError, onMessageChange, onSubmit, onRetry, onQuickTask }: ChatPanelProps) {
  return (
    <div className="chat">
      <div className="welcome"><span className="eyebrow">OVERVIEW</span><h1>What do you want to build?</h1><p>Describe a task and let the Agent inspect, change, test, and preview your project.</p></div>
      <div className="agent-activity" aria-live="polite"><span className={`activity-dot ${stage ? "working" : ""}`} />{stage ? stage === "thinking" ? "Thinking..." : stage === "running" ? "Running tool..." : "Building..." : "Agent ready"}</div>
      <form className="message-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <div className="message-box"><textarea value={message} onChange={(event) => onMessageChange(event.target.value)} placeholder="Describe what you want to create..." aria-label="Describe your task" disabled={Boolean(stage)} />{reply && <div className="reply" aria-live="polite">{reply}</div>}</div>
        <button className="send-button" type="submit" aria-label="Send task to NEXUM Agent" disabled={Boolean(stage) || !message.trim()}>Send</button>
      </form>
      {apiError && <div className="error-state" role="alert"><span>{apiError}</span><button type="button" className="retry-button" aria-label="Retry API request" onClick={onRetry}>Retry</button></div>}
      <div className="chat-steps"><span>01</span> Task input <span>02</span> Agent tools <span>03</span> Result</div>
      <button className="quick-git" type="button" onClick={() => onQuickTask("Покажи статус Git")}>Check Git status</button>
    </div>
  );
}
