import { useCallback, useEffect, useMemo, useState } from "react";
import "./BusinessAgentsPage.css";

type Organization = { id: string; name: string; role: string };
type AgentTool = { id: string; name: string; description: string; requiredScopes: string[]; riskLevel: "low" | "medium" | "high" };
type BusinessAgent = {
  id: string; name: string; description: string; status: "draft" | "published" | "paused" | "archived";
  provider: string; model: string; version_number?: number; config?: Record<string, unknown>;
  created_at?: string; updated_at?: string;
};
type Approval = { id: string; action_summary?: string; status?: string; created_at?: string; run_id?: string };
type KnowledgeSource = { id: string; name: string; source_type?: string; created_at?: string };
type Workforce = { id: string; name: string; description?: string; graph?: unknown };
type Run = { id: string; status: string; input?: unknown; output?: unknown; error?: unknown; created_at?: string; finished_at?: string };
type Provider = { id: string; name?: string; models?: string[] };
type Tab = "agents" | "knowledge" | "teams" | "approvals" | "usage";

const ACTIVE_RUNS = new Set(["queued", "initializing", "planning", "running", "waiting_approval"]);
const defaultAgentPrompt = "Ты — бизнес-ассистент организации. Уточняй недостающие данные, работай строго в рамках предоставленных инструментов и знаний. Не выдумывай факты и не утверждай, что выполнил действия, которые не были подтверждены инструментом. Для внешних или необратимых действий запрашивай согласование.";

async function request<T>(path: string, organizationId?: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (organizationId) headers.set("X-Organization-Id", organizationId);
  const response = await fetch(path, { ...init, headers, credentials: "include" });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || payload.success === false) {
    const message = typeof payload.error === "string" ? payload.error : `Запрос завершился ошибкой (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

function statusLabel(status: string): string {
  return ({ draft: "Черновик", published: "Опубликован", paused: "Приостановлен", archived: "В архиве", queued: "В очереди", initializing: "Подготовка", planning: "Планирование", running: "Выполняется", waiting_approval: "Ожидает согласования", completed: "Завершён", failed: "Ошибка", cancelled: "Отменён", timed_out: "Тайм-аут", limit_reached: "Лимит достигнут" } as Record<string, string>)[status] ?? status;
}

export function BusinessAgentsPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [workspaceName, setWorkspaceName] = useState("Моя организация");
  const [tab, setTab] = useState<Tab>("agents");
  const [agents, setAgents] = useState<BusinessAgent[]>([]);
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeSource[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [workforces, setWorkforces] = useState<Workforce[]>([]);
  const [usage, setUsage] = useState<Record<string, unknown> | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [runInput, setRunInput] = useState("");
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [runEvents, setRunEvents] = useState<Array<{ id: number; event_type: string; payload?: Record<string, unknown>; created_at?: string }>>([]);
  const [knowledgeName, setKnowledgeName] = useState("");
  const [knowledgeText, setKnowledgeText] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamAgentIds, setTeamAgentIds] = useState<string[]>([]);

  const [agentName, setAgentName] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const [agentInstructions, setAgentInstructions] = useState(defaultAgentPrompt);
  const [agentProvider, setAgentProvider] = useState("openrouter");
  const [agentModel, setAgentModel] = useState("openrouter/free");
  const [selectedTools, setSelectedTools] = useState<string[]>([]);

  const selectedAgent = agents.find(agent => agent.id === selectedAgentId) ?? null;
  const publishedCount = agents.filter(agent => agent.status === "published").length;
  const selectedToolScopes = useMemo(() => [...new Set(tools.filter(tool => selectedTools.includes(tool.id)).flatMap(tool => tool.requiredScopes ?? []))], [tools, selectedTools]);

  const loadOrganizations = useCallback(async () => {
    const data = await request<{ organizations?: Organization[] }>("/api/organizations");
    const items = data.organizations ?? [];
    setOrganizations(items);
    if (!organizationId && items[0]) setOrganizationId(items[0].id);
  }, [organizationId]);

  const loadWorkspace = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const [agentData, toolData, knowledgeData, approvalData, workforceData, usageData, providerData] = await Promise.all([
        request<{ agents?: BusinessAgent[] }>("/api/business-agents/agents", id),
        request<{ tools?: AgentTool[] }>("/api/business-agents/tools", id),
        request<{ sources?: KnowledgeSource[] }>("/api/knowledge", id),
        request<{ approvals?: Approval[] }>("/api/approvals", id),
        request<{ workforces?: Workforce[] }>("/api/workforces", id),
        request<Record<string, unknown>>("/api/organizations/current/usage", id),
        request<{ providers?: Provider[] }>("/api/ai/providers"),
      ]);
      const nextAgents = agentData.agents ?? [];
      setAgents(nextAgents);
      setTools(toolData.tools ?? []);
      setKnowledge(knowledgeData.sources ?? []);
      setApprovals(approvalData.approvals ?? []);
      setWorkforces(workforceData.workforces ?? []);
      setUsage(usageData);
      setProviders(providerData.providers ?? []);
      setSelectedAgentId(current => nextAgents.some(agent => agent.id === current) ? current : nextAgents[0]?.id ?? "");
      if ((providerData.providers ?? []).length && !providerData.providers?.some(provider => provider.id === agentProvider)) {
        const first = providerData.providers![0];
        setAgentProvider(first.id);
        setAgentModel(first.models?.[0] ?? first.id + "/default");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить рабочее пространство.");
    } finally {
      setLoading(false);
    }
  }, [agentProvider]);

  useEffect(() => {
    void loadOrganizations().catch(e => setError(e instanceof Error ? e.message : "Не удалось загрузить организации.")).finally(() => setLoading(false));
  }, [loadOrganizations]);

  useEffect(() => {
    if (organizationId) void loadWorkspace(organizationId);
  }, [organizationId, loadWorkspace]);

  useEffect(() => {
    if (!activeRun || !ACTIVE_RUNS.has(activeRun.status) || !organizationId) return;
    const timer = window.setInterval(() => {
      void request<{ run?: Run; events?: typeof runEvents }>(`/api/business-agents/runs/${activeRun.id}`, organizationId)
        .then(data => { if (data.run) setActiveRun(data.run); })
        .catch(() => undefined);
      void request<{ events?: typeof runEvents }>(`/api/business-agents/runs/${activeRun.id}/events`, organizationId)
        .then(data => setRunEvents(data.events ?? []))
        .catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [activeRun, organizationId]);

  const refresh = () => organizationId ? loadWorkspace(organizationId) : loadOrganizations();

  async function createWorkspace(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const data = await request<{ organization: Organization }>("/api/organizations", undefined, {
        method: "POST", body: JSON.stringify({ name: workspaceName.trim() }),
      });
      setOrganizations(items => [...items, data.organization]);
      setOrganizationId(data.organization.id);
      setNotice("Рабочее пространство создано.");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось создать пространство."); }
    finally { setSaving(false); }
  }

  function resetCreateForm() {
    setAgentName(""); setAgentDescription(""); setAgentInstructions(defaultAgentPrompt);
    setAgentProvider(providers[0]?.id ?? "openrouter");
    setAgentModel(providers[0]?.models?.[0] ?? "openrouter/free");
    setSelectedTools(tools.filter(tool => tool.riskLevel === "low").map(tool => tool.id));
  }

  async function createAgent(event: React.FormEvent) {
    event.preventDefault();
    if (!organizationId) return;
    setSaving(true); setError("");
    try {
      const config = {
        name: agentName.trim(), description: agentDescription.trim(), specialization: agentDescription.trim(),
        instructions: agentInstructions.trim(), provider: agentProvider, model: agentModel.trim(), temperature: 0.2,
        tools: selectedTools, capabilities: [], modes: ["conversational", "autonomous"],
        channels: [], triggers: [], knowledgeSourceIds: [],
        memory: { enabled: false, strategy: "session", retentionDays: 30 },
        permissions: { scopes: selectedToolScopes, requireApprovalFor: ["external_side_effects"], allowExternalSideEffects: false },
        limits: { maxIterations: 12, maxToolCalls: 20, maxDurationSeconds: 300, maxTokensPerRun: 12000 },
        approvalPolicy: { external_side_effects: "required" },
      };
      const data = await request<{ agent: BusinessAgent }>("/api/business-agents/agents", organizationId, { method: "POST", body: JSON.stringify(config) });
      setAgents(items => [data.agent, ...items]);
      setSelectedAgentId(data.agent.id);
      setShowCreate(false);
      setNotice("Агент создан как черновик. Проверьте конфигурацию и опубликуйте его перед запуском.");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось создать агента."); }
    finally { setSaving(false); }
  }

  async function setAgentStatusAction(agent: BusinessAgent, action: "publish" | "pause") {
    setSaving(true); setError("");
    try {
      await request(`/api/business-agents/agents/${agent.id}/${action}`, organizationId, { method: "POST", body: "{}" });
      await loadWorkspace(organizationId);
      setNotice(action === "publish" ? "Агент опубликован и готов принимать запуски." : "Агент приостановлен.");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось изменить статус агента."); }
    finally { setSaving(false); }
  }

  async function startRun(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedAgent || !runInput.trim()) return;
    setSaving(true); setError(""); setActiveRun(null); setRunEvents([]);
    try {
      const key = `web-${selectedAgent.id}-${Date.now()}`;
      const data = await request<{ runId: string; status: string }>(`/api/business-agents/agents/${selectedAgent.id}/runs`, organizationId, {
        method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify({ input: { message: runInput.trim() } }),
      });
      setActiveRun({ id: data.runId, status: data.status });
      setRunInput("");
      const events = await request<{ events?: typeof runEvents }>(`/api/business-agents/runs/${data.runId}/events`, organizationId);
      setRunEvents(events.events ?? []);
      setNotice("Запуск поставлен в очередь. Результат появится после обработки Worker.");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось запустить агента."); }
    finally { setSaving(false); }
  }

  async function addKnowledge(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const data = await request<{ source: KnowledgeSource }>("/api/knowledge/text", organizationId, {
        method: "POST", body: JSON.stringify({ name: knowledgeName.trim(), text: knowledgeText.trim() }),
      });
      setKnowledge(items => [data.source, ...items]);
      setKnowledgeName(""); setKnowledgeText("");
      setNotice("Источник знаний сохранён.");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить знания."); }
    finally { setSaving(false); }
  }

  async function bindKnowledge(sourceId: string) {
    if (!selectedAgent) { setError("Сначала выберите агента."); return; }
    setSaving(true); setError("");
    try {
      await request(`/api/knowledge/${sourceId}/agents/${selectedAgent.id}`, organizationId, { method: "POST", body: "{}" });
      setNotice(`Источник знаний подключён к агенту «${selectedAgent.name}».`);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось подключить источник."); }
    finally { setSaving(false); }
  }

  async function createTeam(event: React.FormEvent) {
    event.preventDefault();
    if (!teamName.trim() || !teamAgentIds.length) return;
    setSaving(true); setError("");
    try {
      const nodes = [
        { id: "start", type: "start", label: "Вход" },
        ...teamAgentIds.map((id, index) => ({ id: `agent-${index + 1}`, type: "agent", label: agents.find(agent => agent.id === id)?.name ?? "Агент", agentId: id })),
        { id: "output", type: "output", label: "Результат" },
      ];
      const edges = nodes.slice(0, -1).map((node, index) => ({ id: `edge-${index + 1}`, source: node.id, target: nodes[index + 1].id }));
      const data = await request<{ workforce: Workforce }>("/api/workforces", organizationId, {
        method: "POST", body: JSON.stringify({ name: teamName.trim(), description: "Команда бизнес-агентов", graph: { nodes, edges } }),
      });
      setWorkforces(items => [data.workforce, ...items]);
      setTeamName(""); setTeamAgentIds([]);
      setNotice("Команда агентов создана.");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось создать команду."); }
    finally { setSaving(false); }
  }

  async function decideApproval(approvalId: string, decision: "approve" | "reject") {
    setSaving(true); setError("");
    try {
      await request(`/api/approvals/${approvalId}/${decision}`, organizationId, { method: "POST", body: JSON.stringify({ reason: decision === "approve" ? "Одобрено владельцем организации" : "Отклонено владельцем организации" }) });
      setApprovals(items => items.filter(item => item.id !== approvalId));
      setNotice(decision === "approve" ? "Согласование одобрено." : "Согласование отклонено.");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось обработать согласование."); }
    finally { setSaving(false); }
  }

  if (loading && !organizationId) {
    return <section className="kv-business-page"><div className="kv-business-loading">Загружаем рабочее пространство…</div></section>;
  }

  if (!organizations.length) {
    return <section className="kv-business-page"><div className="kv-business-onboarding"><span className="kv-business-eyebrow">КВАРД / BUSINESS AI</span><h1>Создайте рабочее пространство</h1><p>Бизнес-агенты, знания, команды и согласования будут изолированы внутри организации.</p><form onSubmit={createWorkspace}><label>Название организации<input value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} maxLength={120} required /></label><button disabled={saving}>Создать пространство</button></form>{error && <p className="kv-business-error">{error}</p>}</div></section>;
  }

  return (
    <section className="kv-business-page">
      <header className="kv-business-header">
        <div><span className="kv-business-eyebrow">КВАРД / BUSINESS AI</span><h1>Бизнес-агенты</h1><p>Создавайте AI-сотрудников, подключайте знания и управляйте их работой.</p></div>
        <div className="kv-business-header-actions">
          {organizations.length > 1 && <select aria-label="Рабочее пространство" value={organizationId} onChange={event => setOrganizationId(event.target.value)}>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select>}
          <button type="button" className="kv-business-secondary" onClick={() => void refresh()}>Обновить</button>
          <button type="button" className="kv-business-primary" onClick={() => { resetCreateForm(); setShowCreate(true); }}>＋ Создать агента</button>
        </div>
      </header>

      {error && <div className="kv-business-alert is-error" role="alert">{error}<button type="button" onClick={() => setError("")}>×</button></div>}
      {notice && <div className="kv-business-alert" role="status">{notice}<button type="button" onClick={() => setNotice("")}>×</button></div>}

      <div className="kv-business-metrics">
        <article><span>Всего агентов</span><strong>{agents.length}</strong><small>В этом пространстве</small></article>
        <article><span>Опубликовано</span><strong>{publishedCount}</strong><small>Готовы к запуску</small></article>
        <article><span>Согласования</span><strong>{approvals.length}</strong><small>Ожидают решения</small></article>
        <article><span>Источники знаний</span><strong>{knowledge.length}</strong><small>Материалы организации</small></article>
      </div>

      <nav className="kv-business-tabs" aria-label="Разделы бизнес-агентов">
        {([["agents","Агенты"],["knowledge","База знаний"],["teams","Команды"],["approvals","Согласования"],["usage","Использование"]] as Array<[Tab,string]>).map(([id,label]) => <button key={id} type="button" className={tab===id?"active":""} onClick={() => setTab(id)}>{label}{id==="approvals"&&approvals.length>0?<span>{approvals.length}</span>:null}</button>)}
      </nav>

      {loading ? <div className="kv-business-loading">Обновляем данные…</div> : null}

      {tab === "agents" && (
        <div className="kv-business-layout">
          <div className="kv-business-list">
            <div className="kv-business-section-head"><div><h2>Ваши агенты</h2><p>Версии, модели и режим работы</p></div><strong>{agents.length}</strong></div>
            {agents.length ? agents.map(agent => (
              <button type="button" key={agent.id} className={selectedAgentId===agent.id?"kv-business-agent is-selected":"kv-business-agent"} onClick={() => { setSelectedAgentId(agent.id); setActiveRun(null); setRunEvents([]); }}>
                <span className="kv-business-agent-mark">К</span><span className="kv-business-agent-copy"><strong>{agent.name}</strong><small>{agent.description || "Без описания"}</small><small>{agent.provider} · {agent.model}</small></span><span className={`kv-business-status status-${agent.status}`}>{statusLabel(agent.status)}</span>
              </button>
            )) : <div className="kv-business-empty"><strong>Пока нет бизнес-агентов</strong><p>Создайте первого агента под конкретную функцию бизнеса.</p><button type="button" onClick={() => { resetCreateForm(); setShowCreate(true); }}>Создать первого агента</button></div>}
          </div>
          <div className="kv-business-detail">
            {selectedAgent ? <>
              <div className="kv-business-detail-head"><div><span className="kv-business-eyebrow">АГЕНТ / v{selectedAgent.version_number ?? 1}</span><h2>{selectedAgent.name}</h2><p>{selectedAgent.description || "Описание не задано"}</p></div><span className={`kv-business-status status-${selectedAgent.status}`}>{statusLabel(selectedAgent.status)}</span></div>
              <div className="kv-business-agent-facts"><span><small>Провайдер</small><b>{selectedAgent.provider}</b></span><span><small>Модель</small><b>{selectedAgent.model}</b></span><span><small>Инструменты</small><b>{Array.isArray((selectedAgent.config as {tools?:unknown[]})?.tools)?(selectedAgent.config as {tools:unknown[]}).tools.length:0}</b></span></div>
              <div className="kv-business-detail-actions">
                {selectedAgent.status !== "published" ? <button type="button" className="kv-business-primary" disabled={saving} onClick={() => void setAgentStatusAction(selectedAgent,"publish")}>Опубликовать</button> : <button type="button" className="kv-business-secondary" disabled={saving} onClick={() => void setAgentStatusAction(selectedAgent,"pause")}>Приостановить</button>}
              </div>
              <form className="kv-business-run-form" onSubmit={startRun}><label>Новое задание<textarea value={runInput} onChange={event => setRunInput(event.target.value)} placeholder="Опишите задачу для агента…" rows={3} /></label><button type="submit" disabled={saving || selectedAgent.status!=="published" || !runInput.trim()}>Запустить агента ↗</button>{selectedAgent.status!=="published"&&<small>Сначала опубликуйте агента.</small>}</form>
              {activeRun && <div className="kv-business-run-card"><div className="kv-business-run-head"><strong>Последний запуск</strong><span className={`kv-business-status status-${activeRun.status}`}>{statusLabel(activeRun.status)}</span></div><small>ID: {activeRun.id}</small>{activeRun.output&&<pre>{JSON.stringify(activeRun.output,null,2)}</pre>}{activeRun.error&&<pre className="kv-business-error">{JSON.stringify(activeRun.error,null,2)}</pre>}{runEvents.length>0&&<div className="kv-business-events">{runEvents.slice(-6).map(event=><div key={event.id}><b>{event.event_type}</b><span>{event.created_at?new Date(event.created_at).toLocaleString("ru-RU"):""}</span></div>)}</div>}</div>}
            </> : <div className="kv-business-empty"><strong>Выберите агента</strong><p>Здесь появятся настройки, публикация и история запусков.</p></div>}
          </div>
        </div>
      )}

      {tab === "knowledge" && <div className="kv-business-section-card"><div className="kv-business-section-head"><div><h2>База знаний</h2><p>Текстовые инструкции и справочные материалы организации</p></div></div><form className="kv-business-knowledge-form" onSubmit={addKnowledge}><label>Название источника<input value={knowledgeName} onChange={event=>setKnowledgeName(event.target.value)} placeholder="Например, регламент продаж" required /></label><label>Содержимое<textarea value={knowledgeText} onChange={event=>setKnowledgeText(event.target.value)} rows={5} placeholder="Вставьте инструкции, правила, FAQ или описание процессов…" required /></label><button className="kv-business-primary" disabled={saving}>Сохранить источник</button></form><div className="kv-business-source-list">{knowledge.map(source=><article key={source.id}><div><strong>{source.name}</strong><small>{source.source_type??"Текстовый источник"} · {source.created_at?new Date(source.created_at).toLocaleDateString("ru-RU"):""}</small></div><button type="button" className="kv-business-secondary" disabled={!selectedAgent||saving} onClick={()=>void bindKnowledge(source.id)}>Подключить к {selectedAgent?.name??"агенту"}</button></article>)}{!knowledge.length&&<p className="kv-business-muted">Пока нет источников знаний.</p>}</div></div>}

      {tab === "teams" && <div className="kv-business-section-card"><div className="kv-business-section-head"><div><h2>Команды агентов</h2><p>Объединяйте опубликованных агентов в последовательные процессы.</p></div></div><form className="kv-business-team-form" onSubmit={createTeam}><label>Название команды<input value={teamName} onChange={event=>setTeamName(event.target.value)} placeholder="Например, Обработка заявок" required /></label><fieldset><legend>Последовательность агентов</legend>{agents.filter(agent=>agent.status==="published").map(agent=><label key={agent.id} className="kv-business-check"><input type="checkbox" checked={teamAgentIds.includes(agent.id)} onChange={event=>setTeamAgentIds(ids=>event.target.checked?[...ids,agent.id]:ids.filter(id=>id!==agent.id))}/>{agent.name}</label>)}</fieldset><button className="kv-business-primary" disabled={saving||!teamAgentIds.length}>Создать команду</button></form><div className="kv-business-source-list">{workforces.map(team=><article key={team.id}><div><strong>{team.name}</strong><small>{team.description||"Команда бизнес-агентов"}</small></div><span className="kv-business-status status-published">Сохранена</span></article>)}{!workforces.length&&<p className="kv-business-muted">Команды ещё не созданы.</p>}</div></div>}

      {tab === "approvals" && <div className="kv-business-section-card"><div className="kv-business-section-head"><div><h2>Ожидают согласования</h2><p>Решения по действиям, которые требуют участия человека.</p></div></div><div className="kv-business-approval-list">{approvals.map(item=><article key={item.id}><div><strong>{item.action_summary||"Запрос на согласование"}</strong><small>Запуск {item.run_id??"—"} · {item.created_at?new Date(item.created_at).toLocaleString("ru-RU"):""}</small></div><div><button type="button" className="kv-business-secondary" disabled={saving} onClick={()=>void decideApproval(item.id,"reject")}>Отклонить</button><button type="button" className="kv-business-primary" disabled={saving} onClick={()=>void decideApproval(item.id,"approve")}>Одобрить</button></div></article>)}{!approvals.length&&<div className="kv-business-empty"><strong>Нет ожидающих решений</strong><p>Запросы на согласование появятся здесь.</p></div>}</div></div>}

      {tab === "usage" && <div className="kv-business-section-card"><div className="kv-business-section-head"><div><h2>Использование и лимиты</h2><p>Квоты текущего тарифного плана организации.</p></div></div><pre className="kv-business-usage">{usage?JSON.stringify(usage,null,2):"Данные использования пока недоступны."}</pre></div>}

      {showCreate && <div className="kv-business-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setShowCreate(false);}}><form className="kv-business-modal" onSubmit={createAgent}><div className="kv-business-modal-head"><div><span className="kv-business-eyebrow">НОВЫЙ БИЗНЕС-АГЕНТ</span><h2>Создать AI-сотрудника</h2></div><button type="button" onClick={()=>setShowCreate(false)} aria-label="Закрыть">×</button></div><label>Название<input value={agentName} onChange={event=>setAgentName(event.target.value)} maxLength={120} placeholder="Например, Менеджер первичных заявок" required /></label><label>Функция и описание<input value={agentDescription} onChange={event=>setAgentDescription(event.target.value)} maxLength={2000} placeholder="Обрабатывает обращения и готовит ответы клиентам" /></label><div className="kv-business-two-cols"><label>AI-провайдер<select value={agentProvider} onChange={event=>{setAgentProvider(event.target.value);const provider=providers.find(item=>item.id===event.target.value);setAgentModel(provider?.models?.[0]??event.target.value+"/default");}}>{providers.map(provider=><option key={provider.id} value={provider.id}>{provider.name??provider.id}</option>)}</select></label><label>Модель<input value={agentModel} onChange={event=>setAgentModel(event.target.value)} required /></label></div><label>Инструкции агента<textarea value={agentInstructions} onChange={event=>setAgentInstructions(event.target.value)} rows={6} required /></label><fieldset><legend>Разрешённые инструменты</legend><div className="kv-business-tool-grid">{tools.map(tool=><label key={tool.id} className="kv-business-check"><input type="checkbox" checked={selectedTools.includes(tool.id)} onChange={event=>setSelectedTools(ids=>event.target.checked?[...ids,tool.id]:ids.filter(id=>id!==tool.id))}/><span><b>{tool.name}</b><small>{tool.description}</small></span></label>)}</div></fieldset><div className="kv-business-modal-foot"><small>Внешние действия запрещены по умолчанию. Согласования остаются обязательным барьером.</small><button type="submit" className="kv-business-primary" disabled={saving||!agentName.trim()||!agentInstructions.trim()}>{saving?"Создание…":"Создать черновик"}</button></div></form></div>}
    </section>
  );
}
