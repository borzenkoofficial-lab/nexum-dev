import { useRef, useState } from "react";
import type { AIProviderInfo, AIProviderStatus, AgentStage } from "./types";
import { KvardMark } from "./KvardMark.ts";
import { KvardPageHeader, KvardSurface } from "./ui/index.ts";

interface Props {
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
  projectName: string;
  jobId: string | null;
  onMessageChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onQuickTask: (value: string) => void;
  onFilesSelected: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onOpenAgent: () => void;
  onProviderChange: (id: string) => void;
  onModelChange: (value: string) => void;
}

export function BuilderChat(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const busy = Boolean(p.stage && !["completed", "error"].includes(p.stage));
  const selected = p.providers.find((item) => item.id === p.provider);
  const models = p.models.length ? p.models : [p.model];

  function send() {
    if (p.message.trim() && !busy) {
      setModelOpen(false);
      p.onSubmit();
    }
  }

  return (
    <KvardSurface as="section" className="nx-chat" variant="raised" padding="none" aria-label="Чат разработки">
      <KvardPageHeader
        className="nx-chat-head"
        headingLevel="h2"
        eyebrow="РАЗРАБОТКА"
        title="Задача для AI-агента"
        titleId="kv-builder-chat-title"
        actions={<button type="button" onClick={p.onOpenAgent} aria-label="Открыть ход выполнения задачи">
          AI-агент <span aria-hidden="true">{p.jobId ? "•" : "→"}</span>
        </button>}
      />

      <div className="nx-chat-scroll">
        {p.messages.length === 0 ? (
          <div className="nx-chat-empty">
            <KvardMark size={48} className="nx-chat-mark" />
            <h3>С чего начнём?</h3>
            <p>Опишите изменение или новый продукт. КВАРД изучит задачу, составит план и выполнит работу в текущем проекте.</p>
            <div className="nx-suggestions" aria-label="Примеры задач">
              {["Создать новый интерфейс", "Добавить функцию", "Найти и исправить ошибку"].map((value) => (
                <button key={value} type="button" onClick={() => p.onMessageChange(value)}>{value}<span aria-hidden="true">↗</span></button>
              ))}
            </div>
          </div>
        ) : (
          <div className="nx-messages" role="log" aria-label="История диалога" aria-live="polite" aria-relevant="additions">
            {p.messages.map((item) => (
              <article key={item.id} className={item.role === "user" ? "user" : ""}>
                <small>{item.role === "user" ? "Вы" : "КВАРД"} · {new Date(item.timestamp).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</small>
                <div>{item.content}</div>
                {item.attachments?.length ? <aside aria-label="Прикреплённые файлы">{item.attachments.map((name) => <span key={name}>{name}</span>)}</aside> : null}
              </article>
            ))}
          </div>
        )}
        {p.reply && !p.messages.length && <div className="nx-live-reply">{p.reply}</div>}
        {p.apiError && <div className="nx-error" role="alert"><span>{p.apiError}</span><button type="button" onClick={p.onRetry}>Повторить задачу</button></div>}
      </div>

      <form className="nx-composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
        {p.attachments.length > 0 && (
          <div className="nx-attachments" aria-label="Файлы к отправке">
            {p.attachments.map((item) => (
              <span key={item.id}>{item.name}<button type="button" aria-label={`Удалить файл ${item.name}`} onClick={() => p.onRemoveAttachment(item.id)}>×</button></span>
            ))}
          </div>
        )}
        <textarea
          aria-label="Опишите задачу для КВАРД"
          value={p.message}
          disabled={busy}
          onChange={(event) => p.onMessageChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder="Опишите, что создать или изменить…"
        />
        <div className="nx-composer-row">
          <div className="nx-composer-left">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>＋ Прикрепить</button>
            <input ref={fileRef} hidden type="file" multiple aria-label="Выбрать файлы для задачи" onChange={(event) => {
              if (event.target.files) p.onFilesSelected([...event.target.files]);
              event.currentTarget.value = "";
            }} />
            <div className="nx-model">
              <button type="button" disabled={busy} aria-expanded={modelOpen} aria-controls="kv-model-picker" onClick={() => setModelOpen((open) => !open)}>
                <b>{p.model}</b><small>{selected?.name ?? p.provider}</small><span aria-hidden="true">⌄</span>
              </button>
              {modelOpen && (
                <div className="nx-model-pop" id="kv-model-picker" role="group" aria-label="Выбор AI-модели">
                  <strong>Провайдер</strong>
                  {p.providers.map((item) => (
                    <button type="button" key={item.id} className={item.id === p.provider ? "selected" : ""} aria-pressed={item.id === p.provider} onClick={() => p.onProviderChange(item.id)}>{item.name}</button>
                  ))}
                  <hr />
                  <strong>Модель</strong>
                  {models.map((item) => (
                    <button type="button" key={item} className={item === p.model ? "selected" : ""} aria-pressed={item === p.model} onClick={() => { p.onModelChange(item); setModelOpen(false); }}>{item}{item === p.model ? " ✓" : ""}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="nx-composer-right">
            {busy
              ? <button type="button" className="nx-cancel" aria-label="Отменить выполнение задачи" onClick={p.onCancel}>Остановить</button>
              : <button className="nx-send" type="submit" aria-label="Отправить задачу AI-агенту КВАРД" disabled={!p.message.trim()}>↑</button>}
          </div>
        </div>
      </form>
      <footer><span>Enter — отправить · Shift + Enter — новая строка</span><button type="button" onClick={() => p.onQuickTask("Покажи статус Git")}>Статус Git</button></footer>
    </KvardSurface>
  );
}
