import { useEffect, useRef, useState } from "react";
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

const CINEMATIC_PROMPTS = [
  "Пора создать что-то, чего ещё не было.",
  "Начнём с идеи. Остальное построим по ходу.",
  "Всё начинается с одного хорошего замысла.",
  "Система готова. Осталось дать ей задачу.",
  "Сегодня пишем код. Завтра запускаем.",
  "Не ждём идеального момента — создаём его.",
  "Большие проекты начинаются с маленького шага.",
  "Давайте соберём это с нуля.",
  "Идея есть. Теперь превратим её в продукт.",
  "Пусть машина делает работу, а вы задаёте направление.",
  "Сначала замысел. Потом архитектура. Потом результат.",
  "Создадим то, ради чего всё это началось.",
  "Каждый проект когда-то был пустым экраном.",
  "Начинаем разработку.",
  "Задача принята. Что строим?",
  "Время превращать мысли в код.",
  "Пусть первый коммит станет началом.",
  "Нам нужен план. И немного смелости.",
  "Сложное становится простым, когда разбито на шаги.",
  "Открываем чистый лист.",
  "Сегодня здесь появится приложение.",
  "Ваш замысел. Наше рабочее пространство.",
  "Код — это только начало истории.",
  "Создадим систему, которая работает за вас.",
  "Проверим границы возможного.",
  "Сначала вопрос. Затем решение.",
  "Проект ждёт своего первого действия.",
  "Всё готово к запуску.",
  "Давайте сделаем это правильно с первого раза.",
  "Идеи любят движение.",
  "Построим. Проверим. Улучшим.",
  "Не усложняем. Создаём.",
  "Одна задача — один следующий шаг.",
  "Начнём с того, что действительно важно.",
  "Пусть код говорит сам за себя.",
  "Создадим основу, на которой всё держится.",
  "Ваш следующий продукт начинается здесь.",
  "От идеи до работающего интерфейса.",
  "Соберём проект по кирпичику.",
  "Давайте заставим идею работать.",
  "Есть задача — найдём способ её решить.",
  "Ничего лишнего. Только то, что нужно продукту.",
  "Сначала сделаем работающим. Потом сделаем красивым.",
  "Проектирование начинается сейчас.",
  "Один хороший запрос может изменить весь проект.",
  "Вперёд. Компилятор ждёт.",
  "Пора открыть первую страницу.",
  "Создадим интерфейс, которым хочется пользоваться.",
  "Архитектура прежде хаоса.",
  "Нам не нужен волшебный момент. Нам нужен первый шаг.",
  "Давайте соберём машину.",
  "Каждая строка приближает результат.",
  "Пусть идея получит форму.",
  "От пустого экрана — к работающему продукту.",
  "Сделаем так, чтобы это действительно работало.",
  "Проект начинается с решения.",
  "Включаем режим разработки.",
  "Время строить.",
  "Не объясняйте слишком долго. Просто опишите идею.",
  "Сложная задача? Разложим её на части.",
  "Ваш замысел — наша следующая итерация.",
  "Проверим гипотезу кодом.",
  "Создадим первую версию и посмотрим, что получится.",
  "Пусть ошибки найдутся раньше пользователей.",
  "Тестируем. Исправляем. Повторяем.",
  "Хороший продукт начинается с хорошего вопроса.",
  "Сделаем прототип живым.",
  "Здесь может начаться новый продукт.",
  "Дайте идее имя — остальное построим.",
  "Код любит ясные задачи.",
  "Начинаем с нуля, но не вслепую.",
  "Соберём всё необходимое в одном месте.",
  "Новая сцена. Новый проект.",
  "Камера включена. Разработка начинается.",
  "Первый акт — архитектура.",
  "Второй акт — код.",
  "Финал — работающий продукт.",
  "У каждой идеи есть свой первый экран.",
  "Давайте напишем эту историю кодом.",
  "Сценарий у вас. Реализация — здесь.",
  "Создадим мир, в котором эта идея работает.",
  "Никаких дублей. Только рабочие итерации.",
  "Готовы? Тогда мотор.",
  "Проект на площадке.",
  "Начинаем сборку.",
  "Проверим, что получилось.",
  "Теперь сделаем ещё лучше.",
  "Следующая итерация начинается здесь.",
  "Сделаем один шаг — и ещё один.",
  "Пусть результат удивит вас.",
  "Идея заслуживает рабочего прототипа.",
  "Время дать форме содержимое.",
  "Построим продукт, а не просто экран.",
  "Найдём проблему до того, как она станет багом.",
  "Чистая архитектура. Чёткая задача.",
  "Ваш ход.",
  "NEXUM готов.",
  "Что будем создавать сегодня?"
];

export function ChatPanel({ message, reply, stage, apiError, messages, attachments, onMessageChange, onSubmit, onRetry, onQuickTask, onFilesSelected, onRemoveAttachment, onOpenAgent, projectName }: ChatPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sendingText, setSendingText] = useState("");
  const [promptIndex, setPromptIndex] = useState(0);
  const stageLabel = stage === "thinking" || stage === "analyzing" ? "Анализирую" : stage === "planning" ? "Планирую" : stage === "reading" ? "Читаю файлы" : stage === "editing" ? "Изменяю проект" : stage === "building" ? "Собираю" : stage === "testing" ? "Проверяю" : stage === "error" ? "Требуется внимание" : stage === "completed" ? "Готово" : "Готов";
  const busy = Boolean(stage && !["completed", "error"].includes(stage));

  useEffect(() => {
    const timer = window.setInterval(() => setPromptIndex((index) => (index + 1) % CINEMATIC_PROMPTS.length), 5200);
    return () => window.clearInterval(timer);
  }, []);

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
      <div className="welcome">
        <span className="eyebrow">NEXUM AGENT</span>
        <h1 className="cinematic-prompt" aria-live="polite" aria-label={CINEMATIC_PROMPTS[promptIndex]}>
          <span key={promptIndex} className="cinematic-prompt-text">{CINEMATIC_PROMPTS[promptIndex]}</span>
        </h1>
        <p>Опишите задачу. NEXUM работает в фоне: изменяет проект, собирает его и показывает результат.</p>
      </div>
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
