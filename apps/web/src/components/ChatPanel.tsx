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

const STARTERS = [
  ["Сайт", "Создай современный адаптивный сайт компании"],
  ["Приложение", "Создай современное веб-приложение с авторизацией и личным кабинетом"],
  ["Dashboard", "Создай административную панель с таблицами, фильтрами и аналитикой"],
];

export function ChatPanel({
  message, reply, stage, apiError, messages, attachments, onMessageChange, onSubmit, onRetry,
  onQuickTask, onFilesSelected, onRemoveAttachment, onOpenAgent, projectName,
}: ChatPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sendingText, setSendingText] = useState("");
  const busy = Boolean(stage && !["completed", "error"].includes(stage));
  const stageLabel =
    stage === "thinking" || stage === "analyzing" ? "Анализирую" :
    stage === "planning" ? "Планирую" :
    stage === "reading" ? "Читаю файлы" :
    stage === "editing" ? "Изменяю проект" :
    stage === "building" ? "Собираю" :
    stage === "testing" ? "Проверяю" :
    stage === "error" ? "Требуется внимание" :
    stage === "completed" ? "Готово" : "Готов";

  function handleSubmit() {
    const text = message.trim();
    if (!text || busy) return;
    setSendingText(text);
    onSubmit();
    window.setTimeout(() => setSendingText(""), 520);
  }

  return (
    <section className="chat" aria-label="Чат NEXUM">
      <div className="chat-history">
        <div className="chat-project-context">
          <span className="context-dot" />
          <div><small>Проект</small><strong>{projectName}</strong></div>
        </div>

        {messages.length === 0 ? (
          <div className="welcome">
            <span className="eyebrow">NEXUM AGENT</span>
            <h1>Что создаём?</h1>
            <p>Опишите идею обычным языком. NEXUM спланирует работу, изменит проект и покажет результат.</p>
          </div>
        ) : (
          <div className="conversation" aria-live="polite">
            {messages.map((item) => (
              <article key={item.id} className={`conversation-message ${item.role}`}>
                <div className="conversation-meta">{item.role === "user" ? "Вы" : "NEXUM"} · {new Date(item.timestamp).toLocaleTimeString()}</div>
                <div className="conversation-content">{item.content}</div>
                {item.attachments?.length ? <div className="conversation-attachments">{item.attachments.map((name) => <span key={name}>{name}</span>)}</div> : null}
              </article>
            ))}
          </div>
        )}

        {reply && messages.length === 0 && <div className="reply" aria-live="polite">{reply}</div>}

        <div className={`agent-activity agent-activity-live ${busy ? "active" : ""}`} aria-live="polite">
          <span className={`activity-dot ${busy ? "working" : ""}`} />
          <div className="activity-copy"><strong>{stageLabel}</strong><span>{busy ? "NEXUM выполняет задачу" : "Готов к следующей задаче"}</span></div>
          <button type="button" onClick={onOpenAgent}>Открыть</button>
        </div>
      </div>

      <form className="message-form" onSubmit={(event) => { event.preventDefault(); handleSubmit(); }}>
        {sendingText && <div className="composer-flight" aria-hidden="true"><span>{sendingText}</span></div>}
        <div className="message-box">
          <textarea
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder="Опишите, что создать или изменить…"
            aria-label="Опишите задачу"
            disabled={busy}
          />
          {attachments.length > 0 && (
            <div className="attachment-strip">
              {attachments.map((item) => <span className="attachment-chip" key={item.id}>{item.name}<button type="button" aria-label={`Удалить ${item.name}`} onClick={() => onRemoveAttachment(item.id)}>×</button></span>)}
            </div>
          )}
          <div className="composer-actions">
            <button type="button" className="attach-button" disabled={busy} onClick={() => inputRef.current?.click()}>＋ Прикрепить</button>
            <input ref={inputRef} type="file" multiple hidden onChange={(event) => { if (event.target.files) onFilesSelected([...event.target.files]); event.currentTarget.value = ""; }} />
            <div className="starter-grid">
              {STARTERS.map(([label, task]) => <button key={label} type="button" disabled={busy} onClick={() => onQuickTask(task)}>{label}</button>)}
            </div>
            <span className="composer-hint">До 5 файлов · 2 МБ</span>
          </div>
        </div>
        <button className="send-button" type="submit" aria-label="Отправить задачу агенту NEXUM" disabled={busy || !message.trim()}>↑</button>
      </form>

      {apiError && <div className="chat-error-fixed" role="alert"><span>{apiError}</span><button type="button" className="retry-button" onClick={onRetry}>Повторить</button></div>}
      <div className="chat-footer-fixed"><span>⌘/Ctrl + K · команды</span><button className="quick-git" type="button" onClick={() => onQuickTask("Покажи статус Git")}>Git</button></div>
    </section>
  );
}
