import { useEffect, useRef, useState } from "react";
import type { AIProviderInfo, AIProviderStatus, AgentStage } from "./types";

interface ChatPanelProps {
  message: string;
  reply: string;
  stage: AgentStage;
  apiError: string;
  messages: Array<{ id: string; role: "user" | "assistant"; content: string; timestamp: number; attachments?: string[] }>;
  attachments: Array<{ id: string; name: string; type: string; size: number; file: File }>;
  providers: AIProviderInfo[];
  models: string[];
  provider: string;
  model: string;
  aiStatus: AIProviderStatus | null;
  onMessageChange: (message: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onQuickTask: (task: string) => void;
  onFilesSelected: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onOpenAgent: () => void;
  onProviderChange: (id: string) => void;
  onModelChange: (model: string) => void;
  projectName: string;
  jobId: string | null;
}


export function ChatPanel({
  message, reply, stage, apiError, messages, attachments, providers, models, provider, model, aiStatus,
  onMessageChange, onSubmit, onCancel, onRetry, onQuickTask, onFilesSelected, onRemoveAttachment, onOpenAgent,
  onProviderChange, onModelChange, projectName, jobId,
}: ChatPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const touchStartX = useRef<number | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const busy = Boolean(stage && !["completed", "error"].includes(stage));
  const liveJob = Boolean(jobId);
  const selectedProvider = providers.find((item) => item.id === provider);
  const modelList = models.length > 0 ? models : [model];

  function handleTouchStart(event: React.TouchEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("textarea, input, button, [role=\"dialog\"]")) {
      touchStartX.current = null;
      return;
    }
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }
  function handleTouchEnd(event: React.TouchEvent<HTMLElement>) {
    const start = touchStartX.current; touchStartX.current = null;
    const end = event.changedTouches[0]?.clientX;
    const target = event.target as HTMLElement;
    if (target.closest("textarea, input, button, [role=\"dialog\"]")) return;
    if (start != null && end != null && start - end > 64) onOpenAgent();
  }
  function handleSubmit() {
    if (!message.trim() || busy) return;
    setModelOpen(false);
    onSubmit();
  }

  useEffect(() => {
    if (!modelOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setModelOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modelOpen]);

  return (
    <section className="chat" aria-label="Чат NEXUM" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <div className="chat-history">
        <div className="chat-project-context">
          <span className="context-dot" />
          <div><small>Проект</small><strong>{projectName}</strong></div>
          <span className="chat-context-state"><i /> workspace ready</span>
        </div>

        {messages.length === 0 ? (
          <div className="welcome">
            <span className="eyebrow">NEXUM / BUILDER</span><h1>Что создаём?</h1>
            <p>Опишите продукт обычным языком. NEXUM разложит задачу на архитектуру, интерфейс и логику, затем покажет живой результат.</p>
            <div className="builder-editorial-preview" aria-hidden="true">
              <div className="builder-preview-chrome"><span/><span/><span/><b>PROJECT / LIVE BUILD</b><em>● READY</em></div>
              <div className="builder-preview-body"><div className="builder-preview-sidebar"><i/><i/><i/><i/></div><div className="builder-preview-canvas"><div className="builder-preview-top"><small>YOUR PRODUCT</small><b>Describe it. NEXUM builds it.</b></div><div className="builder-preview-blocks"><i/><i/><i/></div><div className="builder-preview-footer"><span>Preview</span><span>Agent</span><span>Iteration</span></div></div><div className="builder-preview-agent"><small>AGENT</small><b>Ready to build</b><span>Analyze → Plan → Build → Verify</span><i/></div></div>
            </div>
          </div>
        ) : (
          <div className="conversation" aria-live="polite">
            {messages.map((item) => (
              <article key={item.id} className={"conversation-message " + item.role}>
                <div className="conversation-meta">{item.role === "user" ? "Вы" : "NEXUM"} · {new Date(item.timestamp).toLocaleTimeString()}</div>
                <div className="conversation-content">{item.content}</div>
                {item.attachments?.length ? <div className="conversation-attachments">{item.attachments.map((name) => <span key={name}>{name}</span>)}</div> : null}
              </article>
            ))}
          </div>
        )}

        {reply && messages.length === 0 && <div className="reply" aria-live="polite">{reply}</div>}
        <div className={"agent-activity agent-activity-live " + (busy ? "active" : "")} aria-live="polite">
          <span className={"activity-dot " + (busy ? "working" : "")} />
          <div className="activity-copy"><strong>{liveJob && busy ? "NEXUM выполняет задачу" : "Готов к следующей задаче"}</strong><span>{busy ? "Откройте Agent справа для деталей" : "Опишите следующую итерацию ниже"}</span></div>
          <button type="button" onClick={onOpenAgent}>Открыть</button>{liveJob && busy && <button type="button" className="composer-cancel" onClick={onCancel} aria-label="Отменить задачу Agent">Отменить</button>}
        </div>
      </div>

      <form className="message-form" onSubmit={(event) => { event.preventDefault(); handleSubmit(); }}>
        <div className="message-box">
          {attachments.length > 0 && <div className="attachment-strip">{attachments.map((item) => <span className="attachment-chip" key={item.id}>{item.name}<button type="button" aria-label={"Удалить " + item.name} onClick={() => onRemoveAttachment(item.id)}>×</button></span>)}</div>}
          <textarea value={message} onChange={(event) => onMessageChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); handleSubmit(); } }} placeholder="Опишите, что создать или изменить…" aria-label="Опишите задачу" disabled={busy} />
          <div className="composer-toolbar">
            <div className="composer-left-actions">
              <button type="button" className="composer-tool" disabled={busy} onClick={() => inputRef.current?.click()}><span>＋</span>Файл</button>
              <input ref={inputRef} type="file" multiple hidden onChange={(event) => { if (event.target.files) onFilesSelected([...event.target.files]); event.currentTarget.value = ""; }} />
              <div className="model-dock-wrap">
                <button type="button" className={"composer-model-button " + (modelOpen ? "open" : "")} aria-haspopup="dialog" aria-expanded={modelOpen} onClick={() => setModelOpen((open) => !open)} disabled={busy}>
                  <span className="model-provider-mark">{(selectedProvider?.name ?? provider).slice(0, 1).toUpperCase()}</span>
                  <span><b>{model}</b><small>{selectedProvider?.name ?? provider}</small></span><em>⌄</em>
                </button>
                {modelOpen && <><button className="model-dock-scrim" type="button" aria-label="Закрыть выбор модели" onClick={() => setModelOpen(false)} /><div className="model-dock" role="dialog" aria-label="Выбор AI модели">
                  <div className="model-dock-head"><div><span className="eyebrow">AI ENGINE</span><strong>Выберите модель</strong><small>Модель применяется к следующей задаче.</small></div><button type="button" onClick={() => setModelOpen(false)}>×</button></div>
                  <div className="model-provider-tabs">{providers.map((item) => <button type="button" key={item.id} className={item.id === provider ? "active" : ""} onClick={() => onProviderChange(item.id)}>{item.name}<i /></button>)}</div>
                  <div className="model-list">{modelList.map((item) => <button type="button" key={item} className={item === model ? "selected" : ""} onClick={() => { onModelChange(item); setModelOpen(false); }}><span className="model-list-mark">{item.slice(0, 1).toUpperCase()}</span><span><strong>{item}</strong><small>{item === model ? "Выбрана сейчас" : "AI model · context ready"}</small></span>{item === model ? <b>✓</b> : <i>›</i>}</button>)}</div>
                  <div className="model-dock-footer"><span><i className={aiStatus?.available ? "online" : ""} />{aiStatus?.available ? "Подключено" : "Готово к выбору"}</span><small>Настройка сохраняется в текущей сессии</small></div>
                </div></>}
              </div>
            </div>
            <div className="composer-right-actions"><span className="composer-hint">До 5 файлов · 2 МБ</span><button className="send-button" type="submit" aria-label="Отправить задачу агенту NEXUM" disabled={busy || !message.trim()}>↑</button></div>
          </div>
        </div>
      </form>

      {apiError && <div className="chat-error-fixed" role="alert"><span>{apiError}</span><button type="button" className="retry-button" onClick={onRetry}>Повторить</button></div>}
      <div className="chat-footer-fixed"><span>⌘/Ctrl + K · команды</span><button className="quick-git" type="button" onClick={() => onQuickTask("Покажи статус Git")}>Git</button></div>
    </section>
  );
}
