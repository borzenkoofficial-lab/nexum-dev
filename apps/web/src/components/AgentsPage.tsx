import { useCallback, useEffect, useMemo, useState } from "react";
import type { Project } from "./types";

type Job = { id: string; status: string; createdAt: number; updatedAt: number; error?: string; problems?: Array<{ message: string; source?: string }> };
type HistoryEntry = { timestamp?: string; type?: string; jobId?: string; projectId?: string; provider?: string; model?: string; status?: string; message?: string; tool?: string };
type Diagnostics = { jobs?: Job[]; recent?: HistoryEntry[]; failureCount?: number; generatedAt?: string };
type Profile = { id: string; name: string; description: string; prompt: string; kind: string; custom?: boolean };
type AgentDefinition = { id: string; name: string; description: string; systemPrompt: string; provider: string | null; model: string | null; allowedTools: string[]; approvalPolicy: "always" | "writes" | "autonomous"; status: "active" | "paused"; createdAt: number; updatedAt: number };
const availableAgentTools = [{ id: "listFiles", label: "Список файлов" }, { id: "readFile", label: "Чтение файлов" }, { id: "searchFiles", label: "Поиск по проекту" }, { id: "git", label: "Git" }, { id: "github", label: "GitHub" }, { id: "validateProject", label: "Проверка проекта" }, { id: "testProject", label: "Запуск тестов" }, { id: "writeFile", label: "Создание файлов" }, { id: "patchFile", label: "Изменение файлов" }, { id: "scaffoldProject", label: "Создание структуры" }, { id: "runCommand", label: "Команды" }, { id: "runSandbox", label: "Изолированная среда" }];
const builtInProfiles: Profile[] = [
  { id: "builder", name: "Разработчик", description: "Проектирует и реализует функции в существующем проекте.", kind: "Разработка", prompt: "Работай как ведущий full-stack разработчик. Изучи структуру проекта и существующие соглашения, затем спланируй и реализуй задачу. Сохраняй совместимость API и текущего поведения. Добавь или обнови тесты, запусти проверки и сообщи точные результаты. Не заявляй о выполнении непроверенных действий." },
  { id: "auditor", name: "Технический аудитор", description: "Проверяет архитектуру, безопасность, качество кода и риски.", kind: "Анализ", prompt: "Проведи технический аудит проекта. Изучи архитектуру, зависимости, безопасность, обработку ошибок, производительность и тестовое покрытие. Сначала зафиксируй подтверждённые проблемы с файлами и строками, затем исправь критичные дефекты, если это безопасно. Запусти релевантные проверки и отдели найденные факты от предположений." },
  { id: "tester", name: "Инженер тестирования", description: "Находит регрессии и усиливает автоматические проверки.", kind: "Качество", prompt: "Работай как QA automation engineer. Изучи критические пользовательские сценарии и текущие тесты. Найди пробелы, добавь тесты на реальные граничные случаи, запусти их и устрани обнаруженные регрессии, если причина однозначна. В отчёте перечисли команды и фактические результаты." },
  { id: "devops", name: "DevOps-инженер", description: "Исследует сборку, окружение, контейнеры и процесс развёртывания.", kind: "Инфраструктура", prompt: "Работай как DevOps-инженер. Проверь конфигурацию сборки, Docker, переменные окружения, CI/CD, health checks и логи запуска. Не раскрывай секреты и не меняй production-инфраструктуру. Исправь подтверждённые проблемы в репозитории, запусти безопасные проверки и опиши оставшиеся ручные шаги." },
];

function statusText(status: string) {
  const labels: Record<string, string> = { queued: "В очереди", running: "Выполняется", completed: "Завершено", failed: "Ошибка", cancelled: "Отменено" };
  return labels[status] ?? status;
}

function dateText(value?: number | string) {
  if (!value) return "Время неизвестно";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? "Время неизвестно" : date.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function AgentsPage({ projects, onUseProfile, onUseAgent, onCreateProject }: {
  projects: Project[];
  onUseProfile: (projectId: string, prompt: string) => void;
  onUseAgent: (projectId: string, agentId: string, task: string) => void;
  onCreateProject: (description: string) => void;
}) {
  const [diagnostics, setDiagnostics] = useState<Diagnostics>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedProject, setSelectedProject] = useState(projects.find((item) => item.status === "active")?.id ?? "");
  const [customProfiles, setCustomProfiles] = useState<Profile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileStorage, setProfileStorage] = useState<"database" | "memory" | "unknown">("unknown");
  const [profileLoadError, setProfileLoadError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileDescription, setProfileDescription] = useState("");
  const [profilePrompt, setProfilePrompt] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [agentsStorage, setAgentsStorage] = useState<"database" | "memory" | "unknown">("unknown");
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState("");
  const [agentFormOpen, setAgentFormOpen] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentProvider, setAgentProvider] = useState("");
  const [agentModel, setAgentModel] = useState("");
  const [agentTools, setAgentTools] = useState<string[]>([]);
  const [agentApproval, setAgentApproval] = useState<AgentDefinition["approvalPolicy"]>("always");
  const [agentFormError, setAgentFormError] = useState("");
  const [agentSaving, setAgentSaving] = useState(false);
  const [agentTask, setAgentTask] = useState("");

  useEffect(() => {
    if (!projects.some((item) => item.id === selectedProject && item.status === "active")) {
      setSelectedProject(projects.find((item) => item.status === "active")?.id ?? "");
    }
  }, [projects, selectedProject]);

  const load = useCallback(async () => {
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
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadProfiles = useCallback(async () => {
    setProfilesLoading(true);
    setProfileLoadError("");
    try {
      const response = await fetch("/api/agent/profiles");
      const data = await response.json() as { profiles?: Array<Omit<Profile, "custom">>; storage?: "database" | "memory"; error?: string };
      if (!response.ok) throw new Error(data.error || `Ошибка загрузки профилей: HTTP ${response.status}`);
      setCustomProfiles((data.profiles ?? []).map((profile) => ({ ...profile, custom: true })));
      setProfileStorage(data.storage ?? "unknown");
    } catch (error) {
      setProfileLoadError(error instanceof Error ? error.message : "Не удалось загрузить пользовательские профили");
    } finally {
      setProfilesLoading(false);
    }
  }, []);

  useEffect(() => { void loadProfiles(); }, [loadProfiles]);

  const loadAgents = useCallback(async () => {
    setAgentsLoading(true);
    setAgentsError("");
    try {
      const response = await fetch("/api/agents");
      const data = await response.json() as { agents?: AgentDefinition[]; storage?: "database" | "memory"; error?: string };
      if (!response.ok) throw new Error(data.error || `Не удалось загрузить агентов: HTTP ${response.status}`);
      setAgents(data.agents ?? []);
      setAgentsStorage(data.storage ?? "unknown");
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : "Не удалось загрузить агентов");
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  useEffect(() => { void loadAgents(); }, [loadAgents]);

  const jobs = diagnostics.jobs ?? [];
  const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "running");
  const recentEvents = useMemo(() => (diagnostics.recent ?? []).filter((event) => event.type === "job-started" || event.type === "job-completed" || event.type === "job-failed" || event.type === "agent-event").slice(-8).reverse(), [diagnostics.recent]);
  const profiles = [...builtInProfiles, ...customProfiles];

  async function saveProfile() {
    const name = profileName.trim();
    const prompt = profilePrompt.trim();
    if (!name || !prompt) { setFormError("Укажите название и инструкцию профиля."); return; }
    if (name.length > 48 || prompt.length > 5000) { setFormError("Название — до 48 символов, инструкция — до 5 000 символов."); return; }
    setFormError("");
    setProfileSaving(true);
    try {
      const response = await fetch("/api/agent/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: profileDescription.trim(), prompt, kind: "Мой профиль" }),
      });
      const data = await response.json() as { profile?: Omit<Profile, "custom">; storage?: "database" | "memory"; error?: string };
      if (!response.ok || !data.profile) throw new Error(data.error || `Не удалось сохранить профиль: HTTP ${response.status}`);
      setCustomProfiles((items) => [...items, { ...data.profile!, custom: true }]);
      setProfileStorage(data.storage ?? profileStorage);
      setProfileName(""); setProfileDescription(""); setProfilePrompt(""); setFormOpen(false);
      setNotice(profileStorage === "database" || data.storage === "database" ? "Профиль сохранён в аккаунте." : "Профиль сохранён в памяти сервера.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Не удалось сохранить профиль.");
    } finally {
      setProfileSaving(false);
    }
  }

  function openAgentForm(agent?: AgentDefinition) {
    setEditingAgentId(agent?.id ?? "");
    setAgentName(agent?.name ?? "");
    setAgentDescription(agent?.description ?? "");
    setAgentPrompt(agent?.systemPrompt ?? "");
    setAgentProvider(agent?.provider ?? "");
    setAgentModel(agent?.model ?? "");
    setAgentTools(agent?.allowedTools ?? []);
    setAgentApproval(agent?.approvalPolicy ?? "always");
    setAgentFormError("");
    setAgentFormOpen(true);
  }

  async function saveAgent() {
    const name = agentName.trim();
    const systemPrompt = agentPrompt.trim();
    if (!name || !systemPrompt) { setAgentFormError("Укажите название и системную инструкцию."); return; }
    setAgentSaving(true);
    setAgentFormError("");
    try {
      const payload = { name, description: agentDescription.trim(), systemPrompt, provider: agentProvider.trim() || null, model: agentModel.trim() || null, allowedTools: agentTools, approvalPolicy: agentApproval, ...(!editingAgentId ? { status: "active" as const } : {}) };
      const response = await fetch(editingAgentId ? `/api/agents/${encodeURIComponent(editingAgentId)}` : "/api/agents", {
        method: editingAgentId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json() as { agent?: AgentDefinition; storage?: "database" | "memory"; error?: string };
      if (!response.ok || !data.agent) throw new Error(data.error || `Не удалось сохранить агента: HTTP ${response.status}`);
      setAgents((items) => editingAgentId ? items.map((item) => item.id === data.agent!.id ? data.agent! : item) : [data.agent!, ...items]);
      if (data.storage) setAgentsStorage(data.storage);
      setAgentFormOpen(false);
      setNotice(editingAgentId ? "Настройки агента обновлены." : "Агент сохранён.");
    } catch (error) {
      setAgentFormError(error instanceof Error ? error.message : "Не удалось сохранить агента.");
    } finally {
      setAgentSaving(false);
    }
  }

  async function toggleAgent(agent: AgentDefinition) {
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agent.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: agent.status === "active" ? "paused" : "active" }),
      });
      const data = await response.json() as { agent?: AgentDefinition; error?: string };
      if (!response.ok || !data.agent) throw new Error(data.error || "Не удалось изменить статус агента.");
      setAgents((items) => items.map((item) => item.id === agent.id ? data.agent! : item));
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : "Не удалось изменить статус агента.");
    }
  }

  async function removeAgent(agent: AgentDefinition) {
    if (!window.confirm(`Удалить агента «${agent.name}»?`)) return;
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agent.id)}`, { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось удалить агента.");
      setAgents((items) => items.filter((item) => item.id !== agent.id));
      setNotice("Агент удалён.");
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : "Не удалось удалить агента.");
    }
  }

  async function deleteProfile(profileId: string) {
    const profile = customProfiles.find((item) => item.id === profileId);
    if (!profile || !window.confirm(`Удалить профиль «${profile.name}»?`)) return;
    try {
      const response = await fetch(`/api/agent/profiles/${encodeURIComponent(profileId)}`, { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || `Не удалось удалить профиль: HTTP ${response.status}`);
      setCustomProfiles((items) => items.filter((item) => item.id !== profileId));
      setNotice("Профиль удалён.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Не удалось удалить профиль.");
    }
  }

  return (
    <section className="kv-agents-page">
      <header className="kv-agents-header">
        <div><p className="kv-home-eyebrow">КВАРД / AI-АГЕНТЫ</p><h1>Агенты и профили запуска</h1><p>Выбирайте рабочую роль, задавайте собственные инструкции и запускайте её в контексте проекта.</p></div>
        <button className="kv-agents-refresh" type="button" onClick={() => void load()} disabled={loading}>{loading ? "Обновление…" : "Обновить состояние"}</button>
      </header>

      <div className="kv-agents-notice" role="note"><span aria-hidden="true">i</span><p><strong>Как это работает сейчас.</strong> Профили запускают задачи в существующем AI Runtime. Отдельные конфигурации агентов теперь можно создавать и хранить в аккаунте; расписания, триггеры и фактическое применение разрешений инструментов ещё не подключены.</p></div>
      {notice && <p className="kv-agents-feedback" role="status">{notice}</p>}
      {loadError && <div className="kv-agents-error" role="alert">{loadError} <button type="button" onClick={() => void load()}>Повторить</button></div>}

      <section className="kv-agents-profiles" aria-labelledby="kv-agents-profiles-title">
        <div className="kv-agents-section-head"><div><span>БИБЛИОТЕКА</span><h2 id="kv-agents-profiles-title">Профили задач</h2><p>Готовые роли и ваши собственные инструкции для агента.</p></div><button type="button" className="kv-agents-create" onClick={() => { setFormOpen((value) => !value); setFormError(""); }}>＋ Создать профиль</button></div>
        {formOpen && <form className="kv-agents-form" onSubmit={(event) => { event.preventDefault(); void saveProfile(); }}>
          <div className="kv-agents-form-head"><div><strong>Новый профиль запуска</strong><small>Сохранение выполняется через сервер API. Режим хранения указан под библиотекой.</small></div><button type="button" aria-label="Закрыть форму" onClick={() => setFormOpen(false)}>×</button></div>
          <label>Название профиля<input value={profileName} onChange={(event) => setProfileName(event.target.value)} maxLength={48} placeholder="Например, Аналитик бизнес-процессов" required /></label>
          <label>Краткое описание<input value={profileDescription} onChange={(event) => setProfileDescription(event.target.value)} maxLength={140} placeholder="Для каких задач предназначен профиль" /></label>
          <label>Инструкция для агента<textarea value={profilePrompt} onChange={(event) => setProfilePrompt(event.target.value)} maxLength={5000} rows={5} placeholder="Опишите роль, цель, правила работы и ожидаемый результат…" required /></label>
          {formError && <p className="kv-agents-form-error" role="alert">{formError}</p>}
          <div className="kv-agents-form-footer"><span>{profilePrompt.length}/5000</span><button type="submit" className="kv-agents-primary" disabled={profileSaving}>{profileSaving ? "Сохраняю…" : "Сохранить профиль"}</button></div>
        </form>}

        <div className="kv-agents-launchbar"><label htmlFor="kv-agent-project">Проект для запуска</label><select id="kv-agent-project" value={selectedProject} onChange={(event) => setSelectedProject(event.target.value)} disabled={!projects.some((item) => item.status === "active")}><option value="">Выберите проект</option>{projects.filter((item) => item.status === "active").map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><span>{selectedProject ? "Инструкция откроется в Studio и останется доступной для редактирования до запуска." : "Сначала создайте или выберите проект."}</span></div>

        {profileLoadError && <div className="kv-agents-error" role="alert">{profileLoadError} <button type="button" onClick={() => void loadProfiles()}>Повторить</button></div>}
        {profileStorage === "memory" && <p className="kv-agents-storage-warning" role="status">База данных не подключена: пользовательские профили хранятся в памяти сервера и будут потеряны после его перезапуска.</p>}
        {profileStorage === "database" && <p className="kv-agents-storage-ok">Пользовательские профили сохраняются в базе данных аккаунта.</p>}
        {profileStorage === "unknown" && profilesLoading && <p className="kv-agents-empty">Проверяю хранилище профилей…</p>}
        <div className="kv-agents-profile-list">
          {profilesLoading && <p className="kv-agents-empty">Загружаю пользовательские профили…</p>}
          {profiles.map((profile) => <article className="kv-agents-profile" key={profile.id}>
            <div className="kv-agents-profile-mark" aria-hidden="true">{profile.custom ? "＋" : profile.name.slice(0, 1)}</div>
            <div className="kv-agents-profile-copy"><div className="kv-agents-profile-meta"><span>{profile.kind}</span>{profile.custom && <b>МОЙ ПРОФИЛЬ</b>}</div><h3>{profile.name}</h3><p>{profile.description}</p></div>
            <div className="kv-agents-profile-actions"><button type="button" className="kv-agents-use" disabled={!selectedProject} onClick={() => onUseProfile(selectedProject, profile.prompt)}>Открыть в Studio <span aria-hidden="true">↗</span></button>{profile.custom && <button type="button" className="kv-agents-delete" onClick={() => void deleteProfile(profile.id)} aria-label={`Удалить профиль ${profile.name}`}>Удалить</button>}</div>
          </article>)}
        </div>
        {!projects.some((item) => item.status === "active") && <div className="kv-agents-empty-project"><span>Нет активного проекта</span><button type="button" onClick={() => onCreateProject("Создай новый проект. Я хочу использовать в нём профиль AI-агента и запускать задачи по собственным инструкциям.")}>Создать проект</button></div>}
      </section>

      <section className="kv-agents-profiles" aria-labelledby="kv-agent-definitions-title">
        <div className="kv-agents-section-head"><div><span>AGENT CONTROL</span><h2 id="kv-agent-definitions-title">Мои AI-агенты</h2><p>Постоянные конфигурации с отдельными инструкциями и списком разрешённых инструментов.</p></div><button type="button" className="kv-agents-create" onClick={() => openAgentForm()}>＋ Создать агента</button></div>
        <div className="kv-agents-notice" role="note"><span aria-hidden="true">i</span><p><strong>Безопасный запуск.</strong> Активные агенты можно запускать вручную из Studio в автономном режиме только с инструментами чтения. Изменение файлов, команды и другие действия записи заблокированы. Политики с подтверждениями станут доступны после подключения очереди согласования. Расписания и триггеры пока не включены.</p></div>
        <div className="kv-agents-launchbar">
          <label htmlFor="kv-agent-task">Задача для выбранного агента</label>
          <textarea id="kv-agent-task" rows={3} value={agentTask} onChange={(event) => setAgentTask(event.target.value)} maxLength={5000} placeholder="Опишите, что агент должен изучить в выбранном проекте…" />
          <span>Сначала выберите проект выше. Запуск откроет задачу в Studio; перед отправкой её можно проверить.</span>
        </div>
        {agentsStorage === "memory" && <p className="kv-agents-storage-warning">База данных не подключена: агенты будут потеряны после перезапуска сервера.</p>}
        {agentsStorage === "database" && <p className="kv-agents-storage-ok">Конфигурации агентов хранятся в базе данных аккаунта.</p>}
        {agentsError && <div className="kv-agents-error" role="alert">{agentsError} <button type="button" onClick={() => void loadAgents()}>Повторить</button></div>}
        {agentFormOpen && <form className="kv-agents-form" onSubmit={(event) => { event.preventDefault(); void saveAgent(); }}>
          <div className="kv-agents-form-head"><div><strong>{editingAgentId ? "Настройки агента" : "Новый AI-агент"}</strong><small>Системная инструкция, модель и разрешённые инструменты</small></div><button type="button" aria-label="Закрыть форму" onClick={() => setAgentFormOpen(false)}>×</button></div>
          <label>Название<input value={agentName} onChange={(event) => setAgentName(event.target.value)} maxLength={48} required placeholder="Например, Агент отдела продаж" /></label>
          <label>Описание<input value={agentDescription} onChange={(event) => setAgentDescription(event.target.value)} maxLength={160} placeholder="Назначение агента" /></label>
          <label>Системная инструкция<textarea value={agentPrompt} onChange={(event) => setAgentPrompt(event.target.value)} maxLength={5000} rows={5} required placeholder="Роль, задачи, правила и ограничения агента…" /></label>
          <div className="kv-agents-launchbar"><label>Провайдер (необязательно)<select value={agentProvider} onChange={(event) => setAgentProvider(event.target.value)}><option value="">По умолчанию</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="openrouter">OpenRouter</option><option value="anymodel">AnyModel</option><option value="orcarouter">OrcaRouter</option><option value="ollama">Ollama</option></select></label><label>Модель (необязательно)<input value={agentModel} onChange={(event) => setAgentModel(event.target.value)} maxLength={120} placeholder="Например, gpt-…" /></label></div>
          <label>Политика подтверждения<select value={agentApproval} onChange={(event) => setAgentApproval(event.target.value as AgentDefinition["approvalPolicy"])}><option value="always">Подтверждать каждое действие</option><option value="writes">Подтверждать изменения</option><option value="autonomous">Автономная — только чтение</option></select></label>
          <fieldset className="kv-agents-tool-picker"><legend>Разрешённые инструменты</legend><div>{availableAgentTools.map((tool) => <label key={tool.id}><input type="checkbox" checked={agentTools.includes(tool.id)} onChange={(event) => setAgentTools((items) => event.target.checked ? [...items, tool.id] : items.filter((item) => item !== tool.id))} />{tool.label}</label>)}</div></fieldset>
          {agentFormError && <p className="kv-agents-form-error" role="alert">{agentFormError}</p>}
          <div className="kv-agents-form-footer"><span>{agentTools.length}/32 инструментов</span><button type="submit" className="kv-agents-primary" disabled={agentSaving}>{agentSaving ? "Сохраняю…" : "Сохранить агента"}</button></div>
        </form>}
        {agentsLoading ? <p className="kv-agents-empty">Загружаю конфигурации агентов…</p> : agents.length ? <div className="kv-agents-profile-list">{agents.map((agent) => <article className="kv-agents-profile" key={agent.id}>
          <div className="kv-agents-profile-mark" aria-hidden="true">A</div>
          <div className="kv-agents-profile-copy"><div className="kv-agents-profile-meta"><span>{agent.provider || "Провайдер по умолчанию"}</span><b>{agent.status === "active" ? "КОНФИГУРАЦИЯ ВКЛЮЧЕНА" : "ПРИОСТАНОВЛЕНА"}</b></div><h3>{agent.name}</h3><p>{agent.description || "Без описания"} · {agent.allowedTools.length} инструментов · {agent.approvalPolicy === "always" ? "требуется подтверждение каждого действия" : agent.approvalPolicy === "writes" ? "требуется подтверждение изменений" : "автономный режим: только чтение"}</p></div>
          <div className="kv-agents-profile-actions"><button type="button" className="kv-agents-use" disabled={!selectedProject || !agentTask.trim() || agent.status !== "active" || agent.approvalPolicy !== "autonomous" || agent.allowedTools.length === 0} onClick={() => onUseAgent(selectedProject, agent.id, agentTask.trim())}>Открыть в Studio</button><button type="button" className="kv-agents-use" onClick={() => openAgentForm(agent)}>Настроить</button><button type="button" className="kv-agents-delete" onClick={() => void toggleAgent(agent)}>{agent.status === "active" ? "Пауза" : "Активировать"}</button><button type="button" className="kv-agents-delete" onClick={() => void removeAgent(agent)}>Удалить</button></div>
        </article>)}</div> : <p className="kv-agents-empty">Пока нет созданных агентов. Создайте первого и сохраните его конфигурацию.</p>}
      </section>

      <section className="kv-agents-runtime" aria-labelledby="kv-agents-runtime-title">
        <div className="kv-agents-section-head"><div><span>RUNTIME</span><h2 id="kv-agents-runtime-title">Выполнение задач</h2><p>Состояние заданий, которое возвращает сервер.</p></div><div className="kv-agents-live-count"><strong>{activeJobs.length}</strong><span>активных</span></div></div>
        <div className="kv-agents-runtime-grid">
          <div className="kv-agents-runtime-main">
            <div className="kv-agents-table-head"><span>ИДЕНТИФИКАТОР</span><span>СТАТУС</span><span>ОБНОВЛЕНО</span></div>
            {loading && !jobs.length ? <p className="kv-agents-empty">Загружаю состояние Runtime…</p> : jobs.length ? jobs.slice().sort((a,b) => b.updatedAt-a.updatedAt).map((job) => <div className="kv-agents-job-row" key={job.id}><div><strong>{job.id.slice(0, 8)}</strong><small>{job.error || job.problems?.[0]?.message || "Задание AI Runtime"}</small></div><span className={`kv-agents-status ${job.status}`}>{statusText(job.status)}</span><time>{dateText(job.updatedAt)}</time></div>) : <p className="kv-agents-empty">Пока нет заданий в доступной истории. Запустите профиль в Studio — результаты появятся здесь.</p>}
          </div>
          <aside className="kv-agents-events"><div className="kv-agents-events-head"><strong>Последние события</strong><span>{recentEvents.length}</span></div>{recentEvents.length ? recentEvents.map((event, index) => <div className="kv-agents-event" key={(event.jobId ?? "event") + String(event.timestamp ?? index) + index}><i /><div><strong>{event.message || event.type || "Событие агента"}</strong><small>{dateText(event.timestamp)}{event.provider ? ` · ${event.provider}` : ""}{event.tool ? ` · ${event.tool}` : ""}</small></div></div>) : <p className="kv-agents-empty">События появятся после запуска задач.</p>}</aside>
        </div>
        <div className="kv-agents-runtime-footer"><span>{diagnostics.generatedAt ? `Данные обновлены ${dateText(diagnostics.generatedAt)}` : "Время обновления пока неизвестно"}</span><span>Ошибок в журнале: {diagnostics.failureCount ?? "—"}</span></div>
      </section>
    </section>
  );
}
