import { useRef, useState } from "react";
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
  projectName: string;
}

export function ChatPanel({ message, reply, stage, apiError, messages, attachments, onMessageChange, onSubmit, onRetry, onQuickTask, onFilesSelected, onRemoveAttachment, onOpenAgent, projectName }: ChatPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sendingText, setSendingText] = useState("");
  const stageLabel = stage === "thinking" || stage === "analyzing" ? "Анализирую" : stage === "planning" ? "Планирую" : stage === "reading" ? "Читаю файлы" : stage === "editing" ? "Изменяю проект" : stage === "building" ? "Собираю" : stage === "testing" ? "Проверяю" : stage === "error" ? "Требуется внимание" : stage === "completed" ? "Готово" : "Готов";
  const busy = Boolean(stage && !["completed", "error"].includes(stage));

  function handleSubmit() {
    const text = message.trim();
    if (!text || busy) return;
    setSendingText(text);
    onMessageChange("");
    onSubmit();
    window.setTimeout(() => setSendingText(""), 520);
  }

  return (
    <div className="chat">
      <div className="chat-project-context"><span className="context-dot" /><div><small>Текущий проект</small><strong>{projectName}</strong></div><span className="context-lock">КОНТЕКСТ ЗАКРЕПЛЁН</span></div>
      <div className="welcome"><span className="eyebrow">NEXUM AGENT</span><h1>Что вы хотите создать?</h1><p>Опишите задачу. NEXUM работает в фоне: изменяет проект, собирает его и показывает результат.</p></div>
      {messages.length > 0 && <div className="conversation" aria-live="polite">{messages.map((item) => <article key={item.id} className={`conversation-message ${item.role}`}><div className="conversation-meta">{item.role === "user" ? "Вы" : "NEXUM"} · {new Date(item.timestamp).toLocaleTimeString()}</div><div className="conversation-content">{item.content}</div>{item.attachments?.length ? <div className="conversation-attachments">{item.attachments.map((name) => <span key={name}>↳ {name}</span>)}</div> : null}</article>)}</div>}
      <div className={`agent-activity agent-activity-live ${busy ? "active" : ""}`} aria-live="polite"><span className={`activity-dot ${busy ? "working" : ""}`} /><strong>{stageLabel}</strong><button type="button" onClick={onOpenAgent}>Открыть работу агента</button></div>
      <form className="message-form" onSubmit={(event) => { event.preventDefault(); handleSubmit(); }}>
        {sendingText && <div className="composer-flight" aria-hidden="true"><span>{sendingText}</span></div>}
        <div className="message-box">
          <textarea value={message} onChange={(event) => onMessageChange(event.target.value)} placeholder="Опишите, что создать или изменить…" aria-label="Опишите задачу" disabled={busy} />
          {attachments.length > 0 && <div className="attachment-strip">{attachments.map((item) => <span className="attachment-chip" key={item.id}>{item.name}<button type="button" aria-label={`Remove ${item.name}`} onClick={() => onRemoveAttachment(item.id)}>×</button></span>)}</div>}
          {reply && messages.length === 0 && <div className="reply" aria-live="polite">{reply}</div>}
          <div className="composer-actions"><button type="button" className="attach-button" disabled={busy} onClick={() => inputRef.current?.click()}>＋ Прикрепить</button><input ref={inputRef} type="file" multiple hidden onChange={(event) => { if (event.target.files) onFilesSelected([...event.target.files]); event.currentTarget.value = ""; }} /><span>До 5 файлов · 2 МБ каждый</span></div>
        </div>
        <button className="send-button" type="submit" aria-label="Отправить задачу агенту NEXUM" disabled={busy || !message.trim()}>Отправить</button>
      </form>
      {apiError && <div className="error-state" role="alert"><span>{apiError}</span><button type="button" className="retry-button" aria-label="Повторить запрос" onClick={onRetry}>Повторить</button></div>}
      <div className="chat-steps"><span>01</span> Чат <span>02</span> Агент <span>03</span> Предпросмотр <span>04</span> Итерация</div>
      <button className="quick-git" type="button" onClick={() => onQuickTask("Покажи статус Git")}>Проверить статус Git</button>
    </div>
  );
}
