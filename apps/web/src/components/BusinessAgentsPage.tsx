import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import "./BusinessAgentsPage.css";
import "../kvard-ui-kit.css";
import { KvardAlert, KvardButton, KvardDialog, KvardEmptyState, KvardField, KvardPageHeader, KvardStatusBadge, KvardTabs } from "./ui/index.ts";
import { KvardMark } from "./KvardMark.ts";

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
type Provider = { id: string; name?: string; model?: string; isDefault?: boolean };
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

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "published" || status === "completed") return "success";
  if (status === "paused" || status === "queued" || status === "waiting_approval") return "warning";
  if (status === "failed" || status === "timed_out" || status === "limit_reached") return "danger";
  if (status === "running" || status === "initializing" || status === "planning") return "info";
  return "neutral";
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
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});
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
      const [agentData, toolData, knowledgeData, approvalData, workforceData, usageData, providerData, modelsData] = await Promise.all([
        request<{ agents?: BusinessAgent[] }>("/api/business-agents/agents", id),
        request<{ tools?: AgentTool[] }>("/api/business-agents/tools", id),
        request<{ sources?: KnowledgeSource[] }>("/api/knowledge", id),
        request<{ approvals?: Approval[] }>("/api/approvals", id),
        request<{ workforces?: Workforce[] }>("/api/workforces", id),
        request<Record<string, unknown>>("/api/organizations/current/usage", id),
        request<{ providers?: Provider[] }>("/api/ai/providers"),
        request<{ models?: Record<string, string[]> }>("/api/ai/models"),
      ]);
      const nextAgents = agentData.agents ?? [];
      setAgents(nextAgents);
      setTools(toolData.tools ?? []);
      setKnowledge(knowledgeData.sources ?? []);
      setApprovals(approvalData.approvals ?? []);
      setWorkforces(workforceData.workforces ?? []);
      setUsage(usageData);
      setProviders(providerData.providers ?? []);
      setProviderModels(modelsData.models ?? {});
      setSelectedAgentId(current => nextAgents.some(agent => agent.id === current) ? current : nextAgents[0]?.id ?? "");
      if ((providerData.providers ?? []).length && !providerData.providers?.some(provider => provider.id === agentProvider)) {
        const first = providerData.providers![0];
        setAgentProvider(first.id);
        setAgentModel(modelsData.models?.[first.id]?.[0] ?? first.model ?? "");
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

  async function createWorkspace(event: FormEvent) {
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
    setAgentModel(providerModels[providers[0]?.id ?? ""]?.[0] ?? providers[0]?.model ?? "");
    setSelectedTools(tools.filter(tool => tool.riskLevel === "low").map(tool => tool.id));
  }

  async function createAgent(event: FormEvent) {
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
      setSelectedAgentId(data.agent.id);
      setShowCreate(false);
      await loadWorkspace(organizationId);
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

  async function startRun(event: FormEvent) {
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

  async function addKnowledge(event: FormEvent) {
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

  async function createTeam(event: FormEvent) {
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
    return <section className="kv-business-page"><div className="kv-business-onboarding"><span className="kv-business-eyebrow">КВАРД / BUSINESS AI</span><h1>Создайте рабочее пространство</h1><p>Бизнес-агенты, знания, команды и согласования будут изолированы внутри организации.</p><form onSubmit={createWorkspace}><KvardField id="kv-business-workspace-name" label="Название организации" required><input value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} maxLength={120} /></KvardField><KvardButton variant="primary" type="submit" loading={saving}>Создать пространство</KvardButton></form>{error && <p className="kv-business-error">{error}</p>}</div></section>;
  }

  return (
    <section className="kv-business-page">
      <KvardPageHeader
        className="kv-business-header"
        eyebrow="КВАРД / BUSINESS AI"
        eyebrowClassName="kv-business-eyebrow"
        title="Бизнес-агенты"
        titleId="kv-business-page-title"
        description="Создавайте AI-сотрудников, подключайте знания и управляйте их работой."
        descriptionId="kv-business-page-description"
        actionsClassName="kv-business-header-actions"
        actions={<>
          {organizations.length > 1 && <select aria-label="Рабочее пространство" value={organizationId} onChange={event => setOrganizationId(event.target.value)}>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select>}
          <KvardButton variant="secondary" size="md" type="button" onClick={() => void refresh()}>Обновить</KvardButton>
          <KvardButton variant="primary" size="md" type="button" onClick={() => { resetCreateForm(); setShowCreate(true); }}>＋ Создать агента</KvardButton>
        </>}
      />

      {error && <KvardAlert tone="danger" className="kv-business-alert is-error" onDismiss={() => setError("")}>{error}</KvardAlert>}
      {notice && <KvardAlert tone="success" className="kv-business-alert" onDismiss={() => setNotice("")}>{notice}</KvardAlert>}

      <div className="kv-business-metrics">
        <article><span>Всего агентов</span><strong>{agents.length}</strong><small>В этом пространстве</small></article>
        <article><span>Опубликовано</span><strong>{publishedCount}</strong><small>Готовы к запуску</small></article>
        <article><span>Согласования</span><strong>{approvals.length}</strong><small>Ожидают решения</small></article>
        <article><span>Источники знаний</span><strong>{knowledge.length}</strong><small>Материалы организации</small></article>
      </div>

      <KvardTabs
        id="kv-business"
        ariaLabel="Разделы бизнес-агентов"
        value={tab}
        onChange={value => setTab(value as Tab)}
        items={[
          { id: "agents", label: "Агенты" },
          { id: "knowledge", label: "База знаний" },
          { id: "teams", label: "Команды" },
          { id: "approvals", label: "Согласования", badge: approvals.length > 0 ? approvals.length : undefined },
          { id: "usage", label: "Использование" },
        ]}
      />

      {loading ? <div className="kv-business-loading">Обновляем данные…</div> : null}

      <section id="kv-business-panel-agents" className="kv-tabs__panel" role="tabpanel" aria-labelledby="kv-business-tab-agents" tabIndex={0} hidden={tab !== "agents"}>
        {tab === "agents" && (
        <div className="kv-business-layout">
          <div className="kv-business-list">
            <div className="kv-business-section-head"><div><h2>Ваши агенты</h2><p>Версии, модели и режим работы</p></div><strong>{agents.length}</strong></div>
            {agents.length ? agents.map(agent => (
              <button type="button" key={agent.id} className={selectedAgentId===agent.id?"kv-business-agent is-selected":"kv-business-agent"} onClick={() => { setSelectedAgentId(agent.id); setActiveRun(null); setRunEvents([]); }}>
                <KvardMark size={36} /><span className="kv-business-agent-copy"><strong>{agent.name}</strong><small>{agent.description || "Без описания"}</small><small>{agent.provider} · {agent.model}</small></span><KvardStatusBadge tone={statusTone(agent.status)} label={statusLabel(agent.status)} />
              </button>
            )) : <KvardEmptyState className="kv-business-empty" title="Пока нет бизнес-агентов" description="Создайте первого агента под конкретную функцию бизнеса." action={<KvardButton variant="primary" size="md" type="button" onClick={() => { resetCreateForm(); setShowCreate(true); }}>Создать первого агента</KvardButton>} />}
          </div>
          <div className="kv-business-detail">
            {selectedAgent ? <>
              <div className="kv-business-detail-head"><div><span className="kv-business-eyebrow">АГЕНТ / v{selectedAgent.version_number ?? 1}</span><h2>{selectedAgent.name}</h2><p>{selectedAgent.description || "Описание не задано"}</p></div><KvardStatusBadge tone={statusTone(selectedAgent.status)} label={statusLabel(selectedAgent.status)} /></div>
              <div className="kv-business-agent-facts"><span><small>Провайдер</small><b>{selectedAgent.provider}</b></span><span><small>Модель</small><b>{selectedAgent.model}</b></span><span><small>Инструменты</small><b>{Array.isArray((selectedAgent.config as {tools?:unknown[]})?.tools)?(selectedAgent.config as {tools:unknown[]}).tools.length:0}</b></span></div>
              <div className="kv-business-detail-actions">
                {selectedAgent.status !== "published" ? <KvardButton variant="primary" type="button" disabled={saving} loading={saving} onClick={() => void setAgentStatusAction(selectedAgent,"publish")}>Опубликовать</KvardButton> : <KvardButton variant="secondary" type="button" disabled={saving} loading={saving} onClick={() => void setAgentStatusAction(selectedAgent,"pause")}>Приостановить</KvardButton>}
              </div>
              <form className="kv-business-run-form" onSubmit={startRun}><label>Новое задание<textarea value={runInput} onChange={event => setRunInput(event.target.value)} placeholder="Опишите задачу для агента…" rows={3} /></label><KvardButton variant="primary" type="submit" loading={saving} disabled={selectedAgent.status!=="published" || !runInput.trim()}>Запустить агента ↗</KvardButton>{selectedAgent.status!=="published"&&<small>Сначала опубликуйте агента.</small>}</form>
              {activeRun && <div className="kv-business-run-card"><div className="kv-business-run-head"><strong>Последний запуск</strong><KvardStatusBadge tone={statusTone(activeRun.status)} label={statusLabel(activeRun.status)} /></div><small>ID: {activeRun.id}</small>{activeRun.output !== undefined && activeRun.output !== null && <pre>{JSON.stringify(activeRun.output,null,2)}</pre>}{activeRun.error !== undefined && activeRun.error !== null && <pre className="kv-business-error">{JSON.stringify(activeRun.error,null,2)}</pre>}{runEvents.length>0&&<div className="kv-business-events">{runEvents.slice(-6).map(event=><div key={event.id}><b>{event.event_type}</b><span>{event.created_at?new Date(event.created_at).toLocaleString("ru-RU"):""}</span></div>)}</div>}</div>}
            </> : <div className="kv-business-empty"><strong>Выберите агента</strong><p>Здесь появятся настройки, публикация и история запусков.</p></div>}
          </div>
        </div>
        )}
      </section>

      <section id="kv-business-panel-knowledge" className="kv-tabs__panel" role="tabpanel" aria-labelledby="kv-business-tab-knowledge" tabIndex={0} hidden={tab !== "knowledge"}>
      {tab === "knowledge" && <div className="kv-business-section-card"><div className="kv-business-section-head"><div><h2>База знаний</h2><p>Текстовые инструкции и справочные материалы организации</p></div></div><form className="kv-business-knowledge-form" onSubmit={addKnowledge}><label>Название источника<input value={knowledgeName} onChange={event=>setKnowledgeName(event.target.value)} placeholder="Например, регламент продаж" required /></label><label>Содержимое<textarea value={knowledgeText} onChange={event=>setKnowledgeText(event.target.value)} rows={5} placeholder="Вставьте инструкции, правила, FAQ или описание процессов…" required /></label><KvardButton variant="primary" type="submit" loading={saving}>Сохранить источник</KvardButton></form><div className="kv-business-source-list">{knowledge.map(source=><article key={source.id}><div><strong>{source.name}</strong><small>{source.source_type??"Текстовый источник"} · {source.created_at?new Date(source.created_at).toLocaleDateString("ru-RU"):""}</small></div><KvardButton variant="secondary" type="button" disabled={!selectedAgent||saving} onClick={()=>void bindKnowledge(source.id)}>Подключить к {selectedAgent?.name??"агенту"}</KvardButton></article>)}{!knowledge.length&&<p className="kv-business-muted">Пока нет источников знаний.</p>}</div></div>}</section>

      <section id="kv-business-panel-teams" className="kv-tabs__panel" role="tabpanel" aria-labelledby="kv-business-tab-teams" tabIndex={0} hidden={tab !== "teams"}>
      {tab === "teams" && <div className="kv-business-section-card"><div className="kv-business-section-head"><div><h2>Команды агентов</h2><p>Объединяйте опубликованных агентов в последовательные процессы.</p></div></div><form className="kv-business-team-form" onSubmit={createTeam}><label>Название команды<input value={teamName} onChange={event=>setTeamName(event.target.value)} placeholder="Например, Обработка заявок" required /></label><fieldset><legend>Последовательность агентов</legend>{agents.filter(agent=>agent.status==="published").map(agent=><label key={agent.id} className="kv-business-check"><input type="checkbox" checked={teamAgentIds.includes(agent.id)} onChange={event=>setTeamAgentIds(ids=>event.target.checked?[...ids,agent.id]:ids.filter(id=>id!==agent.id))}/>{agent.name}</label>)}</fieldset><KvardButton variant="primary" type="submit" loading={saving} disabled={!teamAgentIds.length}>Создать команду</KvardButton></form><div className="kv-business-source-list">{workforces.map(team=><article key={team.id}><div><strong>{team.name}</strong><small>{team.description||"Команда бизнес-агентов"}</small></div><KvardStatusBadge tone="success" label="Сохранена" /></article>)}{!workforces.length&&<p className="kv-business-muted">Команды ещё не созданы.</p>}</div></div>}</section>

      <section id="kv-business-panel-approvals" className="kv-tabs__panel" role="tabpanel" aria-labelledby="kv-business-tab-approvals" tabIndex={0} hidden={tab !== "approvals"}>
      {tab === "approvals" && <div className="kv-business-section-card"><div className="kv-business-section-head"><div><h2>Ожидают согласования</h2><p>Решения по действиям, которые требуют участия человека.</p></div></div><div className="kv-business-approval-list">{approvals.map(item=><article key={item.id}><div><strong>{item.action_summary||"Запрос на согласование"}</strong><small>Запуск {item.run_id??"—"} · {item.created_at?new Date(item.created_at).toLocaleString("ru-RU"):""}</small></div><div><KvardButton variant="secondary" type="button" disabled={saving} onClick={()=>void decideApproval(item.id,"reject")}>Отклонить</KvardButton><KvardButton variant="primary" type="button" disabled={saving} onClick={()=>void decideApproval(item.id,"approve")}>Одобрить</KvardButton></div></article>)}{!approvals.length&&<KvardEmptyState className="kv-business-empty" title="Нет ожидающих решений" description="Запросы на согласование появятся здесь." />}</div></div>}</section>

      <section id="kv-business-panel-usage" className="kv-tabs__panel" role="tabpanel" aria-labelledby="kv-business-tab-usage" tabIndex={0} hidden={tab !== "usage"}>
      {tab === "usage" && <div className="kv-business-section-card"><div className="kv-business-section-head"><div><h2>Использование и лимиты</h2><p>Квоты текущего тарифного плана организации.</p></div></div><pre className="kv-business-usage">{usage?JSON.stringify(usage,null,2):"Данные использования пока недоступны."}</pre></div>}</section>

      <KvardDialog open={showCreate} onClose={()=>setShowCreate(false)} ariaLabelledBy="kv-business-create-agent-title" backdropClassName="kv-business-modal-backdrop kv-dialog-backdrop" dialogClassName="kv-business-modal kv-dialog"><form onSubmit={createAgent}><div className="kv-business-modal-head"><div><span className="kv-business-eyebrow">НОВЫЙ БИЗНЕС-АГЕНТ</span><h2 id="kv-business-create-agent-title">Создать AI-сотрудника</h2></div><button type="button" onClick={()=>setShowCreate(false)} aria-label="Закрыть">×</button></div><KvardField id="kv-business-agent-name" label="Название" required><input autoFocus value={agentName} onChange={event=>setAgentName(event.target.value)} maxLength={120} placeholder="Например, Менеджер первичных заявок" /></KvardField><KvardField id="kv-business-agent-description" label="Функция и описание"><input value={agentDescription} onChange={event=>setAgentDescription(event.target.value)} maxLength={2000} placeholder="Обрабатывает обращения и готовит ответы клиентам" /></KvardField><div className="kv-business-two-cols"><label>AI-провайдер<select value={agentProvider} onChange={event=>{setAgentProvider(event.target.value);const provider=providers.find(item=>item.id===event.target.value);setAgentModel(providerModels[event.target.value]?.[0] ?? provider?.model ?? "");}}>{providers.map(provider=><option key={provider.id} value={provider.id}>{provider.name??provider.id}</option>)}</select></label><label>Модель<input value={agentModel} onChange={event=>setAgentModel(event.target.value)} required /></label></div><KvardField id="kv-business-agent-instructions" label="Инструкции агента" required><textarea value={agentInstructions} onChange={event=>setAgentInstructions(event.target.value)} rows={6} /></KvardField><fieldset><legend>Разрешённые инструменты</legend><div className="kv-business-tool-grid">{tools.map(tool=><label key={tool.id} className="kv-business-check"><input type="checkbox" checked={selectedTools.includes(tool.id)} onChange={event=>setSelectedTools(ids=>event.target.checked?[...ids,tool.id]:ids.filter(id=>id!==tool.id))}/><span><b>{tool.name}</b><small>{tool.description}</small></span></label>)}</div></fieldset><div className="kv-business-modal-foot"><small>Внешние действия запрещены по умолчанию. Согласования остаются обязательным барьером.</small><KvardButton variant="primary" type="submit" loading={saving} disabled={!agentName.trim()||!agentInstructions.trim()}>{saving?"Создание…":"Создать черновик"}</KvardButton></div></form></KvardDialog>
    </section>
  );
}
