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
import type { ИИProviderInfo, ИИProviderStatus, AgentStage, Проект } from "./components/types";
// UI controls persist locally; server-side credentials remain outside the client bundle.

function App() {
  const [projects, setПроекты] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("nexum");
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [lastMessage, setLastMessage] = useState("");
  const [agentStage, setAgentStage] = useState<AgentStage>(null);
  const [projectsLoading, setПроектыLoading] = useState(true);
  const [projectActionLoading, setProjectActionLoading] = useState(false);
  const [apiError, setApiError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [aiProviders, setИИProviders] = useState<ИИProviderInfo[]>([]);
  const [aiModels, setИИModels] = useState<Record<string, string[]>>({});
  const [aiProvider, setИИProvider] = useState("mock");
  const [aiModel, setИИModel] = useState("mock-v1");
  const [aiStatus, setИИStatus] = useState<ИИProviderStatus | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [rightTab, setRightTab] = useState<"preview" | "files" | "agent">("preview");
  const [notice, setNotice] = useState("");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [previewOnline, setPreviewOnline] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [builderStarted, setBuilderStarted] = useState(false);
  const [chatJobId, setChatJobId] = useState<string | null>(null);
  const [view, setView] = useState<"home" | "project" | "connectors" | "settings">("project");
  const [connectorModal, setПодключитьorModal] = useState<string | null>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [connectedПодключитьors, setПодключитьedПодключитьors] = useState<string[]>([]);
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
  const [localИИKey, setLocalИИKey] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiApiKeyLoading, setAiApiKeyLoading] = useState(false);
  const localИИTestEnabled = true;
  const [localИИConfigured, setLocalИИConfigured] = useState(false);
  const [localИИKeyLoading, setLocalИИKeyLoading] = useState(false);
  const [conversation, setConversation] = useState<Array<{ id: string; role: "user" | "assistant"; content: string; timestamp: number; attachments?: string[] }>>([]);
  const [pendingAttachments, setPendingAttachments] = useState<Array<{ id: string; name: string; type: string; size: number; file: File }>>([]);
  const [uiНастройки, setUiНастройки] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("nexum:ui-settings") || "{}") as Partial<{animations:boolean; compact:boolean; autoPreview:boolean; sound:boolean; glow:boolean}>;
      return { animations: saved.animations !== false, compact: Boolean(saved.compact), autoPreview: saved.autoPreview !== false, sound: Boolean(saved.sound), glow: saved.glow !== false };
    } catch { return { animations:true, compact:false, autoPreview:true, sound:false, glow:true }; }
  });
  useEffect(() => { try { localStorage.setItem("nexum:ui-settings", JSON.stringify(uiНастройки)); } catch {} }, [uiНастройки]);
  useEffect(() => { document.documentElement.dataset.motion=uiНастройки.animations?"on":"off"; document.documentElement.dataset.compact=uiНастройки.compact?"on":"off"; document.documentElement.dataset.glow=uiНастройки.glow?"on":"off"; }, [uiНастройки]);

  const activeПроект = projects.find((project) => project.id === activeProjectId);

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
    const onPreviewMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; projectId?: string; kind?: string; message?: string; stack?: string };
      if (data?.source !== "nexum-preview" || data.projectId !== activeProjectId || typeof data.message !== "string") return;
      setProblems((items) => [...items, { message: `Preview ${data.kind ?? "error"}: ${data.message}`, source: "preview" }].slice(-20));
      void fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/preview/runtime-error`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: data.kind, message: data.message, stack: data.stack }),
        keepalive: true,
      }).catch(() => {});
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("message", onPreviewMessage);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("message", onPreviewMessage);
    };
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("nexum:connectors") || "[]");
      if (Array.isArray(saved)) setПодключитьedПодключитьors(saved.filter((item): item is string => typeof item === "string"));
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem("nexum:connectors", JSON.stringify(connectedПодключитьors)); } catch {} }, [connectedПодключитьors]);

  useEffect(() => {
    if (!activeProjectId) return;
    fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/preview/status`).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { online?: boolean };
      setPreviewOnline(Boolean(data.online));
    }).catch(() => setPreviewOnline(false));
  }, [activeProjectId, previewKey]);
  const selectedModels = aiModels[aiProvider] ?? [];

  async function loadПроекты(preferredId = activeProjectId) {
    setПроектыLoading(true);
    try {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error(`Проекты API: HTTP ${response.status}`);
      const data = (await response.json()) as { projects?: Project[] };
      const nextПроекты = data.projects ?? [];
      const preferred = nextПроекты.find((project) => project.id === preferredId && project.status === "active");
      const fallback = nextПроекты.find((project) => project.id === "nexum" && project.status === "active")
        ?? nextПроекты.find((project) => project.status === "active");
      setПроекты(nextПроекты);
      setActiveProjectId(preferred?.id ?? fallback?.id ?? "nexum");
      setApiError("");
    } catch (error) {
      console.error("[Nexum] API projects request failed:", error);
      setApiError(error instanceof Error ? error.message : "Cannot reach API");
    } finally {
      setПроектыLoading(false);
    }
  }

  useEffect(() => { void loadПроекты("nexum"); }, []);

  useEffect(() => {
    async function loadИИConfig() {
      try {
        const [providersResponse, modelsResponse] = await Promise.all([
          fetch("/api/ai/providers"),
          fetch("/api/ai/models"),
        ]);
        if (!providersResponse.ok || !modelsResponse.ok) throw new Error(`ИИ config API: HTTP ${!providersResponse.ok ? providersResponse.status : modelsResponse.status}`);
        const providersData = (await providersResponse.json()) as { providers?: ИИProviderInfo[] };
        const modelsData = (await modelsResponse.json()) as { models?: Record<string, string[]> };
        const providers = providersData.providers ?? [];
        const defaultProvider = providers.find((provider) => provider.isDefault) ?? providers[0];
        setИИProviders(providers);
        setИИModels(modelsData.models ?? {});
        if (defaultProvider) { setИИProvider(defaultProvider.id); setИИModel(defaultProvider.model); }
      } catch (error) {
        console.error("[Nexum] ИИ config request failed:", error);
        setApiError(error instanceof Error ? error.message : "ИИ config unavailable");
      }
    }
    void loadИИConfig();
  }, []);

  useEffect(() => {
    if (!aiProvider) return;
    let cancelled = false;
    async function refreshИИStatus() {
      try {
        const response = await fetch(`/api/ai/status?provider=${encodeURIComponent(aiProvider)}&model=${encodeURIComponent(aiModel)}`);
        const data = response.ok ? (await response.json()) as { status?: ИИProviderStatus } : null;
        if (!cancelled) setИИStatus(data?.status ?? { provider: aiProvider, available: false, model: aiModel, latencyMs: null, error: "ИИ status unavailable" });
      } catch {
        if (!cancelled) setИИStatus({ provider: aiProvider, available: false, model: aiModel, latencyMs: null, error: "Cannot reach ИИ status endpoint" });
      }
    }
    void refreshИИStatus();
    const timer = window.setInterval(refreshИИStatus, 10000);
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
      if (!response.ok) throw new Error(`Проект selection API: HTTP ${response.status}`);
      setActiveProjectId(projectId);
      setReply("");
      await loadПроекты(projectId);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Проект selection failed");
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
      if (!response.ok) throw new Error(data.error || "Проект deletion failed");
      const fallbackId = projects.find((item) => item.status === "active" && item.id !== projectId)?.id ?? "nexum";
      await loadПроекты(activeProjectId === projectId ? fallbackId : activeProjectId);
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
      setNotice(`Проект «${project.name}» удалён`);
      window.setTimeout(() => setNotice(""), 3200);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Проект deletion failed");
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
      if (!response.ok) throw new Error(`Проект creation API: HTTP ${response.status}`);
      const data = (await response.json()) as { project: Проект };
      await selectProject(data.project.id);
      setView("project");
      setNewProjectName("");
      setModalOpen(false);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Проект creation failed");
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
    setCurrentActivity("Отправляю задачу ИИ-агенту…");
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
          throw new Error(data?.job?.error || "ИИ agent failed");
        }

        setActivitySteps(data?.job?.steps ?? []);
        setActivityEvents(data?.job?.events ?? []);
        setCurrentActivity(data?.job?.currentMessage ?? "ИИ выполняет задачу…");
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

  async function connectИИKey() {
    if (!aiApiKey.trim()) return;
    setAiApiKeyLoading(true);
    setApiError("");
    try {
      const response = await fetch("/api/ai/connect-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: aiApiKey.trim() }),
      });
      const data = await response.json().catch(() => ({})) as { success?: boolean; provider?: string; model?: string; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "API key verification failed");
      const provider = data.provider || "openai";
      setAiApiKey("");
      setИИProvider(provider);
      setИИModel(data.model || aiModels[provider]?.[0] || (provider === "openai" ? "gpt-5" : provider === "orcarouter" ? "deepseek/deepseek-v4-flash-free" : "openrouter/free"));
      setNotice(provider === "openai" ? "OpenИИ connected — GPT models are ready" : "OpenRouter connected");
      window.setTimeout(() => setNotice(""), 3200);
      const modelsResponse = await fetch("/api/ai/models");
      if (modelsResponse.ok) {
        const modelsData = await modelsResponse.json() as { models?: Record<string, string[]> };
        setИИModels(modelsData.models ?? {});
      }
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "ИИ key setup failed");
    } finally {
      setAiApiKeyLoading(false);
    }
  }

  async function saveLocalИИKey() {
    if (!localИИKey.trim()) return;
    setLocalИИKeyLoading(true);
    setApiError("");
    try {
      const response = await fetch("/api/ai/local-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: localИИKey.trim() }),
      });
      const data = await response.json().catch(() => ({})) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "OpenRouter key verification failed");
      setLocalИИConfigured(true);
      setLocalИИKey("");
      setИИProvider("openrouter");
      setИИModel("openrouter/free");
      setNotice("OpenRouter connected for this local test session");
      window.setTimeout(() => setNotice(""), 3200);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "OpenRouter key setup failed");
    } finally {
      setLocalИИKeyLoading(false);
    }
  }

  function selectИИProvider(providerId: string) {
    const provider = aiProviders.find((item) => item.id === providerId);
    setИИProvider(providerId);
    setИИModel(aiModels[providerId]?.[0] ?? provider?.model ?? "");
  }

  function focusTask(task = "") {
    setMessage(task);
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(".message-box textarea")?.focus(), 0);
  }

    function openProjectPicker() {
    setMobileSidebarOpen(true);
    setNotice("Выберите проект в боковой панели");
    window.setTimeout(() => setNotice(""), 3200);
  }

  const runTask = (task: string) => void sendMessage(task);
  const paletteActions = [
    { label: "New Project", hint: "N", run: () => setModalOpen(true) },
    { label: "Open Project", hint: "O", run: openProjectPicker },
    { label: "Поиск файлов", hint: "S", run: () => focusTask("Найди ") },
    { label: "Open Agent Activity", hint: "A", run: () => setRightTab("agent") },
    { label: "Запустить тесты", hint: "T", run: () => runTask("Запусти тесты в изолированной среде") },
    { label: "Запустить сборку", hint: "B", run: () => runTask("Проверь сборку проекта") },
    { label: "Статус Git", hint: "G", run: () => runTask("Покажи статус Git") },
    { label: "Изменения Git", hint: "D", run: () => runTask("Что изменилось?") },
    { label: "Открыть предпросмотр", hint: "P", run: () => { setRightTab("preview"); setPreviewKey((key) => key + 1); setNotice("Предпросмотр обновлён"); } },
    { label: "Перезапустить предпросмотр", hint: "R", run: () => { setRightTab("preview"); setPreviewKey((key) => key + 1); setNotice("Предпросмотр перезапущен"); } },
    { label: "Ask ИИ", hint: "A", run: () => focusTask() },
    { label: "Сменить модель", hint: "M", run: () => document.querySelector<HTMLSelectElement>("select[aria-label='ИИ model']")?.focus() },
    { label: "Настройки", hint: "", run: () => setView("settings") },
  ];

  return (
    <div className="app">
      <Sidebar projects={projects} activeProjectId={activeProjectId} projectsLoading={projectsLoading} projectActionLoading={projectActionLoading} mobileOpen={mobileSidebarOpen} view={view} onDeleteProject={(id) => void deleteProject(id)} onViewChange={(next) => { setMobileSidebarOpen(false); setView(next); }} onNewProject={() => { setMobileSidebarOpen(false); setModalOpen(true); }} onSelectProject={(id) => { setMobileSidebarOpen(false); openProject(id); }} />
      <main className="main">
        <TopBar projectName={view === "connectors" ? "Подключитьors" : view === "settings" ? "Настройки" : view === "home" ? "NEXUM.DEV" : activeProject?.name ?? "NEXUM"} providers={aiProviders} models={selectedModels} provider={aiProvider} model={aiModel} aiStatus={aiStatus} stage={agentStage} onProviderChange={selectИИProvider} onModelChange={setИИModel} onToggleSidebar={() => setMobileSidebarOpen((open) => !open)} />
        {view === "home" ? (
          <section className="nexum-home">
            <div className="home-hero"><div><div className="eyebrow">NEXUM.DEV</div><h1>Создавайте, не покидая рабочее пространство.</h1><p>Создайте проект, откройте его как отдельное рабочее пространство, подключите сервисы и поручите агенту разработку.</p></div><button className="home-primary" type="button" onClick={() => setModalOpen(true)}>+ Новый проект</button></div>
            <div className="home-section-title"><span>ВАШИ ПРОЕКТЫ</span><button type="button" onClick={() => setModalOpen(true)}>Новый проект</button></div>
            <div className="project-grid">{projects.filter((project) => project.status === "active").map((project) => <button key={project.id} className="project-window" type="button" onClick={() => openProject(project.id)}><span className="window-chrome"><i/><i/><i/></span><span className="project-window-mark">{project.name.slice(0, 1)}</span><strong>{project.name}</strong><span className="project-window-meta">Открыть рабочее пространство →</span></button>)}{projects.length === 0 && <div className="empty-card">Создайте свой первый проект.</div>}</div>
          </section>
        ) : view === "connectors" ? (
          <section className="connectors-page">
            <div className="page-heading"><div><div className="eyebrow">ИНТЕГРАЦИИ</div><h1>Подключитьors</h1><p>Подключите сервисы, которые используют ваши проекты.</p></div><button className="home-primary" type="button" onClick={() => setПодключитьorModal("Custom connector")}>+ Добавить интеграцию</button></div>
            <div className="connector-grid">{[["GitHub","Репозиторий, ветки, коммиты и задачи","Разработка"],["Supabase","База данных, авторизация и хранилище","Бэкенд"],["OpenИИ","ИИ models and API access","ИИ"],["Telegram","Боты, сообщения и автоматизация","Коммуникации"],["Stripe","Платежи и подписки","Платежи"],["Notion","Страницы, базы данных и база знаний","Продуктивность"]].map(([name,description,category]) => <article className="connector-card" key={name}><div className="connector-icon">{name.slice(0,1)}</div><div className="connector-copy"><span>{category}</span><strong>{name}</strong><p>{description}</p></div><button type="button" onClick={() => { setПодключитьedПодключитьors((items) => items.includes(name) ? items.filter((item) => item !== name) : [...items, name]); setПодключитьorModal(name); }}>Подключить</button></article>)}</div>
          </section>
        ) : view === "settings" ? (
          <section className="settings-page">
            <div className="page-heading"><div><div className="eyebrow">УПРАВЛЕНИЕ РАБОЧИМ ПРОСТРАНСТВОМ</div><h1>Настройки</h1><p>ИИ, workspace behavior and interface preferences.</p></div></div>
            <div className="settings-grid">
              <div className="settings-card"><strong>ИИ provider</strong><span>{aiProvider} · {aiModel}</span><small>Активный провайдер и модель агента.</small></div>
              <div className="settings-card"><strong>Поведение предпросмотра</strong><span>{uiНастройки.autoPreview ? "Автообновление включено" : "Ручное обновление"}</span><small>Автоматически обновлять предпросмотр после успешной работы агента.</small><div className="settings-option-row"><div className="settings-option-copy"><b>Автопредпросмотр</b><span>Обновлять после сборки</span></div><button type="button" aria-label="Toggle auto preview" className={`nexum-toggle ${uiНастройки.autoPreview?"on":""}`} onClick={()=>setUiНастройки(s=>({...s,autoPreview:!s.autoPreview}))}></button></div></div>
              <div className="settings-card"><strong>Анимации и эффекты</strong><span>{uiНастройки.animations ? "Анимированный интерфейс" : "Минимум анимаций"}</span><small>Управляет переходами, анимациями появления и микро-взаимодействиями.</small><div className="settings-option-row"><div className="settings-option-copy"><b>Анимации</b><span>Переходы и движение</span></div><button type="button" aria-label="Toggle animations" className={`nexum-toggle ${uiНастройки.animations?"on":""}`} onClick={()=>setUiНастройки(s=>({...s,animations:!s.animations}))}></button></div><div className="settings-option-row"><div className="settings-option-copy"><b>Свечение</b><span>Акцентная подсветка и свечение фокуса</span></div><button type="button" aria-label="Toggle ambient glow" className={`nexum-toggle ${uiНастройки.glow?"on":""}`} onClick={()=>setUiНастройки(s=>({...s,glow:!s.glow}))}></button></div></div>
              <div className="settings-card"><strong>Плотность интерфейса</strong><span>{uiНастройки.compact ? "Компактный" : "Комфортный"}</span><small>Выберите объём информации, отображаемый одновременно.</small><div className="settings-option-row"><div className="settings-option-copy"><b>Компактный mode</b><span>Более плотные панели и элементы управления</span></div><button type="button" aria-label="Toggle compact mode" className={`nexum-toggle ${uiНастройки.compact?"on":""}`} onClick={()=>setUiНастройки(s=>({...s,compact:!s.compact}))}></button></div></div>
              <div className="settings-card"><strong>Уведомления</strong><span>{uiНастройки.sound ? "Звук включён" : "Без звука"}</span><small>Необязательный звук завершения агента при успехе или ошибке.</small><div className="settings-option-row"><div className="settings-option-copy"><b>Звук завершения</b><span>Агент завершил работу / ошибка</span></div><button type="button" aria-label="Toggle completion sound" className={`nexum-toggle ${uiНастройки.sound?"on":""}`} onClick={()=>setUiНастройки(s=>({...s,sound:!s.sound}))}></button></div></div>
              <div className="settings-card"><strong>Горячие клавиши</strong><span>⌘/Ctrl + K</span><small>Открывайте палитру команд для проектов, проверок, Git и переключения разделов.</small></div>
              <div className="settings-card"><strong>Проект storage</strong><span>{projects.filter((project) => project.status === "active").length} активных проектов</span><small>Каждый проект хранит собственные файлы, предпросмотр и контекст диалога.</small></div>
            </div>
            <div className="settings-card" style={{marginTop:12}}><strong>ИИ API key</strong><span>Автоматическое определение провайдера</span><small>Paste an OpenИИ, OpenRouter, or OrcaRouter key. NEXUM verifies the key and keeps it only in running server memory.</small><div style={{display:"flex",gap:8,marginTop:12}}><input type="password" value={aiApiKey} onChange={event=>setAiApiKey(event.target.value)} placeholder="Вставьте API-ключ" autoComplete="off" style={{flex:1,minWidth:0}}/><button type="button" className="home-primary" disabled={aiApiKeyLoading||!aiApiKey.trim()} onClick={()=>void connectИИKey()}>{aiApiKeyLoading?"Проверяю…":"Подключить ИИ"}</button></div></div>
            {localИИTestEnabled && <div className="settings-card" style={{marginTop:12}}><strong>Тестовая сессия OpenRouter</strong><span>{localИИConfigured?"Подключитьed":"Не подключено"}</span><small>Временный ключ сессии для тестирования моделей без хранения учётных данных в репозитории.</small><div style={{display:"flex",gap:8,marginTop:12}}><input type="password" value={localИИKey} onChange={event=>setLocalИИKey(event.target.value)} placeholder="sk-or-v1-…" autoComplete="off" style={{flex:1,minWidth:0}}/><button type="button" className="home-primary" disabled={localИИKeyLoading||!localИИKey.trim()} onClick={()=>void saveLocalИИKey()}>{localИИKeyLoading?"Проверяю…":"Подключить"}</button></div></div>}
          </section>
        ) : (
        <>
        <div className="workspace-toolbar">
          <div className="workspace-breadcrumb"><span>Проекты</span><b>/</b><strong>{activeProject?.name ?? "NEXUM"}</strong></div>
          <div className="workspace-actions">
            <button type="button" onClick={() => setПодключитьorModal("Проект connector")}>◇ Подключить</button>
            <button type="button" onClick={async () => { const url = `${window.location.origin}/api/preview/${activeProjectId}/index.html`; try { await navigator.clipboard.writeText(url); setNotice("Preview link copied"); } catch { setNotice(url); } }}>↗ Share</button>
            <button className="workspace-deploy" type="button" onClick={() => { const url = `/api/preview/${activeProjectId}/index.html`; window.open(url, "_blank", "noopener,noreferrer"); setNotice("Предпросмотр открыт в новой вкладке"); }}>Deploy</button>
            <button className="workspace-more" type="button" aria-label="Проект menu" onClick={() => setWorkspaceMenuOpen((open) => !open)}>•••</button>
            {workspaceMenuOpen && <div className="workspace-menu"><button type="button" onClick={() => { setWorkspaceMenuOpen(false); setView("settings"); }}>Проект settings</button><button type="button" onClick={async () => {
                setWorkspaceMenuOpen(false);
                try {
                  const response = await fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/duplicate`, { method: "POST" });
                  const data = await response.json() as { project?: Project; error?: string };
                  if (!response.ok || !data.project) throw new Error(data.error || "Duplicate failed");
                  await loadПроекты(data.project.id);
                  setActiveProjectId(data.project.id);
                  setNotice("Проект дублирован");
                } catch (error) { setApiError(error instanceof Error ? error.message : "Duplicate failed"); }
              }}>Дублировать проект</button><button type="button" onClick={() => {
                setWorkspaceMenuOpen(false);
                void deleteProject(activeProjectId);
              }}>Удалить проект</button></div>}
          </div>
        </div>
        <div className={`workspace ${builderStarted ? "builder-started" : "builder-idle"}`}>
          <div className="main-column">
            <ChatPanel message={message} reply={reply} stage={agentStage} apiError={apiError} messages={conversation} attachments={pendingAttachments} onMessageChange={setMessage} onSubmit={() => void sendMessage()} onRetry={() => void sendMessage(lastMessage)} onQuickTask={runTask} onFilesSelected={(files) => setPendingAttachments((items) => [...items, ...files.map((file) => ({ id: `${file.name}-${file.size}-${file.lastModified}`, name: file.name, type: file.type, size: file.size, file }))].slice(-5))} onRemoveAttachment={(id) => setPendingAttachments((items) => items.filter((item) => item.id !== id))} onOpenAgent={() => setRightTab("agent")} />
            <QuickActions onNewProject={() => setModalOpen(true)} onOpenProject={openProjectPicker} onAsk={() => focusTask()} onTask={runTask}
              onPreview={() => { setRightTab("preview"); setPreviewKey((key) => key + 1); setNotice("Предпросмотр обновлён"); }}
              onDeploy={() => { window.open(`/api/preview/${activeProjectId}/index.html`, "_blank", "noopener,noreferrer"); setNotice("Предпросмотр открыт в новой вкладке"); }} />
          </div>
          <RightPanel tab={rightTab} onTabChange={setRightTab} projectName={activeProject?.name ?? "NEXUM"} projectId={activeProjectId} previewOnline={previewOnline} previewKey={previewKey} onRefreshPreview={() => setPreviewKey((key) => key + 1)} jobId={chatJobId} stage={agentStage} activitySteps={activitySteps} activityEvents={activityEvents} currentActivity={currentActivity} problems={problems} productPlan={productPlan} />
        </div>
        </>
        )}
      </main>
      <StatusBar projectName={activeProject?.name ?? "NEXUM"} provider={aiProvider} aiStatus={aiStatus} previewOnline={previewOnline} />
      <CommandPalette key={paletteOpen ? "open" : "closed"} open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} />
      <NewProjectModal open={modalOpen} name={newProjectName} loading={projectActionLoading} onNameChange={setNewProjectName} onClose={() => setModalOpen(false)} onSubmit={(event) => void createProject(event)} />
      {connectorModal && <div className="modal-backdrop connector-backdrop" onMouseDown={() => setПодключитьorModal(null)}><section className="connector-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div className="modal-top"><div><span className="eyebrow">CONNECTOR</span><h2>{connectorModal}</h2></div><button type="button" onClick={() => setПодключитьorModal(null)}>×</button></div><p>{connectedПодключитьors.includes(connectorModal) ? "Эта интеграция включена в интерфейсе рабочего пространства. OAuth/API-данные провайдера пока не сохраняются." : "Включить интеграцию для текущего рабочего пространства. OAuth/API-данные провайдера пока не сохраняются."}</p><div className="connector-modal-actions"><button type="button" onClick={() => setПодключитьorModal(null)}>Отмена</button><button className="home-primary" type="button" onClick={() => { if (!connectedПодключитьors.includes(connectorModal)) setПодключитьedПодключитьors((items) => [...items, connectorModal]); setПодключитьorModal(null); setNotice(connectorModal + " интеграция подключена"); }}>Продолжить</button></div></section></div>}
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}

export default App;
