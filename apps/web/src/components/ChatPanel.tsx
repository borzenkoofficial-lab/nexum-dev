import { useRef } from "react";
import type { AgentStage } from "./types";

interface ChatPanelProps {
  message: string;
  reply: string;
  stage: AgentStage;
  apiError: string;
  messages: Array<{ id: string; role: "user" | "assistant"; content: string; timestamp: number; attachments?: string[] }>;
  attachments: Array<{ id: string; name: string; type: string; size: number; file: File }>;
  onMessageChange: (message: string) => void;
  onSubmit: () => void;
  onRetry: () => void;
  onQuickTask: (task: string) => void;
  onFilesSelected: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onOpenAgent: () => void;
}

export function ChatPanel({ message, reply, stage, apiError, messages, attachments, onMessageChange, onSubmit, onRetry, onQuickTask, onFilesSelected, onRemoveAttachment, onOpenAgent }: ChatPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const stageLabel = stage === "thinking" || stage === "analyzing" ? "Analyzing" : stage === "planning" ? "Planning" : stage === "reading" ? "Reading files" : stage === "editing" ? "Editing project" : stage === "building" ? "Building" : stage === "testing" ? "Testing" : stage === "error" ? "Needs attention" : stage === "completed" ? "Completed" : "Ready";
  const busy = Boolean(stage && !["completed", "error"].includes(stage));

  return (
    <div className="chat">
      <div className="welcome"><span className="eyebrow">NEXUM AGENT</span><h1>What do you want to build?</h1><p>Describe the task. NEXUM works in the background, changes the project, builds it and shows the result.</p></div>
      {messages.length > 0 && <div className="conversation" aria-live="polite">{messages.map((item) => <article key={item.id} className={`conversation-message ${item.role}`}><div className="conversation-meta">{item.role === "user" ? "You" : "NEXUM"} · {new Date(item.timestamp).toLocaleTimeString()}</div><div className="conversation-content">{item.content}</div>{item.attachments?.length ? <div className="conversation-attachments">{item.attachments.map((name) => <span key={name}>↳ {name}</span>)}</div> : null}</article>)}</div>}
      <div className={`agent-activity agent-activity-live ${busy ? "active" : ""}`} aria-live="polite"><span className={`activity-dot ${busy ? "working" : ""}`} /><strong>{stageLabel}</strong><button type="button" onClick={onOpenAgent}>View agent activity</button></div>
      <form className="message-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <div className="message-box">
          <textarea value={message} onChange={(event) => onMessageChange(event.target.value)} placeholder="Describe what you want to create or change..." aria-label="Describe your task" disabled={busy} />
          {attachments.length > 0 && <div className="attachment-strip">{attachments.map((item) => <span className="attachment-chip" key={item.id}>{item.name}<button type="button" aria-label={`Remove ${item.name}`} onClick={() => onRemoveAttachment(item.id)}>×</button></span>)}</div>}
          {reply && messages.length === 0 && <div className="reply" aria-live="polite">{reply}</div>}
          <div className="composer-actions"><button type="button" className="attach-button" disabled={busy} onClick={() => inputRef.current?.click()}>＋ Attach</button><input ref={inputRef} type="file" multiple hidden onChange={(event) => { if (event.target.files) onFilesSelected([...event.target.files]); event.currentTarget.value = ""; }} /><span>Up to 5 files · 2 MB each</span></div>
        </div>
        <button className="send-button" type="submit" aria-label="Send task to NEXUM Agent" disabled={busy || !message.trim()}>Send</button>
      </form>
      {apiError && <div className="error-state" role="alert"><span>{apiError}</span><button type="button" className="retry-button" aria-label="Retry API request" onClick={onRetry}>Retry</button></div>}
      <div className="chat-steps"><span>01</span> Chat <span>02</span> Agent <span>03</span> Preview <span>04</span> Iterate</div>
      <button className="quick-git" type="button" onClick={() => onQuickTask("Покажи статус Git")}>Check Git status</button>
    </div>
  );
}
