import "./App.css";
import { useEffect, useState } from "react";
import { ChatPanel } from "./components/ChatPanel";
import { CommandPalette } from "./components/CommandPalette";
import { NewProjectModal } from "./components/NewProjectModal";
import { QuickActions } from "./components/QuickActions";
import { RightPanel } from "./components/RightPanel";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import type { AIProviderInfo, AIProviderStatus, AgentStage, Project } from "./components/types";

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("nexum");
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [lastMessage, setLastMessage] = useState("");
  const [agentStage, setAgentStage] = useState<AgentStage>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectActionLoading, setProjectActionLoading] = useState(false);
  const [apiError, setApiError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [aiProviders, setAIProviders] = useState<AIProviderInfo[]>([]);
  const [aiModels, setAIModels] = useState<Record<string, string[]>>({});
  const [aiProvider, setAIProvider] = useState("mock");
  const [aiModel, setAIModel] = useState("mock-v1");
  const [aiStatus, setAIStatus] = useState<AIProviderStatus | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [rightTab, setRightTab] = useState<"preview" | "files" | "agent">("preview");
  const [notice, setNotice] = useState("");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [previewOnline, setPreviewOnline] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [builderStarted, setBuilderStarted] = useState(false);
  const [chatJobId, setChatJobId] = useState<string | null>(null);
  const [view, setView] = useState<"home" | "project" | "connectors" | "settings">("project");
  const [connectorModal, setConnectorModal] = useState<string | null>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [connectedConnectors, setConnectedConnectors] = useState<string[]>([]);
  const [activitySteps, setActivitySteps] = useState<Array<{ iteration: number; tool: string; success: boolean }>>([]);
  const [activityEvents, setActivityEvents] = useState<Array<{ id: number; timestamp: number; iteration: number; type: string; tool?: string; message: string }>>([]);
  const [currentActivity, setCurrentActivity] = useState("");
  const [productPlan, setProductPlan] = useState<{
    goal: string;
    productType: string;
    pages: string[];
    components: string[];
    acceptanceCriteria: string[];
  } | null>(null);
  const [problems, setProblems] = useState<Array<{ message: string; source?: string }>>([]);
  const [localAIKey, setLocalAIKey] = useState("");
  const localAITestEnabled = true;
  const [localAIConfigured, setLocalAIConfigured] = useState(false);
  const [localAIKeyLoading, setLocalAIKeyLoading] = useState(false);
  const [conversation, setConversation] = useState<Array<{ id: string; role: "user" | "assistant"; content: string; timestamp: number; attachments?: string[] }>>([]);
  const [pendingAttachments, setPendingAttachments] = useState<Array<{ id: string; name: string; type: string; size: number; file: File }>>([]);

  const activeProject = projects.find((project) => project.id === activeProjectId);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`nexum:conversation:${activeProjectId}`) || "[]");
      setConversation(Array.isArray(saved) ? saved.slice(-100) : []);
    } catch { setConversation([]); }
  }, [activeProjectId]);

  useEffect(() => {
    try { localStorage.setItem(`nexum:conversation:${activeProjectId}`, JSON.stringify(conversation.slice(-100))); } catch {}
  }, [activeProjectId, conversation]);

  async function serializeAttachments(files: File[]) {
    const results: Array<{ name: string; type: string; size: number; content?: string; data?: string }> = [];
    for (const file of files.slice(0, 5)) {
      if (file.size > 2_000_000) continue;
      const isText = file.type.startsWith("text/") || /\.(md|txt|json|js|jsx|ts|tsx|css|html|xml|csv|yml|yaml|env)$/i.test(file.name);
      if (isText) {
        results.push({ name: file.name, type: file.type || "text/plain", size: file.size, content: (await file.text()).slice(0, 80_000) });
      } else {
        const buffer = await file.arrayBuffer();
        let binary = "";
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        results.push({ name: file.name, type: file.type || "application/octet-stream", size: file.size, data: btoa(binary) });
      }
    }
    return results;
  }

  useEffect(() => {
    const report = (payload: Record<string, unknown>) => {
      void fetch("/api/agent/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, url: window.location.href }),
        keepalive: true,
      }).catch(() => {});
    };
    const onError = (event: ErrorEvent) => report({ message: event.message || "Browser runtime error", stack: event.error?.stack, source: event.filename });
    const onRejection = (event: PromiseRejectionEvent) => report({ message: event.reason instanceof Error ? event.reason.message : String(event.reason), stack: event.reason instanceof Error ? event.reason.stack : undefined, source: "unhandledrejection" });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("nexum:connectors") || "[]");
      if (Array.isArray(saved)) setConnectedConnectors(saved.filter((item): item is string => typeof item === "string"));
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem("nexum:connectors", JSON.stringify(connectedConnectors)); } catch {} }, [connectedConnectors]);

  useEffect(() => {
    if (!activeProjectId) return;
    fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/preview/status`).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { online?: boolean };
      setPreviewOnline(Boolean(data.online));
    }).catch(() => setPreviewOnline(false));
  }, [activeProjectId, previewKey]);
  const selectedModels = aiModels[aiProvider] ?? [];

  async function loadProjects(preferredId = activeProjectId) {
    setProjectsLoading(true);
    try {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error(`Projects API: HTTP ${response.status}`);
      const data = (await response.json()) as { projects?: Project[] };
      const nextProjects = data.projects ?? [];
      const preferred = nextProjects.find((project) => project.id === preferredId && project.status === "active");
      const fallback = nextProjects.find((project) => project.id === "nexum" && project.status === "active")
        ?? nextProjects.find((project) => project.status === "active");
      setProjects(nextProjects);
      setActiveProjectId(preferred?.id ?? fallback?.id ?? "nexum");
      setApiError("");
    } catch (error) {
      console.error("[Nexum] API projects request failed:", error);
      setApiError(error instanceof Error ? error.message : "Cannot reach API");
    } finally {
      setProjectsLoading(false);
    }
  }

  useEffect(() => { void loadProjects("nexum"); }, []);

  useEffect(() => {
    async function loadAIConfig() {
      try {
        const [providersResponse, modelsResponse] = await Promise.all([
          fetch("/api/ai/providers"),
          fetch("/api/ai/models"),
        ]);
        if (!providersResponse.ok || !modelsResponse.ok) throw new Error(`AI config API: HTTP ${!providersResponse.ok ? providersResponse.status : modelsResponse.status}`);
        const providersData = (await providersResponse.json()) as { providers?: AIProviderInfo[] };
        const modelsData = (await modelsResponse.json()) as { models?: Record<string, string[]> };
        const providers = providersData.providers ?? [];
        const defaultProvider = providers.find((provider) => provider.isDefault) ?? providers[0];
        setAIProviders(providers);
        setAIModels(modelsData.models ?? {});
        if (defaultProvider) { setAIProvider(defaultProvider.id); setAIModel(defaultProvider.model); }
      } catch (error) {
        console.error("[Nexum] AI config request failed:", error);
        setApiError(error instanceof Error ? error.message : "AI config unavailable");
      }
    }
    void loadAIConfig();
  }, []);

  useEffect(() => {
    if (!aiProvider) return;
    let cancelled = false;
    async function refreshAIStatus() {
      try {
        const response = await fetch(`/api/ai/status?provider=${encodeURIComponent(aiProvider)}&model=${encodeURIComponent(aiModel)}`);
        const data = response.ok ? (await response.json()) as { status?: AIProviderStatus } : null;
        if (!cancelled) setAIStatus(data?.status ?? { provider: aiProvider, available: false, model: aiModel, latencyMs: null, error: "AI status unavailable" });
      } catch {
        if (!cancelled) setAIStatus({ provider: aiProvider, available: false, model: aiModel, latencyMs: null, error: "Cannot reach AI status endpoint" });
      }
    }
    void refreshAIStatus();
    const timer = window.setInterval(refreshAIStatus, 10000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [aiProvider, aiModel]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    function handleEscape(event: KeyboardEvent) { if (event.key === "Escape") setModalOpen(false); }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [modalOpen]);

  function openProject(projectId: string) { setView("project"); void selectProject(projectId); }

  async function selectProject(projectId: string) {
    setProjectActionLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/select`, { method: "POST" });
      if (!response.ok) throw new Error(`Project selection API: HTTP ${response.status}`);
      setActiveProjectId(projectId);
      setReply("");
      await loadProjects(projectId);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Project selection failed");
    } finally {
      setProjectActionLoading(false);
    }
  }

  async function deleteProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    const confirmed = window.confirm(`Удалить проект «${project.name}» навсегда? Все файлы проекта будут удалены. Это действие нельзя отменить.`);
    if (!confirmed) return;

    setProjectActionLoading(true);
    setApiError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({})) as { project?: Project; error?: string };
      if (!response.ok) throw new Error(data.error || "Project deletion failed");
      const fallbackId = projects.find((item) => item.status === "active" && item.id !== projectId)?.id ?? "nexum";
      await loadProjects(activeProjectId === projectId ? fallbackId : activeProjectId);
      if (activeProjectId === projectId) {
        setActiveProjectId(fallbackId);
        setView("project");
        setReply("");
        setConversation([]);
        setProductPlan(null);
        setActivitySteps([]);
        setActivityEvents([]);
        setProblems([]);
      }
      setNotice(`Project «${project.name}» deleted`);
      window.setTimeout(() => setNotice(""), 3200);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Project deletion failed");
    } finally {
      setProjectActionLoading(false);
    }
  }

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newProjectName.trim()) return;
    setProjectActionLoading(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProjectName.trim() }),
      });
      if (!response.ok) throw new Error(`Project creation API: HTTP ${response.status}`);
      const data = (await response.json()) as { project: Project };
      await selectProject(data.project.id);
      setView("project");
      setNewProjectName("");
      setModalOpen(false);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Project creation failed");
    } finally {
      setProjectActionLoading(false);
    }
  }

  async function sendMessage(task = message) {
    if (!task.trim() || !activeProjectId) return;
    setLastMessage(task);
    setBuilderStarted(true);
    setRightTab("agent");
    setAgentStage("thinking");
    setReply("");
    setApiError("");
    setActivitySteps([]);
    setActivityEvents([]);
    setCurrentActivity("Отправляю задачу AI-агенту…");
    setProblems([]);
    setProductPlan(null);

    try {
      const serializedAttachments = await serializeAttachments(pendingAttachments.map((item) => item.file));
      setConversation((items) => [...items, { id: `user-${Date.now()}`, role: "user", content: task.trim(), timestamp: Date.now(), attachments: serializedAttachments.map((item) => item.name) }]);
      setPendingAttachments([]);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: task, projectId: activeProjectId, provider: aiProvider, model: aiModel, attachments: serializedAttachments }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || `Chat API: HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        success?: boolean;
        jobId?: string;
        status?: string;
        error?: string;
      };
      if (!data.jobId) throw new Error(data.error || "Chat API did not return a job ID");

      setChatJobId(data.jobId);
    } catch (error) {
      console.error("[Nexum] Chat job creation failed:", error);
      setApiError(error instanceof Error ? error.message : "Chat API request failed");
      setAgentStage(null);
    }
  }

  useEffect(() => {
    if (!chatJobId) return;

    let cancelled = false;
    let timer: number | undefined;
    const activeJobId = chatJobId;

    async function pollJob() {
      try {
        const response = await fetch(`/api/chat/jobs/${encodeURIComponent(activeJobId)}`);
        const data = response.ok
          ? await response.json() as {
              success?: boolean;
              job?: {
                status?: "queued" | "running" | "completed" | "failed";
                stage?: string;
                reply?: string | null;
                steps?: Array<{ iteration: number; tool: string; success: boolean }>;
                events?: Array<{ id: number; timestamp: number; iteration: number; type: string; tool?: string; message: string }>;
                currentMessage?: string | null;
                problems?: Array<{ message: string; source?: string }>;
                error?: string | null;
                productPlan?: {
                  goal?: string;
                  productType?: string;
                  pages?: string[];
                  components?: string[];
                  acceptanceCriteria?: string[];
                } | null;
              };
              error?: string;
            }
          : null;

        if (cancelled) return;

        if (!response.ok) {
          throw new Error(data?.error || `Chat job API: HTTP ${response.status}`);
        }

        const status = data?.job?.status;
        if (status === "completed") {
          setActivitySteps(data?.job?.steps ?? []);
          setActivityEvents(data?.job?.events ?? []);
          setCurrentActivity(data?.job?.currentMessage ?? "Готово.");
          setProblems(data?.job?.problems ?? []);
          if (data?.job?.productPlan) setProductPlan({
            goal: data.job.productPlan.goal ?? "",
            productType: data.job.productPlan.productType ?? "Product",
            pages: data.job.productPlan.pages ?? [],
            components: data.job.productPlan.components ?? [],
            acceptanceCriteria: data.job.productPlan.acceptanceCriteria ?? [],
          });
          setReply(data?.job?.reply ?? "");
          if (data?.job?.reply) setConversation((items) => [...items, { id: `assistant-${Date.now()}`, role: "assistant", content: data.job!.reply!, timestamp: Date.now() }]);
          setRightTab("preview");

          // The agent can finish immediately after the build while the filesystem
          // and preview status endpoint are still settling. Wait briefly for the
          // production bundle, then force a cache-busted iframe reload.
          let previewReady = false;
          for (let attempt = 0; attempt < 12; attempt += 1) {
            try {
              const previewResponse = await fetch(
                `/api/projects/${encodeURIComponent(activeProjectId)}/preview/status?ts=${Date.now()}`,
                { cache: "no-store" },
              );
              if (previewResponse.ok) {
                const previewData = await previewResponse.json() as { online?: boolean };
                if (previewData.online) {
                  previewReady = true;
                  break;
                }
              }
            } catch {
              // The next attempt can succeed while the build output settles.
            }
            await new Promise((resolve) => window.setTimeout(resolve, 500));
          }

          setPreviewOnline(previewReady);
          setPreviewKey((key) => key + 1);
          setAgentStage("completed");
          setChatJobId(null);
          return;
        }

        if (status === "failed") {
          throw new Error(data?.job?.error || "AI agent failed");
        }

        setActivitySteps(data?.job?.steps ?? []);
        setActivityEvents(data?.job?.events ?? []);
        setCurrentActivity(data?.job?.currentMessage ?? "AI выполняет задачу…");
        setProblems(data?.job?.problems ?? []);
        if (data?.job?.productPlan) setProductPlan({
          goal: data.job.productPlan.goal ?? "",
          productType: data.job.productPlan.productType ?? "Product",
          pages: data.job.productPlan.pages ?? [],
          components: data.job.productPlan.components ?? [],
          acceptanceCriteria: data.job.productPlan.acceptanceCriteria ?? [],
        });
        setAgentStage((data?.job?.stage as typeof agentStage) ?? (status === "running" ? "running" : "thinking"));
        timer = window.setTimeout(pollJob, 900);
      } catch (error) {
        if (cancelled) return;
        console.error("[Nexum] Chat job polling failed:", error);
        setApiError(error instanceof Error ? error.message : "Chat job polling failed");
        setAgentStage("error");
        setChatJobId(null);
      }
    }

    void pollJob();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [chatJobId]);

  async function saveLocalAIKey() {
    if (!localAIKey.trim()) return;
    setLocalAIKeyLoading(true);
    setApiError("");
    try {
      const response = await fetch("/api/ai/local-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: localAIKey.trim() }),
      });
      const data = await response.json().catch(() => ({})) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "OpenRouter key verification failed");
      setLocalAIConfigured(true);
      setLocalAIKey("");
      setAIProvider("openrouter");
      setAIModel("openrouter/free");
      setNotice("OpenRouter connected for this local test session");
      window.setTimeout(() => setNotice(""), 3200);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "OpenRouter key setup failed");
    } finally {
      setLocalAIKeyLoading(false);
    }
  }

  function selectAIProvider(providerId: string) {
    const provider = aiProviders.find((item) => item.id === providerId);
    setAIProvider(providerId);
    setAIModel(aiModels[providerId]?.[0] ?? provider?.model ?? "");
  }

  function focusTask(task = "") {
    setMessage(task);
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(".message-box textarea")?.focus(), 0);
  }

    function openProjectPicker() {
    setMobileSidebarOpen(true);
    setNotice("Choose a project in the sidebar");
    window.setTimeout(() => setNotice(""), 3200);
  }

  const runTask = (task: string) => void sendMessage(task);
  const paletteActions = [
    { label: "New Project", hint: "N", run: () => setModalOpen(true) },
    { label: "Open Project", hint: "O", run: openProjectPicker },
    { label: "Search Files", hint: "S", run: () => focusTask("Найди ") },
    { label: "Open Agent Activity", hint: "A", run: () => setRightTab("agent") },
    { label: "Run Tests", hint: "T", run: () => runTask("Запусти тесты в изолированной среде") },
    { label: "Run Build", hint: "B", run: () => runTask("Проверь сборку проекта") },
    { label: "Git Status", hint: "G", run: () => runTask("Покажи статус Git") },
    { label: "Git Diff", hint: "D", run: () => runTask("Что изменилось?") },
    { label: "Start Preview", hint: "P", run: () => { setRightTab("preview"); setPreviewKey((key) => key + 1); setNotice("Preview refreshed"); } },
    { label: "Restart Preview", hint: "R", run: () => { setRightTab("preview"); setPreviewKey((key) => key + 1); setNotice("Preview restarted"); } },
    { label: "Ask AI", hint: "A", run: () => focusTask() },
    { label: "Switch Model", hint: "M", run: () => document.querySelector<HTMLSelectElement>("select[aria-label='AI model']")?.focus() },
    { label: "Settings", hint: "", run: () => setView("settings") },
  ];

  return (
    <div className="app">
      <Sidebar projects={projects} activeProjectId={activeProjectId} projectsLoading={projectsLoading} projectActionLoading={projectActionLoading} mobileOpen={mobileSidebarOpen} view={view} onDeleteProject={(id) => void deleteProject(id)} onViewChange={(next) => { setMobileSidebarOpen(false); setView(next); }} onNewProject={() => { setMobileSidebarOpen(false); setModalOpen(true); }} onSelectProject={(id) => { setMobileSidebarOpen(false); openProject(id); }} />
      <main className="main">
        <TopBar projectName={view === "connectors" ? "Connectors" : view === "settings" ? "Settings" : view === "home" ? "NEXUM.DEV" : activeProject?.name ?? "NEXUM"} providers={aiProviders} models={selectedModels} provider={aiProvider} model={aiModel} aiStatus={aiStatus} stage={agentStage} onProviderChange={selectAIProvider} onModelChange={setAIModel} onToggleSidebar={() => setMobileSidebarOpen((open) => !open)} />
        {view === "home" ? (
          <section className="nexum-home">
            <div className="home-hero"><div><div className="eyebrow">NEXUM.DEV</div><h1>Build without leaving the workspace.</h1><p>Create a project, open it as its own workspace, connect services, and let the Agent build inside it.</p></div><button className="home-primary" type="button" onClick={() => setModalOpen(true)}>+ New Project</button></div>
            <div className="home-section-title"><span>YOUR PROJECTS</span><button type="button" onClick={() => setModalOpen(true)}>New project</button></div>
            <div className="project-grid">{projects.filter((project) => project.status === "active").map((project) => <button key={project.id} className="project-window" type="button" onClick={() => openProject(project.id)}><span className="window-chrome"><i/><i/><i/></span><span className="project-window-mark">{project.name.slice(0, 1)}</span><strong>{project.name}</strong><span className="project-window-meta">Open workspace →</span></button>)}{projects.length === 0 && <div className="empty-card">Create your first project.</div>}</div>
          </section>
        ) : view === "connectors" ? (
          <section className="connectors-page">
            <div className="page-heading"><div><div className="eyebrow">INTEGRATIONS</div><h1>Connectors</h1><p>Give Nexum access to the services your projects use.</p></div><button className="home-primary" type="button" onClick={() => setConnectorModal("Custom connector")}>+ Add connector</button></div>
            <div className="connector-grid">{[["GitHub","Repository, branches, commits and issues","Development"],["Supabase","Database, auth and storage","Backend"],["OpenAI","AI models and API access","AI"],["Telegram","Bots, messages and automation","Communication"],["Stripe","Payments and subscriptions","Commerce"],["Notion","Pages, databases and knowledge","Productivity"]].map(([name,description,category]) => <article className="connector-card" key={name}><div className="connector-icon">{name.slice(0,1)}</div><div className="connector-copy"><span>{category}</span><strong>{name}</strong><p>{description}</p></div><button type="button" onClick={() => { setConnectedConnectors((items) => items.includes(name) ? items.filter((item) => item !== name) : [...items, name]); setConnectorModal(name); }}>Connect</button></article>)}</div>
          </section>
        ) : view === "settings" ? (
          <section className="settings-page"><div className="page-heading"><div><div className="eyebrow">WORKSPACE</div><h1>Settings</h1><p>Workspace configuration and AI defaults.</p></div></div><div className="settings-card"><strong>AI provider</strong><span>{aiProvider} · {aiModel}</span><small>Change the active provider and model from the top bar.</small></div>
            {localAITestEnabled && <div className="settings-card">
              <strong>Quick OpenRouter test</strong>
              <span>{localAIConfigured ? "Connected for this session" : "Not connected"}</span>
              <small>For local testing only. The key stays in the running NEXUM server memory and is not written to GitHub or project files.</small>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <input
                  type="password"
                  value={localAIKey}
                  onChange={(event) => setLocalAIKey(event.target.value)}
                  placeholder="sk-or-v1-…"
                  autoComplete="off"
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button type="button" className="home-primary" disabled={localAIKeyLoading || !localAIKey.trim()} onClick={() => void saveLocalAIKey()}>
                  {localAIKeyLoading ? "Checking…" : "Connect"}
                </button>
              </div>
            </div>}<div className="settings-card"><strong>Projects</strong><span>{projects.filter((project) => project.status === "active").length} active</span><small>Each project has its own workspace and files.</small></div></section>
        ) : (
        <>
        <div className="workspace-toolbar">
          <div className="workspace-breadcrumb"><span>Projects</span><b>/</b><strong>{activeProject?.name ?? "NEXUM"}</strong></div>
          <div className="workspace-actions">
            <button type="button" onClick={() => setConnectorModal("Project connector")}>◇ Connect</button>
            <button type="button" onClick={async () => { const url = `${window.location.origin}/api/preview/${activeProjectId}/index.html`; try { await navigator.clipboard.writeText(url); setNotice("Preview link copied"); } catch { setNotice(url); } }}>↗ Share</button>
            <button className="workspace-deploy" type="button" onClick={() => { const url = `/api/preview/${activeProjectId}/index.html`; window.open(url, "_blank", "noopener,noreferrer"); setNotice("Preview opened in a new tab"); }}>Deploy</button>
            <button className="workspace-more" type="button" aria-label="Project menu" onClick={() => setWorkspaceMenuOpen((open) => !open)}>•••</button>
            {workspaceMenuOpen && <div className="workspace-menu"><button type="button" onClick={() => { setWorkspaceMenuOpen(false); setView("settings"); }}>Project settings</button><button type="button" onClick={async () => {
                setWorkspaceMenuOpen(false);
                try {
                  const response = await fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/duplicate`, { method: "POST" });
                  const data = await response.json() as { project?: Project; error?: string };
                  if (!response.ok || !data.project) throw new Error(data.error || "Duplicate failed");
                  await loadProjects(data.project.id);
                  setActiveProjectId(data.project.id);
                  setNotice("Project duplicated");
                } catch (error) { setApiError(error instanceof Error ? error.message : "Duplicate failed"); }
              }}>Duplicate project</button><button type="button" onClick={() => {
                setWorkspaceMenuOpen(false);
                void deleteProject(activeProjectId);
              }}>Delete project</button></div>}
          </div>
        </div>
        <div className={`workspace ${builderStarted ? "builder-started" : "builder-idle"}`}>
          <div className="main-column">
            <ChatPanel message={message} reply={reply} stage={agentStage} apiError={apiError} messages={conversation} attachments={pendingAttachments} onMessageChange={setMessage} onSubmit={() => void sendMessage()} onRetry={() => void sendMessage(lastMessage)} onQuickTask={runTask} onFilesSelected={(files) => setPendingAttachments((items) => [...items, ...files.map((file) => ({ id: `${file.name}-${file.size}-${file.lastModified}`, name: file.name, type: file.type, size: file.size, file }))].slice(-5))} onRemoveAttachment={(id) => setPendingAttachments((items) => items.filter((item) => item.id !== id))} onOpenAgent={() => setRightTab("agent")} />
            <QuickActions onNewProject={() => setModalOpen(true)} onOpenProject={openProjectPicker} onAsk={() => focusTask()} onTask={runTask}
              onPreview={() => { setRightTab("preview"); setPreviewKey((key) => key + 1); setNotice("Preview refreshed"); }}
              onDeploy={() => { window.open(`/api/preview/${activeProjectId}/index.html`, "_blank", "noopener,noreferrer"); setNotice("Preview opened in a new tab"); }} />
          </div>
          <RightPanel tab={rightTab} onTabChange={setRightTab} projectName={activeProject?.name ?? "NEXUM"} projectId={activeProjectId} previewOnline={previewOnline} previewKey={previewKey} onRefreshPreview={() => setPreviewKey((key) => key + 1)} jobId={chatJobId} stage={agentStage} activitySteps={activitySteps} activityEvents={activityEvents} currentActivity={currentActivity} problems={problems} productPlan={productPlan} />
        </div>
        </>
        )}
      </main>
      <StatusBar projectName={activeProject?.name ?? "NEXUM"} provider={aiProvider} aiStatus={aiStatus} previewOnline={previewOnline} />
      <CommandPalette key={paletteOpen ? "open" : "closed"} open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} />
      <NewProjectModal open={modalOpen} name={newProjectName} loading={projectActionLoading} onNameChange={setNewProjectName} onClose={() => setModalOpen(false)} onSubmit={(event) => void createProject(event)} />
      {connectorModal && <div className="modal-backdrop connector-backdrop" onMouseDown={() => setConnectorModal(null)}><section className="connector-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div className="modal-top"><div><span className="eyebrow">CONNECTOR</span><h2>{connectorModal}</h2></div><button type="button" onClick={() => setConnectorModal(null)}>×</button></div><p>{connectedConnectors.includes(connectorModal) ? "This connector is enabled for this workspace UI. Provider OAuth/API credentials are not stored yet." : "Enable this connector for the current workspace. Provider OAuth/API credentials are not stored yet."}</p><div className="connector-modal-actions"><button type="button" onClick={() => setConnectorModal(null)}>Cancel</button><button className="home-primary" type="button" onClick={() => { if (!connectedConnectors.includes(connectorModal)) setConnectedConnectors((items) => [...items, connectorModal]); setConnectorModal(null); setNotice(connectorModal + " connector enabled"); }}>Continue</button></div></section></div>}
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}

export default App;
