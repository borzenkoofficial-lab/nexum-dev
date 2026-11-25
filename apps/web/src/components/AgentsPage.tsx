import { useEffect, useMemo, useState } from "react";
import type { Project } from "./types";

type Job = { id: string; status: string; createdAt: number; updatedAt: number; error?: string; problems?: Array<{ message: string; source?: string }> };
type HistoryEntry = { timestamp?: string; type?: string; jobId?: string; projectId?: string; provider?: string; model?: string; status?: string; message?: string; tool?: string };
type Diagnostics = { jobs?: Job[]; recent?: HistoryEntry[]; failureCount?: number; generatedAt?: string };
type Profile = { id: string; name: string; description: string; prompt: string; kind: string; custom?: boolean };

const STORAGE_KEY = "kvard:agent-profiles:v1";
const builtInProfiles: Profile[] = [
  { id: "builder", name: "Разработчик", description: "Проектирует и реализует функции в существующем проекте.", kind: "Разработка", prompt: "Работай как ведущий full-stack разработчик. Изучи структуру проекта и существующие соглашения, затем спланируй и реализуй задачу. Сохраняй совместимость API и текущего поведения. Добавь или обнови тесты, запусти проверки и сообщи точные результаты. Не заявляй о выполнении непроверенных действий." },
  { id: "auditor", name: "Технический аудитор", description: "Проверяет архитектуру, безопасность, качество кода и риски.", kind: "Анализ", prompt: "Проведи технический аудит проекта. Изучи архитектуру, зависимости, безопасность, обработку ошибок, производительность и тестовое покрытие. Сначала зафиксируй подтверждённые проблемы с файлами и строками, затем исправь критичные дефекты, если это безопасно. Запусти релевантные проверки и отдели найденные факты от предположений." },
  { id: "tester", name: "Инженер тестирования", description: "Находит регрессии и усиливает автоматические проверки.", kind: "Качество", prompt: "Работай как QA automation engineer. Изучи критические пользовательские сценарии и текущие тесты. Найди пробелы, добавь тесты на реальные граничные случаи, запусти их и устрани обнаруженные регрессии, если причина однозначна. В отчёте перечисли команды и фактические результаты." },
  { id: "devops", name: "DevOps-инженер", description: "Исследует сборку, окружение, контейнеры и процесс развёртывания.", kind: "Инфраструктура", prompt: "Работай как DevOps-инженер. Проверь конфигурацию сборки, Docker, переменные окружения, CI/CD, health checks и логи запуска. Не раскрывай секреты и не меняй production-инфраструктуру. Исправь подтверждённые проблемы в репозитории, запусти безопасные проверки и опиши оставшиеся ручные шаги." },
];

function readProfiles(): Profile[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as unknown;
    return Array.isArray(saved) ? saved.filter((item): item is Profile => Boolean(item && typeof item.id === "string" && typeof item.name === "string" && typeof item.prompt === "string" && item.custom === true)) : [];
  } catch { return []; }
}

function statusText(status: string) {
  const labels: Record<string, string> = { queued: "В очереди", running: "Выполняется", completed: "Завершено", failed: "Ошибка", cancelled: "Отменено" };
  return labels[status] ?? status;
}

function dateText(value?: number | string) {
  if (!value) return "Время неизвестно";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? "Время неизвестно" : date.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function AgentsPage({ projects, onUseProfile, onCreateProject }: {
  projects: Project[];
  onUseProfile: (projectId: string, prompt: string) => void;
  onCreateProject: (description: string) => void;
}) {
  const [diagnostics, setDiagnostics] = useState<Diagnostics>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedProject, setSelectedProject] = useState(projects.find((item) => item.status === "active")?.id ?? "");
  const [customProfiles, setCustomProfiles] = useState<Profile[]>(readProfiles);
  const [formOpen, setFormOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileDescription, setProfileDescription] = useState("");
  const [profilePrompt, setProfilePrompt] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!projects.some((item) => item.id === selectedProject && item.status === "active")) {
      setSelectedProject(projects.find((item) => item.status === "active")?.id ?? "");
    }
  }, [projects, selectedProject]);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/agent/diagnostics?limit=100");
      if (!response.ok) throw new Error(`Не удалось загрузить задания: HTTP ${response.status}`);
      setDiagnostics(await response.json() as Diagnostics);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Не удалось загрузить состояние агента");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const jobs = diagnostics.jobs ?? [];
  const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "running");
  const recentEvents = useMemo(() => (diagnostics.recent ?? []).filter((event) => event.type === "job-started" || event.type === "job-completed" || event.type === "job-failed" || event.type === "agent-event").slice(-8).reverse(), [diagnostics.recent]);
  const profiles = [...builtInProfiles, ...customProfiles];

  function saveProfile() {
    const name = profileName.trim();
    const prompt = profilePrompt.trim();
    if (!name || !prompt) { setFormError("Укажите название и инструкцию профиля."); return; }
    if (name.length > 48 || prompt.length > 5000) { setFormError("Название — до 48 символов, инструкция — до 5 000 символов."); return; }
    const next = [...customProfiles, { id: `custom-${Date.now()}`, name, description: profileDescription.trim() || "Пользовательский профиль запуска", prompt, kind: "Мой профиль", custom: true }];
    setCustomProfiles(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { setFormError("Браузер не разрешил сохранить профиль. Проверьте настройки хранилища."); return; }
    setProfileName(""); setProfileDescription(""); setProfilePrompt(""); setFormError(""); setFormOpen(false); setNotice("Профиль сохранён в этом браузере.");
  }

  function deleteProfile(profileId: string) {
    const next = customProfiles.filter((profile) => profile.id !== profileId);
    setCustomProfiles(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setNotice("Профиль удалён."); }
    catch { setFormError("Не удалось обновить локальное хранилище."); }
  }

  return (
    <section className="kv-agents-page">
      <header className="kv-agents-header">
        <div><p className="kv-home-eyebrow">КВАРД / AI-АГЕНТЫ</p><h1>Агенты и профили запуска</h1><p>Выбирайте рабочую роль, задавайте собственные инструкции и запускайте её в контексте проекта.</p></div>
        <button className="kv-agents-refresh" type="button" onClick={() => void load()} disabled={loading}>{loading ? "Обновление…" : "Обновить состояние"}</button>
      </header>

      <div className="kv-agents-notice" role="note"><span aria-hidden="true">i</span><p><strong>Как это работает сейчас.</strong> Профиль хранит инструкцию в этом браузере и передаёт её существующему AI Runtime как задачу. Постоянные автономные агенты с собственным расписанием, инструментами и серверной конфигурацией пока не включены.</p></div>
      {notice && <p className="kv-agents-feedback" role="status">{notice}</p>}
      {loadError && <div className="kv-agents-error" role="alert">{loadError} <button type="button" onClick={() => void load()}>Повторить</button></div>}

      <section className="kv-agents-profiles" aria-labelledby="kv-agents-profiles-title">
        <div className="kv-agents-section-head"><div><span>БИБЛИОТЕКА</span><h2 id="kv-agents-profiles-title">Профили задач</h2><p>Готовые роли и ваши собственные инструкции для агента.</p></div><button type="button" className="kv-agents-create" onClick={() => { setFormOpen((value) => !value); setFormError(""); }}>＋ Создать профиль</button></div>
        {formOpen && <form className="kv-agents-form" onSubmit={(event) => { event.preventDefault(); saveProfile(); }}>
          <div className="kv-agents-form-head"><div><strong>Новый профиль запуска</strong><small>Инструкция будет сохранена только в текущем браузере.</small></div><button type="button" aria-label="Закрыть форму" onClick={() => setFormOpen(false)}>×</button></div>
          <label>Название профиля<input value={profileName} onChange={(event) => setProfileName(event.target.value)} maxLength={48} placeholder="Например, Аналитик бизнес-процессов" required /></label>
          <label>Краткое описание<input value={profileDescription} onChange={(event) => setProfileDescription(event.target.value)} maxLength={140} placeholder="Для каких задач предназначен профиль" /></label>
          <label>Инструкция для агента<textarea value={profilePrompt} onChange={(event) => setProfilePrompt(event.target.value)} maxLength={5000} rows={5} placeholder="Опишите роль, цель, правила работы и ожидаемый результат…" required /></label>
          {formError && <p className="kv-agents-form-error" role="alert">{formError}</p>}
          <div className="kv-agents-form-footer"><span>{profilePrompt.length}/5000</span><button type="submit" className="kv-agents-primary">Сохранить профиль</button></div>
        </form>}

        <div className="kv-agents-launchbar"><label htmlFor="kv-agent-project">Проект для запуска</label><select id="kv-agent-project" value={selectedProject} onChange={(event) => setSelectedProject(event.target.value)} disabled={!projects.some((item) => item.status === "active")}><option value="">Выберите проект</option>{projects.filter((item) => item.status === "active").map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><span>{selectedProject ? "Инструкция откроется в Studio и останется доступной для редактирования до запуска." : "Сначала создайте или выберите проект."}</span></div>

        <div className="kv-agents-profile-list">
          {profiles.map((profile) => <article className="kv-agents-profile" key={profile.id}>
            <div className="kv-agents-profile-mark" aria-hidden="true">{profile.custom ? "＋" : profile.name.slice(0, 1)}</div>
            <div className="kv-agents-profile-copy"><div className="kv-agents-profile-meta"><span>{profile.kind}</span>{profile.custom && <b>МОЙ ПРОФИЛЬ</b>}</div><h3>{profile.name}</h3><p>{profile.description}</p></div>
            <div className="kv-agents-profile-actions"><button type="button" className="kv-agents-use" disabled={!selectedProject} onClick={() => onUseProfile(selectedProject, profile.prompt)}>Открыть в Studio <span aria-hidden="true">↗</span></button>{profile.custom && <button type="button" className="kv-agents-delete" onClick={() => deleteProfile(profile.id)} aria-label={`Удалить профиль ${profile.name}`}>Удалить</button>}</div>
          </article>)}
        </div>
        {!projects.some((item) => item.status === "active") && <div className="kv-agents-empty-project"><span>Нет активного проекта</span><button type="button" onClick={() => onCreateProject("Создай новый проект. Я хочу использовать в нём профиль AI-агента и запускать задачи по собственным инструкциям.")}>Создать проект</button></div>}
      </section>

      <section className="kv-agents-runtime" aria-labelledby="kv-agents-runtime-title">
        <div className="kv-agents-section-head"><div><span>RUNTIME</span><h2 id="kv-agents-runtime-title">Выполнение задач</h2><p>Состояние заданий, которое возвращает сервер.</p></div><div className="kv-agents-live-count"><strong>{activeJobs.length}</strong><span>активных</span></div></div>
        <div className="kv-agents-runtime-grid">
          <div className="kv-agents-runtime-main">
            <div className="kv-agents-table-head"><span>ИДЕНТИФИКАТОР</span><span>СТАТУС</span><span>ОБНОВЛЕНО</span></div>
            {loading && !jobs.length ? <p className="kv-agents-empty">Загружаю состояние Runtime…</p> : jobs.length ? jobs.slice().sort((a,b) => b.updatedAt-a.updatedAt).map((job) => <div className="kv-agents-job-row" key={job.id}><div><strong>{job.id.slice(0, 8)}</strong><small>{job.error || job.problems?.[0]?.message || "Задание AI Runtime"}</small></div><span className={`kv-agents-status ${job.status}`}>{statusText(job.status)}</span><time>{dateText(job.updatedAt)}</time></div>) : <p className="kv-agents-empty">Пока нет заданий в доступной истории. Запустите профиль в Studio — результаты появятся здесь.</p>}
          </div>
          <aside className="kv-agents-events"><div className="kv-agents-events-head"><strong>Последние события</strong><span>{recentEvents.length}</span></div>{recentEvents.length ? recentEvents.map((event, index) => <div className="kv-agents-event" key={event.jobId + (event.timestamp ?? index) + index}><i /><div><strong>{event.message || event.type || "Событие агента"}</strong><small>{dateText(event.timestamp)}{event.provider ? ` · ${event.provider}` : ""}{event.tool ? ` · ${event.tool}` : ""}</small></div></div>) : <p className="kv-agents-empty">События появятся после запуска задач.</p>}</aside>
        </div>
        <div className="kv-agents-runtime-footer"><span>{diagnostics.generatedAt ? `Данные обновлены ${dateText(diagnostics.generatedAt)}` : "Время обновления пока неизвестно"}</span><span>Ошибок в журнале: {diagnostics.failureCount ?? "—"}</span></div>
      </section>
    </section>
  );
}
