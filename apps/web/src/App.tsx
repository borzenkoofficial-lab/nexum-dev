import "./App.css";
import "./nexum-os.css";
import { NexumWelcome } from "./components/NexumWelcome";
import { useEffect, useRef, useState } from "react";
import { ChatPanel } from "./components/ChatPanel";
import { CommandPalette } from "./components/CommandPalette";
import { CodePanel } from "./components/CodePanel";
import { NewProjectModal } from "./components/NewProjectModal";
import { NewsPage } from "./components/NewsPage";
import { IntegrationPage } from "./components/IntegrationPage";
import { DiagnosticsPage } from "./components/DiagnosticsPage";
import { RightPanel } from "./components/RightPanel";
import { OSDesktop } from "./components/OSDesktop";
import { OSProjectWindow } from "./components/OSProjectWindow";
import { NexumApplicationManager } from "./components/NexumApplicationManager";
import { NexumOSEventCenter, type NexumOSEventItem } from "./components/NexumOSEventCenter";
import { OSSystemChrome } from "./components/OSSystemChrome";
import { OSAppWindow } from "./components/OSAppWindow";
import type { AIProviderInfo, AIProviderStatus, AgentStage as АгентStage, Project as Проект } from "./components/types";
import { diagnosticsEvent, getDiagnosticsSessionId, startDiagnostics } from "./diagnostics";
import { nexumRuntime } from "./runtime";
// UI controls persist locally; server-side credentials remain outside the client bundle.

function App() {
  useEffect(() => { startDiagnostics(); diagnosticsEvent({ type: "app-mounted", level: "info", message: "NEXUM application mounted" }); }, []);
  const [projects, setПроектs] = useState<Проект[]>([]);
  const [activeПроектId, setActiveПроектId] = useState(() => {
    const segments = window.location.pathname.split("/").filter(Boolean);
    return segments[0] === "projects" && segments[1] ? decodeURIComponent(segments[1]) : "nexum";
  });
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [lastMessage, setLastMessage] = useState("");
  const [agentStage, setАгентStage] = useState<АгентStage>(null);
  const [, setПроектsLoading] = useState(true);
  const [projectActionLoading, setПроектActionLoading] = useState(false);
  const [apiError, setApiError] = useState("");
  const [projectCreationError, setProjectCreationError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [newПроектName, setNewПроектName] = useState("");
  const [aiProviders, setAIProviders] = useState<AIProviderInfo[]>([]);
  const [aiModels, setAIModels] = useState<Record<string, string[]>>({});
  const [aiProvider, setAIProvider] = useState("mock");
  const [aiModel, setAIModel] = useState("mock-v1");
  const [aiStatus, setAIStatus] = useState<AIProviderStatus | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [rightTab, setRightTab] = useState<"preview" | "files" | "agent">("preview");
  const [mobileToolOpen, setMobileToolOpen] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<"preview" | "agent" | "files" | "code">("preview");
  const [projectWindowModes, setProjectWindowModes] = useState<Record<string, "preview" | "agent" | "files" | "code">>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem("nexum:os:window-modes") || "{}");
      return saved && typeof saved === "object" ? saved : {};
    } catch { return {}; }
  });
  useEffect(() => {
    try { sessionStorage.setItem("nexum:os:window-modes", JSON.stringify(projectWindowModes)); } catch {}
  }, [projectWindowModes]);
  const [codeMode, setCodeMode] = useState(false);
  const [projectWindowMinimizedByProject, setProjectWindowMinimizedByProject] = useState<Record<string, boolean>>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem("nexum:os:minimized-windows") || "{}");
      return saved && typeof saved === "object" ? saved : {};
    } catch { return {}; }
  });
  const projectWindowMinimized = Boolean(projectWindowMinimizedByProject[activeПроектId]);
  const [osBooted, setOsBooted] = useState(false);
  // OS is enabled on every fresh page load; the switch is session-only for testing.
  const [osEnabled, setOsEnabled] = useState(true);
  const [onboardingComplete, setOnboardingComplete] = useState(() => { try { return localStorage.getItem("nexum:onboarding-complete") === "1"; } catch { return false; } });
  const [welcomeTestMode, setWelcomeTestMode] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setOsBooted(true), 180);
    return () => window.clearTimeout(timer);
  }, []);
  const [runningProjectIds, setRunningProjectIds] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem("nexum:os:running-windows") || "[]");
      return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
    } catch { return []; }
  });
  const [notice, setNotice] = useState("");
  const [osEvents, setOsEvents] = useState<NexumOSEventItem[]>([]);
  const osEventSeq = useRef(0);
  const pushOSEvent = (kind: NexumOSEventItem["kind"], title: string, eventMessage: string) => {
    const id = Date.now() + osEventSeq.current++;
    setOsEvents((items) => [...items.slice(-2), { id, kind, title, message: eventMessage }]);
  };
  const [previewOnline, setПредпросмотрOnline] = useState(false);
  const [previewKey, setПредпросмотрKey] = useState(0);
  const [builderStarted, setBuilderStarted] = useState(false);
  const [chatJobId, setChatJobId] = useState<string | null>(null);
  const chatJobIdRef = useRef<string | null>(null);
  const setAuthoritativeChatJobId = (jobId: string | null) => {
    chatJobIdRef.current = jobId;
    setChatJobId(jobId);
  };
  const clearAuthoritativeChatJobIfOwned = (jobId: string) => {
    if (chatJobIdRef.current !== jobId) return false;
    chatJobIdRef.current = null;
    setChatJobId(null);
    return true;
  };
  const [projectTaskMeta, setProjectTaskMeta] = useState<Record<string, { task: string; timestamp: number; status: "queued" | "running" | "completed" | "failed" | "cancelled" }>>(() => { try { return JSON.parse(localStorage.getItem("nexum:project-task-meta") || "{}"); } catch { return {}; } });
  const [view, setViewState] = useState<"home" | "project" | "connectors" | "settings" | "news" | "diagnostics">(() => {
    const path = window.location.pathname;
    return path.startsWith("/projects/") && path.split("/").filter(Boolean)[1] ? "project" : path === "/settings" ? "settings" : path === "/connectors" ? "connectors" : path === "/news" ? "news" : path === "/diagnostics" ? "diagnostics" : "home";
  });
  const [connectorModal, setConnectorModal] = useState<string | null>(null);
  const [connectedConnectors, setConnectedConnectors] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("nexum:connected-connectors") || "[]");
      return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try { localStorage.setItem("nexum:connected-connectors", JSON.stringify(connectedConnectors)); } catch {}
  }, [connectedConnectors]);
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
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiApiKeyLoading, setAiApiKeyLoading] = useState(false);
  const localAITestEnabled = true;
  const [localAIConfigured, setLocalAIConfigured] = useState(false);
  const [localAIKeyLoading, setLocalAIKeyLoading] = useState(false);
  const [conversation, setConversation] = useState<Array<{ id: string; role: "user" | "assistant"; content: string; timestamp: number; attachments?: string[] }>>([]);
  const conversationПроектRef = useRef<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<Array<{ id: string; name: string; type: string; size: number; file: File }>>([]);
  const [uiSettings, setUiSettings] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("nexum:ui-settings") || "{}") as Partial<{animations:boolean; compact:boolean; autoПредпросмотр:boolean; sound:boolean; glow:boolean; scale:number}>;
      return { animations: saved.animations !== false, compact: Boolean(saved.compact), autoПредпросмотр: saved.autoПредпросмотр !== false, sound: Boolean(saved.sound), glow: false, scale: saved.scale === 90 || saved.scale === 110 ? saved.scale : 100 };
    } catch { return { animations:true, compact:false, autoПредпросмотр:true, sound:false, glow:true }; }
  });
  useEffect(() => { try { localStorage.setItem("nexum:ui-settings", JSON.stringify(uiSettings)); } catch {} }, [uiSettings]);
  useEffect(() => { document.documentElement.dataset.motion=uiSettings.animations?"on":"off"; document.documentElement.dataset.compact=uiSettings.compact?"on":"off"; document.documentElement.dataset.glow=uiSettings.glow?"on":"off"; document.documentElement.dataset.uiScale=String(uiSettings.scale); }, [uiSettings]);

  const activeПроект = projects.find((project) => project.id === activeПроектId);
  useEffect(() => { nexumRuntime.setProject(activeПроектId); }, [activeПроектId]);
  const minimizedProjectIds = runningProjectIds.filter((id) => Boolean(projectWindowMinimizedByProject[id]));
  useEffect(() => {
    try { sessionStorage.setItem("nexum:os:minimized-windows", JSON.stringify(projectWindowMinimizedByProject)); } catch {}
  }, [projectWindowMinimizedByProject]);
  useEffect(() => {
    try { sessionStorage.setItem("nexum:os:running-windows", JSON.stringify(runningProjectIds)); } catch {}
  }, [runningProjectIds]);
  useEffect(() => {
    diagnosticsEvent({
      type: "workspace-context",
      level: "info",
      message: "Workspace context changed",
      projectId: activeПроектId,
      jobId: chatJobId ?? undefined,
      metadata: { view, stage: agentStage, diagnosticsSessionId: getDiagnosticsSessionId() },
    });
  }, [activeПроектId, chatJobId, view, agentStage]);


  useEffect(() => { try { localStorage.setItem("nexum:project-task-meta", JSON.stringify(projectTaskMeta)); } catch {} }, [projectTaskMeta]);
  function navigate(nextView: "home" | "project" | "connectors" | "settings" | "news" | "diagnostics", projectId?: string, replace = false) {
    setViewState(nextView);
    const target = nextView === "project"
      ? "/projects/" + encodeURIComponent(projectId ?? activeПроектId)
      : nextView === "connectors" ? "/connectors"
      : nextView === "settings" ? "/settings"
      : nextView === "news" ? "/news" : nextView === "diagnostics" ? "/diagnostics" : "/projects";
    if (window.location.pathname !== target) {
      if (replace) window.history.replaceState({ view: nextView, projectId }, "", target);
      else window.history.pushState({ view: nextView, projectId }, "", target);
    }
  }

  const setView = (nextView: "home" | "project" | "connectors" | "settings" | "news" | "diagnostics") => navigate(nextView);

  useEffect(() => {
    const onPopState = () => {
      const path = window.location.pathname;
      const segments = path.split("/").filter(Boolean);
      if (segments[0] === "projects" && segments[1]) {
        setActiveПроектId(decodeURIComponent(segments[1]));
        setViewState("project");
      } else if (path === "/connectors") setViewState("connectors");
      else if (path === "/settings") setViewState("settings");
      else if (path === "/news") setViewState("news");
      else if (path === "/diagnostics") setViewState("diagnostics");
      else setViewState("home");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    conversationПроектRef.current = null;
    try {
      const saved = JSON.parse(localStorage.getItem(`nexum:conversation:${activeПроектId}`) || "[]");
      setConversation(Array.isArray(saved) ? saved.slice(-100) : []);
    } catch { setConversation([]); }
    conversationПроектRef.current = activeПроектId;
  }, [activeПроектId]);

  useEffect(() => {
    if (conversationПроектRef.current !== activeПроектId) return;
    try { localStorage.setItem(`nexum:conversation:${activeПроектId}`, JSON.stringify(conversation.slice(-100))); } catch {}
  }, [activeПроектId, conversation]);

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
      void nexumRuntime.network.fetch("/api/agent/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, url: window.location.href }),
        keepalive: true,
      }).catch(() => {});
    };
    const onError = (event: ErrorEvent) => report({ message: event.message || "Browser runtime error", stack: event.error?.stack, source: event.filename });
    const onRejection = (event: PromiseRejectionEvent) => report({ message: event.reason instanceof Error ? event.reason.message : String(event.reason), stack: event.reason instanceof Error ? event.reason.stack : undefined, source: "unhandledrejection" });
    const onПредпросмотрMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; projectId?: string; kind?: string; message?: string; stack?: string };
      if (data?.source !== "nexum-preview" || data.projectId !== activeПроектId || typeof data.message !== "string") return;
      setProblems((items) => [...items, { message: `Предпросмотр ${data.kind ?? "error"}: ${data.message}`, source: "preview" }].slice(-20));
      void nexumRuntime.network.fetch(`/api/projects/${encodeURIComponent(activeПроектId)}/preview/runtime-error`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: data.kind, message: data.message, stack: data.stack }),
        keepalive: true,
      }).catch(() => {});
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("message", onПредпросмотрMessage);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("message", onПредпросмотрMessage);
    };
  }, [activeПроектId]);

  useEffect(() => {
    if (!activeПроектId) { void nexumRuntime.preview.stop(); return; }
    const projectId = activeПроектId;
    nexumRuntime.preview.attach({
      start: async () => { const response = await nexumRuntime.network.fetch(`/api/projects/${encodeURIComponent(projectId)}/preview/status`, { projectId, operation: "preview-start" }); if (!response.ok) throw new Error(`Preview status HTTP ${response.status}`); const data = await response.json() as { online?: boolean }; if (!data.online) throw new Error("Preview offline"); },
      health: async () => { const response = await nexumRuntime.network.fetch(`/api/projects/${encodeURIComponent(projectId)}/preview/status`, { projectId, operation: "preview-health" }); if (!response.ok) return false; const data = await response.json() as { online?: boolean }; return Boolean(data.online); },
      stop: async () => { /* Preview server ownership remains backend-managed; manager stops its monitor here. */ },
      restart: async () => { setПредпросмотрKey(key => key + 1); }
    });
    void nexumRuntime.preview.start({ projectId, operation: "preview" });
    return () => { void nexumRuntime.preview.stop(); };
  }, [activeПроектId]);

  useEffect(() => {
    if (!activeПроектId) return;
    nexumRuntime.network.fetch(`/api/projects/${encodeURIComponent(activeПроектId)}/preview/status`).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { online?: boolean };
      setПредпросмотрOnline(Boolean(data.online));
    }).catch(() => setПредпросмотрOnline(false));
  }, [activeПроектId, previewKey]);
  const selectedModels = aiModels[aiProvider] ?? [];

  async function loadПроектs(preferredId = activeПроектId) {
    setПроектsLoading(true);
    try {
      const response = await nexumRuntime.network.fetch("/api/projects");
      if (!response.ok) throw new Error(`Проекты API: HTTP ${response.status}`);
      const data = (await response.json()) as { projects?: Проект[] };
      const nextПроектs = data.projects ?? [];
      const preferred = nextПроектs.find((project) => project.id === preferredId && project.status === "active");
      const fallback = nextПроектs.find((project) => project.id === "nexum" && project.status === "active")
        ?? nextПроектs.find((project) => project.status === "active");
      setПроектs(nextПроектs);
      const nextActiveId = preferred?.id ?? fallback?.id ?? "nexum";
      setActiveПроектId(nextActiveId);
      setApiError("");
      const pathSegments = window.location.pathname.split("/").filter(Boolean);
      const requestedProjectId = pathSegments[0] === "projects" && pathSegments[1] ? decodeURIComponent(pathSegments[1]) : null;
      if (requestedProjectId && !preferred && nextActiveId && requestedProjectId !== nextActiveId) {
        window.history.replaceState({ view: "project", projectId: nextActiveId }, "", "/projects/" + encodeURIComponent(nextActiveId));
      }
    } catch (error) {
      console.error("[Nexum] API projects request failed:", error);
      setApiError(error instanceof Error ? error.message : "Не удалось связаться с API");
    } finally {
      setПроектsLoading(false);
    }
  }

  useEffect(() => {
    const segments = window.location.pathname.split("/").filter(Boolean);
    const preferred = segments[0] === "projects" && segments[1] ? decodeURIComponent(segments[1]) : "nexum";
    void loadПроектs(preferred);
  }, []);
  useEffect(() => {
    let cancelled = false;
    async function restoreActiveAgentJob() {
      try {
        const response = await nexumRuntime.network.fetch("/api/chat/jobs");
        if (!response.ok || cancelled) return;
        const data = await response.json() as { jobs?: Array<{ id: string; projectId?: string; status?: string; stage?: string; currentMessage?: string }> };
        const job = (data.jobs ?? []).find((item) => (item.status === "queued" || item.status === "running") && (!item.projectId || item.projectId === activeПроектId));
        if (!job || cancelled || chatJobIdRef.current !== null) return;
        setAuthoritativeChatJobId(job.id);
        setBuilderStarted(true);
        setRightTab("agent");
        setWorkspaceMode("agent");
        setMobileToolOpen(true);
        setАгентStage((job.stage as typeof agentStage) ?? "running");
        setCurrentActivity(job.currentMessage ?? "Восстанавливаю активную Agent задачу после перезагрузки.");
      } catch {
        // Reload recovery is best-effort; backend Job remains the source of truth.
      }
    }
    void restoreActiveAgentJob();
    return () => { cancelled = true; };
  }, [activeПроектId]);

  useEffect(() => {
    async function loadAIConfig() {
      try {
        const [providersResponse, modelsResponse] = await Promise.all([
          nexumRuntime.network.fetch("/api/ai/providers"),
          nexumRuntime.network.fetch("/api/ai/models"),
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
        setApiError(error instanceof Error ? error.message : "Конфигурация ИИ недоступна");
      }
    }
    void loadAIConfig();
  }, []);

  useEffect(() => {
    if (!aiProvider) return;
    let cancelled = false;
    async function refreshAIStatus() {
      try {
        const response = await nexumRuntime.network.fetch(`/api/ai/status?provider=${encodeURIComponent(aiProvider)}&model=${encodeURIComponent(aiModel)}`);
        const data = response.ok ? (await response.json()) as { status?: AIProviderStatus } : null;
        if (!cancelled) setAIStatus(data?.status ?? { provider: aiProvider, available: false, model: aiModel, latencyMs: null, error: "ИИ status unavailable" });
      } catch {
        if (!cancelled) setAIStatus({ provider: aiProvider, available: false, model: aiModel, latencyMs: null, error: "Cannot reach ИИ status endpoint" });
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

  function openПроект(projectId: string, workspaceTab: "preview" | "files" | "agent" | "code" = "preview") {
    const project = projects.find((item) => item.id === projectId);
    if (project) {
      setActiveПроектId(projectId);
      setRunningProjectIds((items) => items.includes(projectId) ? items : [...items, projectId]);
      setProjectWindowMinimizedByProject((items) => ({ ...items, [projectId]: false }));
      setReply("");
      setАгентStage(null);
      const mode = projectWindowModes[projectId] ?? (workspaceTab === "files" ? "files" : workspaceTab);
      setCodeMode(mode === "code");
      setRightTab(mode === "code" ? "files" : mode);
      setMobileToolOpen(mode !== "code");
      setWorkspaceMode(mode);
      if (!projectWindowModes[projectId]) setProjectWindowModes((items) => ({ ...items, [projectId]: mode }));
      setViewState("project");
      setProjectWindowMinimizedByProject((items) => ({ ...items, [projectId]: false }));
      navigate("project", projectId);
    }
    void selectПроект(projectId);
  }

  function setProjectMode(mode: "preview" | "agent" | "files" | "code") {
    setWorkspaceMode(mode);
    setProjectWindowModes((items) => ({ ...items, [activeПроектId]: mode }));
    if (mode !== "code") setCodeMode(false);
    if (mode === "preview" || mode === "agent" || mode === "files") { setRightTab(mode); setMobileToolOpen(true); }
  }

  async function selectПроект(projectId: string): Promise<boolean> {
    setПроектActionLoading(true);
    try {
      const response = await nexumRuntime.network.fetch(`/api/projects/${projectId}/select`, { method: "POST" });
      if (!response.ok) throw new Error(`API выбора проекта: HTTP ${response.status}`);
      setAuthoritativeChatJobId(null);
      setАгентStage(null);
      setActiveПроектId(projectId);
      setReply("");
      await loadПроектs(projectId);
      return true;
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Не удалось выбрать проект");
      return false;
    } finally {
      setПроектActionLoading(false);
    }
  }

  async function createПроект(data: { name: string; description: string; type: string }) {
    if (!data.name.trim()) return;
    setProjectCreationError("");
    setПроектActionLoading(true);
    try {
      const response = await nexumRuntime.network.fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: data.name.trim(), description: data.description, type: data.type }),
      });
      if (!response.ok) throw new Error(`API создания проекта: HTTP ${response.status}`);
      const responseData = (await response.json()) as { project: Проект };
      const selected = await selectПроект(responseData.project.id);
      if (!selected) throw new Error("Проект создан, но рабочее пространство не удалось открыть.");
      setViewState("project");
      setRightTab("agent");
      setMobileToolOpen(true);
      setWorkspaceMode("agent");
      setCodeMode(false);
      setProjectWindowMinimizedByProject((items) => ({ ...items, [responseData.project.id]: false }));
      navigate("project", responseData.project.id);
      const buildBrief = [
        `Создай новый проект типа «${responseData.project.type ?? data.type}».`,
        data.description.trim()
          ? `Задача пользователя: ${data.description.trim()}`
          : `Начни с полноценной реализации проекта типа «${responseData.project.type ?? data.type}» и выбери подходящую структуру приложения.`,
        "Тип проекта — обязательное требование: реализуй именно этот тип продукта, а не обычный лендинг.",
        "Не ограничивайся созданием названия или стартового шаблона: создай рабочую структуру, интерфейс, страницы, компоненты и необходимые сценарии для выбранного типа.",
      ].join("\n");
      setMessage("");
      setNewПроектName("");
      setModalOpen(false);
      setProjectCreationError("");
      setRunningProjectIds((items) => items.includes(responseData.project.id) ? items : [...items, responseData.project.id]);
      void sendMessage(buildBrief, responseData.project.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось создать проект";
      setProjectCreationError(message);
      setApiError(message);
    } finally {
      setПроектActionLoading(false);
    }
  }

  function repairLastTask() {
    const task = lastMessage.trim();
    if (!task) {
      setRightTab("preview");
      setMobileToolOpen(true);
      setWorkspaceMode("preview");
      return;
    }
    const repairTask = `Исправь результат последней задачи. Проверь Preview, найди ошибки и внеси необходимые исправления: ${task}`;
    setMessage(repairTask);
    setRightTab("agent");
    setProjectMode("agent");
    setMobileToolOpen(true);
    setWorkspaceMode("agent");
    window.setTimeout(() => void sendMessage(repairTask), 0);
  }

  async function cancelAgent() {
    const jobId = chatJobId;
    if (!jobId) return;
    try {
      const response = await nexumRuntime.network.fetch(`/api/chat/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
      const data = await response.json().catch(() => ({})) as { success?: boolean; job?: { status?: string; error?: string } };
      if (!response.ok || !data.success) throw new Error(data.job?.error || `Cancel API: HTTP ${response.status}`);
      setАгентStage("error");
      setCurrentActivity("Agent отменён пользователем.");
      setProjectTaskMeta((items) => ({ ...items, [activeПроектId]: { ...(items[activeПроектId] ?? { task: lastMessage || "Последняя задача", timestamp: Date.now() }), status: "cancelled" } }));
      clearAuthoritativeChatJobIfOwned(jobId);
      pushOSEvent("info", "Agent cancelled", "Выполнение задачи остановлено пользователем.");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Не удалось отменить Agent");
    }
  }

  async function sendMessage(task = message, projectIdOverride?: string) {
    const targetПроектId = projectIdOverride ?? activeПроектId;
    if (!task.trim() || !targetПроектId) return;
    setLastMessage(task);
    setProjectTaskMeta((items) => ({ ...items, [targetПроектId]: { task: task.trim(), timestamp: Date.now(), status: "queued" } }));
    setBuilderStarted(true);
    setRightTab("agent");
    setWorkspaceMode("agent");
    setАгентStage("thinking");
    setReply("");
    setApiError("");
    setActivitySteps([]);
    setActivityEvents([]);
    setCurrentActivity("Отправляю задачу ИИ-агенту…");
    pushOSEvent("info", "Agent started", `Запущена задача: ${task.trim().slice(0, 90)}`);
    setProblems([]);
    setProductPlan(null);

    try {
      const serializedAttachments = await serializeAttachments(pendingAttachments.map((item) => item.file));
      setConversation((items) => [...items, { id: `user-${Date.now()}`, role: "user", content: task.trim(), timestamp: Date.now(), attachments: serializedAttachments.map((item) => item.name) }]);
      setPendingAttachments([]);
      const chatContext = conversation
        .slice(-8)
        .map((item) => ({ role: item.role, content: item.content.slice(0, 900) }))
        .filter((item) => item.content.trim());
      const e2eCancellationCheckpoint =
        import.meta.env.VITE_E2E === "true" &&
        (window as unknown as { __NEXUM_E2E_CANCELLATION_CHECKPOINT__?: boolean }).__NEXUM_E2E_CANCELLATION_CHECKPOINT__ === true;
      const response = await nexumRuntime.network.fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(e2eCancellationCheckpoint ? { "x-nexum-e2e-planner-checkpoint": "1" } : {}),
        },
        body: JSON.stringify({
          message: task,
          projectId: targetПроектId,
          provider: aiProvider,
          model: aiModel,
          attachments: serializedAttachments,
          conversation: chatContext,
        }),
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
      if (!data.jobId) throw new Error(data.error || "API чата не вернул идентификатор задачи");

      setAuthoritativeChatJobId(data.jobId);
      if (import.meta.env.VITE_E2E === "true") {
        const testWindow = window as unknown as { __NEXUM_E2E_LAST_JOB_ID__?: string; __NEXUM_E2E_RUNTIME_TASK_ID__?: string };
        testWindow.__NEXUM_E2E_LAST_JOB_ID__ = data.jobId;
        testWindow.__NEXUM_E2E_RUNTIME_TASK_ID__ = (data as { runtimeTaskId?: string }).runtimeTaskId;
      }
      setProjectTaskMeta((items) => ({ ...items, [targetПроектId]: { ...(items[targetПроектId] ?? { task: task.trim(), timestamp: Date.now() }), status: "running" } }));
    } catch (error) {
      console.error("[Nexum] Chat job creation failed:", error);
      setApiError(error instanceof Error ? error.message : "Не удалось отправить запрос к чату");
      setАгентStage(null);
    }
  }

  useEffect(() => {
    if (!chatJobId) return;

    let cancelled = false;
    let timer: number | undefined;
    const activeJobId = chatJobId;

    async function pollJob() {
      try {
        const response = await nexumRuntime.network.fetch(`/api/chat/jobs/${encodeURIComponent(activeJobId)}`);
        const data = response.ok
          ? await response.json() as {
              success?: boolean;
              job?: {
                status?: "queued" | "running" | "completed" | "failed" | "cancelled";
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

        if (cancelled || chatJobIdRef.current !== activeJobId) return;

        if (!response.ok) {
          throw new Error(data?.error || `Chat job API: HTTP ${response.status}`);
        }

        const status = data?.job?.status;
        if (status === "completed") {
          setProjectTaskMeta((items) => ({ ...items, [activeПроектId]: { ...(items[activeПроектId] ?? { task: lastMessage || "Последняя задача", timestamp: Date.now() }), status: "completed" } }));
          setActivitySteps(data?.job?.steps ?? []);
          setActivityEvents(data?.job?.events ?? []);
          setCurrentActivity(data?.job?.currentMessage ?? "Готово.");
          pushOSEvent("success", "Build completed", "Agent завершил задачу. Preview готовится.");
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
          setMobileToolOpen(true);
          setProjectMode("preview");

          // The agent can finish immediately after the build while the filesystem
          // and preview status endpoint are still settling. Wait briefly for the
          // production bundle, then force a cache-busted iframe reload.
          let previewReady = false;
          for (let attempt = 0; attempt < 12; attempt += 1) {
            try {
              const previewResponse = await nexumRuntime.network.fetch(
                `/api/projects/${encodeURIComponent(activeПроектId)}/preview/status?ts=${Date.now()}`,
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

          setПредпросмотрOnline(previewReady);
          setПредпросмотрKey((key) => key + 1);
          setАгентStage("completed");
          clearAuthoritativeChatJobIfOwned(activeJobId);
              return;
        }

        if (status === "cancelled") {
          setProjectTaskMeta((items) => ({ ...items, [activeПроектId]: { ...(items[activeПроектId] ?? { task: lastMessage || "Последняя задача", timestamp: Date.now() }), status: "cancelled" } }));
          setCurrentActivity(data?.job?.error ?? "Agent отменён.");
          setАгентStage("error");
          clearAuthoritativeChatJobIfOwned(activeJobId);
            return;
        }

        if (status === "failed") {
          setProjectTaskMeta((items) => ({ ...items, [activeПроектId]: { ...(items[activeПроектId] ?? { task: lastMessage || "Последняя задача", timestamp: Date.now() }), status: "failed" } }));
          throw new Error(data?.job?.error || "ИИ-агент завершил работу с ошибкой");
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
        setАгентStage((data?.job?.stage as typeof agentStage) ?? (status === "running" ? "running" : "thinking"));
        timer = window.setTimeout(pollJob, 900);
      } catch (error) {
        if (cancelled) return;
        console.error("[Nexum] Chat job polling failed:", error);
        setApiError(error instanceof Error ? error.message : "Ошибка получения статуса задачи чата");
        setАгентStage("error");
        pushOSEvent("error", "Agent error", error instanceof Error ? error.message : "Не удалось получить статус задачи");
        clearAuthoritativeChatJobIfOwned(activeJobId);
      }
    }

    void pollJob();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [chatJobId]);

  async function connectAIKey() {
    if (!aiApiKey.trim()) return;
    setAiApiKeyLoading(true);
    setApiError("");
    try {
      const response = await nexumRuntime.network.fetch("/api/ai/connect-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: aiApiKey.trim() }),
      });
      const data = await response.json().catch(() => ({})) as { success?: boolean; provider?: string; model?: string; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "Не удалось проверить API-ключ");
      const provider = data.provider || "openai";
      setAiApiKey("");
      setAIProvider(provider);
      setAIModel(data.model || aiModels[provider]?.[0] || (provider === "openai" ? "gpt-5" : provider === "orcarouter" ? "deepseek/deepseek-v4-flash-free" : "openrouter/free"));
      setNotice(provider === "openai" ? "OpenAI подключён — модели GPT готовы" : "OpenRouter подключён");
      window.setTimeout(() => setNotice(""), 3200);
      const modelsResponse = await nexumRuntime.network.fetch("/api/ai/models");
      if (modelsResponse.ok) {
        const modelsData = await modelsResponse.json() as { models?: Record<string, string[]> };
        setAIModels(modelsData.models ?? {});
      }
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "ИИ key setup failed");
    } finally {
      setAiApiKeyLoading(false);
    }
  }

  async function saveLocalAIKey() {
    if (!localAIKey.trim()) return;
    setLocalAIKeyLoading(true);
    setApiError("");
    try {
      const response = await nexumRuntime.network.fetch("/api/ai/local-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: localAIKey.trim() }),
      });
      const data = await response.json().catch(() => ({})) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "Не удалось проверить ключ OpenRouter");
      setLocalAIConfigured(true);
      setLocalAIKey("");
      setAIProvider("openrouter");
      setAIModel("openrouter/free");
      setNotice("OpenRouter подключён for this local test session");
      window.setTimeout(() => setNotice(""), 3200);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Не удалось подключить ключ OpenRouter");
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

  function openПроектPicker() {
    navigate("home");
    setNotice("Выберите проект из списка");
    window.setTimeout(() => setNotice(""), 3200);
  }

  const runTask = (task: string) => void sendMessage(task);
  const paletteActions = [
    { label: "New Проект", hint: "N", run: () => setModalOpen(true) },
    { label: "Open Проект", hint: "O", run: openПроектPicker },
    { label: "Поиск файлов", hint: "S", run: () => focusTask("Найди ") },
    { label: "Open Агент Activity", hint: "A", run: () => { if (!activeПроектId) return; setProjectMode("agent"); } },
    { label: "Запустить тесты", hint: "T", run: () => runTask("Запусти тесты в изолированной среде") },
    { label: "Запустить сборку", hint: "B", run: () => runTask("Проверь сборку проекта") },
    { label: "Статус Git", hint: "G", run: () => runTask("Покажи статус Git") },
    { label: "Изменения Git", hint: "D", run: () => runTask("Что изменилось?") },
    { label: "Открыть предпросмотр", hint: "P", run: () => { if (!activeПроектId) return; setProjectMode("preview"); setПредпросмотрKey((key) => key + 1); setNotice("Предпросмотр обновлён"); } },
    { label: "Перезапустить предпросмотр", hint: "R", run: () => { if (!activeПроектId) return; setProjectMode("preview"); setПредпросмотрKey((key) => key + 1); setNotice("Предпросмотр перезапущен"); } },
    { label: "Ask ИИ", hint: "A", run: () => focusTask() },
    { label: "Сменить модель", hint: "M", run: () => document.querySelector<HTMLButtonElement>(".composer-model-button")?.click() },
    { label: "Диагностика Agent", hint: "D", run: () => setView("diagnostics") },
    { label: "Настройки", hint: "", run: () => setView("settings") },
  ];

  function ConnectorModal() {
    const connected = connectorModal ? connectedConnectors.includes(connectorModal) : false;
    useEffect(() => {
      if (!connectorModal) return;
      const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setConnectorModal(null); };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [connectorModal]);
    if (!connectorModal) return null;
    return <div className="modal-backdrop connector-backdrop" onMouseDown={() => setConnectorModal(null)}>
      <section className="connector-modal" role="dialog" aria-modal="true" aria-labelledby="connector-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-top"><div><span className="eyebrow">ИНТЕГРАЦИЯ</span><h2 id="connector-modal-title">{connectorModal}</h2></div><button type="button" aria-label="Закрыть" onClick={() => setConnectorModal(null)}>×</button></div>
        <p>{connected ? "Эта интеграция включена в интерфейсе рабочего пространства. OAuth/API-данные провайдера пока не сохраняются." : "Включить интеграцию для текущего рабочего пространства. OAuth/API-данные провайдера пока не сохраняются."}</p>
        <div className="connector-modal-actions"><button type="button" onClick={() => setConnectorModal(null)}>Отмена</button><button className="home-primary" type="button" onClick={() => { setConnectedConnectors((items) => connected ? items.filter((item) => item !== connectorModal) : [...items, connectorModal]); setConnectorModal(null); setNotice(connectorModal + (connected ? " интеграция отключена" : " интеграция подключена")); }}>{connected ? "Отключить" : "Продолжить"}</button></div>
      </section>
    </div>;
  }

  if (!onboardingComplete || welcomeTestMode) {
    return <NexumWelcome onComplete={() => { setOnboardingComplete(true); setWelcomeTestMode(false); }} />;
  }

  return (
    <div className={"app app-" + view}>
      <NexumOSEventCenter events={osEvents} onDismiss={(id) => setOsEvents((items) => items.filter((item) => item.id !== id))} />
      <NexumApplicationManager
        projectName={activeПроект?.name}
        projects={runningProjectIds.map((id) => ({ id, name: projects.find((p) => p.id === id)?.name ?? id, active: id === activeПроектId && view === "project", minimized: Boolean(projectWindowMinimizedByProject[id]) }))}
        projectModes={projectWindowModes}
        onSelectProject={(id) => openПроект(id, projectWindowModes[id] ?? "agent")}
        mode={workspaceMode}
        running={view === "project" && runningProjectIds.includes(activeПроектId)}
        minimized={projectWindowMinimized}
        onSelectMode={setProjectMode}
        onMinimize={() => { setProjectWindowMinimizedByProject((items) => ({ ...items, [activeПроектId]: true })); }}
        onRestore={() => { setProjectWindowMinimizedByProject((items) => ({ ...items, [activeПроектId]: false })); }}
        onClose={() => { setProjectWindowMinimizedByProject((items) => ({ ...items, [activeПроектId]: false })); setRunningProjectIds((items) => items.filter((id) => id !== activeПроектId)); navigate("home"); }}
      />
      <main className={`main nexum-os-runtime ${osBooted ? "os-booted" : "os-booting"}`}>
        {view !== "home" && <OSSystemChrome
          appName={view === "project" ? (activeПроект?.name ?? "NEXUM") : view === "connectors" ? "Интеграции" : view === "settings" ? "Настройки" : view === "news" ? "Журнал NEXUM" : "Диагностика"}
          appIcon={view === "project" ? (activeПроект?.name?.slice(0, 1).toUpperCase() ?? "N") : view === "connectors" ? "◇" : view === "settings" ? "⚙" : view === "news" ? "✦" : "⌁"}
          status={aiStatus?.available ? "AI Core подключён" : "Система готова"}
          activeView={view}
          onHome={() => navigate("home")}
          onSearch={() => setPaletteOpen(true)}
          onSettings={() => navigate("settings")}
          onNewProject={() => setModalOpen(true)}
        />}
        {view === "diagnostics" ? (
          <OSAppWindow title="Диагностика" subtitle="Системное состояние и события" icon="⌁" status="Система готова" onClose={() => navigate("home")} onMinimize={() => navigate("home")}>
            <DiagnosticsPage />
          </OSAppWindow>
        ) : view === "home" ? (
          osEnabled ? <OSDesktop
            projects={projects}
            onNewProject={() => setModalOpen(true)}
            onOpenProject={(id, tab) => openПроект(id, tab)}
            onOpenView={(next) => setView(next)}
            osEnabled={osEnabled}
            onToggleOS={() => setOsEnabled((enabled) => !enabled)}
            onLaunchWelcome={() => setWelcomeTestMode(true)}
            runningProjectIds={runningProjectIds}
            minimizedProjectIds={minimizedProjectIds}
            onRestoreProject={(id) => openПроект(id, projectWindowModes[id] ?? "agent")}
          /> : (
            <section className="nexum-os-disabled" aria-label="NEXUM OS disabled">
              <div className="nexum-os-disabled-card">
                <span className="nexum-os-disabled-mark">N</span>
                <span className="eyebrow">NEXUM OS</span>
                <h1>OS is off.</h1>
                <p>Рабочий стол NEXUM OS временно выключен для тестирования обычного режима приложения.</p>
                <button type="button" className="home-primary" onClick={() => setOsEnabled(true)}>Включить NEXUM OS</button>
              </div>
            </section>
          )
        ) : view === "news" ? (
          <OSAppWindow title="Журнал NEXUM" subtitle="Новости и системные обновления" icon="✦" status="Актуально" onClose={() => navigate("home")} onMinimize={() => navigate("home")}>
            <NewsPage />
          </OSAppWindow>
        ) : view === "connectors" ? (
          <OSAppWindow title="Интеграции" subtitle="Подключения и AI engines" icon="◇" status="Готово" onClose={() => navigate("home")} onMinimize={() => navigate("home")}>
            <IntegrationPage
              connectedConnectors={connectedConnectors}
              onToggleConnector={(name) => {
                setConnectorModal(name);
              }}
            />
          </OSAppWindow>
        ) : view === "settings" ? (
          <OSAppWindow title="Настройки" subtitle="Система, AI Engine и рабочее пространство" icon="⚙" status="Готово" onClose={() => navigate("home")} onMinimize={() => navigate("home")}>
          <section className="settings-page settings-page-v2">
            <div className="settings-hero">
              <div>
                <div className="eyebrow">NEXUM.DEV / SETTINGS</div>
                <h1>Настройки</h1>
                <p>Единый центр управления интерфейсом, AI Engine, проектами и рабочим процессом.</p>
              </div>
              <div className="settings-hero-status"><i />Система готова</div>
            </div>

            <div className="settings-layout">
              <aside className="settings-index">
                <span>РАЗДЕЛЫ</span>
                <a href="#settings-interface">Интерфейс</a>
                <a href="#settings-ai">AI Engine</a>
                <a href="#settings-projects">Проекты</a>
                <a href="#settings-notifications">Уведомления</a>
                <a href="#settings-shortcuts">Горячие клавиши</a>
                <a href="#settings-storage">Хранилище</a>
              </aside>

              <div className="settings-content">
                <section id="settings-interface" className="settings-section">
                  <div className="settings-section-head">
                    <span>01</span>
                    <div><h2>Интерфейс</h2><p>Масштаб, плотность и движение интерфейса.</p></div>
                  </div>
                  <div className="settings-card settings-card-wide">
                    <strong>Масштаб интерфейса</strong>
                    <span>{uiSettings.scale}% · оптимизировано для HiDPI</span>
                    <small>100% — базовый режим. 110% увеличивает читаемость на плотных экранах.</small>
                    <div className="settings-scale-group">
                      {[90, 100, 110].map((scale) => (
                        <button key={scale} type="button" className={uiSettings.scale === scale ? "selected" : ""} onClick={() => setUiSettings((state) => ({ ...state, scale }))}>{scale}%</button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-grid settings-grid-secondary">
                    <div className="settings-card">
                      <strong>Плотность</strong>
                      <span>{uiSettings.compact ? "Компактный" : "Комфортный"}</span>
                      <small>Определяет расстояния и размер служебных элементов.</small>
                      <div className="settings-option-row">
                        <div className="settings-option-copy"><b>Компактный режим</b><span>Больше информации на экране</span></div>
                        <button type="button" aria-label="Toggle compact mode" className={`nexum-toggle ${uiSettings.compact ? "on" : ""}`} onClick={() => setUiSettings((state) => ({ ...state, compact: !state.compact }))} />
                      </div>
                    </div>
                    <div className="settings-card">
                      <strong>Движение</strong>
                      <span>{uiSettings.animations ? "Плавные переходы" : "Минимум движения"}</span>
                      <small>Только функциональная анимация без постоянного декоративного свечения.</small>
                      <div className="settings-option-row">
                        <div className="settings-option-copy"><b>Анимации</b><span>120–220 ms</span></div>
                        <button type="button" aria-label="Toggle animations" className={`nexum-toggle ${uiSettings.animations ? "on" : ""}`} onClick={() => setUiSettings((state) => ({ ...state, animations: !state.animations }))} />
                      </div>
                    </div>
                  </div>
                </section>

                <section id="settings-ai" className="settings-section">
                  <div className="settings-section-head">
                    <span>02</span>
                    <div><h2>AI Engine</h2><p>Провайдер, модель и ключи доступа.</p></div>
                  </div>
                  <div className="settings-grid">
                    <div className="settings-card"><strong>Активная модель</strong><span>{aiProvider} · {aiModel}</span><small>Текущий маршрут AI Agent.</small></div>
                    <div className="settings-card"><strong>Статус</strong><span className={aiStatus?.available ? "settings-status-ok" : "settings-status-muted"}>{aiStatus?.available ? "Подключено" : "Ожидание подключения"}</span><small>{aiStatus?.error || "NEXUM проверяет доступность выбранной модели."}</small></div>
                  </div>
                </section>

                <section id="settings-projects" className="settings-section">
                  <div className="settings-section-head">
                    <span>03</span>
                    <div><h2>Проекты</h2><p>Поведение Builder и Preview.</p></div>
                  </div>
                  <div className="settings-grid">
                    <div className="settings-card">
                      <strong>Предпросмотр</strong>
                      <span>{uiSettings.autoПредпросмотр ? "Автообновление" : "Ручное обновление"}</span>
                      <small>Обновлять Preview после успешной работы Agent.</small>
                      <div className="settings-option-row">
                        <div className="settings-option-copy"><b>Автопредпросмотр</b><span>Обновлять после сборки</span></div>
                        <button type="button" aria-label="Toggle auto preview" className={`nexum-toggle ${uiSettings.autoПредпросмотр ? "on" : ""}`} onClick={() => setUiSettings((state) => ({ ...state, autoПредпросмотр: !state.autoПредпросмотр }))} />
                      </div>
                    </div>
                    <div className="settings-card"><strong>Активные проекты</strong><span>{projects.filter((project) => project.status === "active").length} проектов</span><small>Каждый проект хранит собственные файлы, Preview и контекст.</small></div>
                  </div>
                </section>

                <section id="settings-notifications" className="settings-section">
                  <div className="settings-section-head"><span>04</span><div><h2>Уведомления</h2><p>Только полезные сигналы от Agent.</p></div></div>
                  <div className="settings-card settings-card-wide">
                    <strong>Звук завершения</strong><span>{uiSettings.sound ? "Включён" : "Выключен"}</span><small>Сигнал при завершении или ошибке Agent.</small>
                    <div className="settings-option-row">
                      <div className="settings-option-copy"><b>Уведомлять звуком</b><span>Без визуального шума</span></div>
                      <button type="button" aria-label="Toggle completion sound" className={`nexum-toggle ${uiSettings.sound ? "on" : ""}`} onClick={() => setUiSettings((state) => ({ ...state, sound: !state.sound }))} />
                    </div>
                  </div>
                </section>

                <section id="settings-shortcuts" className="settings-section">
                  <div className="settings-section-head"><span>05</span><div><h2>Горячие клавиши</h2><p>Быстрый доступ к рабочему пространству.</p></div></div>
                  <div className="settings-card settings-card-wide settings-shortcuts">
                    <div><strong>Command Palette</strong><small>Открыть палитру команд</small></div>
                    <kbd>⌘ K</kbd>
                    <div><strong>Навигация</strong><small>Ctrl / Command + K поддерживается</small></div>
                  </div>
                </section>

                <section id="settings-storage" className="settings-section">
                  <div className="settings-section-head"><span>06</span><div><h2>Хранилище</h2><p>Данные проектов и локальные настройки.</p></div></div>
                  <div className="settings-card settings-card-wide">
                    <strong>Локальное состояние</strong><span>{projects.length} проектов загружено</span>
                    <small>Настройки интерфейса и история чатов сохраняются локально. Секретные ключи не встраиваются в клиентский bundle.</small>
                  </div>
                </section>

                <section className="settings-section">
                  <div className="settings-section-head"><span>07</span><div><h2>API access</h2><p>Подключение внешней AI-модели.</p></div></div>
                  <div className="settings-card settings-card-wide">
                    <strong>ИИ API key</strong><span>Автоматическое определение провайдера</span>
                    <small>Вставьте ключ OpenAI, OpenRouter или OrcaRouter. NEXUM проверит его и сохранит только в памяти текущего сервера.</small>
                    <div className="settings-api-row">
                      <input type="password" value={aiApiKey} onChange={(event) => setAiApiKey(event.target.value)} placeholder="Вставьте API-ключ" autoComplete="off" />
                      <button type="button" className="home-primary" disabled={aiApiKeyLoading || !aiApiKey.trim()} onClick={() => void connectAIKey()}>{aiApiKeyLoading ? "Проверяю…" : "Подключить ИИ"}</button>
                    </div>
                  </div>
                  {localAITestEnabled && (
                    <div className="settings-card settings-card-wide">
                      <strong>Тестовая сессия OpenRouter</strong><span>{localAIConfigured ? "Подключено" : "Не подключено"}</span>
                      <small>Временный ключ сессии для тестирования моделей без хранения учётных данных в репозитории.</small>
                      <div className="settings-api-row">
                        <input type="password" value={localAIKey} onChange={(event) => setLocalAIKey(event.target.value)} placeholder="sk-or-v1-…" autoComplete="off" />
                        <button type="button" className="home-primary" disabled={localAIKeyLoading || !localAIKey.trim()} onClick={() => void saveLocalAIKey()}>{localAIKeyLoading ? "Проверяю…" : "Подключить"}</button>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            </div>
          </section>
          </OSAppWindow>
        ) : (
        <OSProjectWindow
          projectName={activeПроект?.name ?? "NEXUM"}
          workspaceMode={workspaceMode}
          previewOnline={previewOnline}
          agentStage={agentStage}
          activeTab={rightTab}
            onTabChange={(tab) => { setCodeMode(false); setRightTab(tab); setMobileToolOpen(true); setProjectMode(tab); }}
          onClose={() => {
            setProjectWindowMinimizedByProject((items) => { const next = { ...items }; delete next[activeПроектId]; return next; });
            setRunningProjectIds((items) => items.filter((id) => id !== activeПроектId));
            navigate("home");
          }}
          minimized={projectWindowMinimized}
          onMinimize={() => { setProjectWindowMinimizedByProject((items) => ({ ...items, [activeПроектId]: true })); }}
          onRestore={() => {
            setProjectWindowMinimizedByProject((items) => ({ ...items, [activeПроектId]: false }));
            setRunningProjectIds((items) => items.includes(activeПроектId) ? items : [...items, activeПроектId]);
          }}
          onConnect={() => setConnectorModal("Интеграция проекта")}
          onShare={async () => {
            const url = window.location.origin + "/api/preview/" + activeПроектId + "/index.html";
            try { await navigator.clipboard.writeText(url); setNotice("Ссылка на предпросмотр скопирована"); } catch { setNotice(url); }
          }}
          onOpenPreview={() => {
            const url = "/api/preview/" + activeПроектId + "/index.html";
            window.open(url, "_blank", "noopener,noreferrer");
            setNotice("Предпросмотр открыт в новой вкладке");
          }}
          onCode={() => { setCodeMode(true); setProjectMode("code"); }}
          onAgent={() => { setCodeMode(false); setRightTab("agent"); setMobileToolOpen(true); setProjectMode("agent"); }}
          onFiles={() => { setCodeMode(false); setRightTab("files"); setMobileToolOpen(true); setProjectMode("files"); }}
        >
        <div className={`os-workspace-stage ${codeMode ? "is-code" : "is-builder"}`}>
          <div className="os-workspace-layer" aria-hidden={codeMode}>
            <div className={`workspace ${builderStarted ? "builder-started" : "builder-idle"}${mobileToolOpen ? " mobile-tool-open" : " mobile-chat-open"}`}>
              <div className="main-column">
                <ChatPanel projectName={activeПроект?.name ?? "NEXUM"} providers={aiProviders} models={selectedModels} provider={aiProvider} model={aiModel} aiStatus={aiStatus} message={message} reply={reply} stage={agentStage} apiError={apiError} jobId={chatJobId} messages={conversation} attachments={pendingAttachments} onMessageChange={setMessage} onSubmit={() => void sendMessage()} onCancel={() => void cancelAgent()} onRetry={() => void sendMessage(lastMessage)} onQuickTask={runTask} onFilesSelected={(files) => setPendingAttachments((items) => [...items, ...files.map((file) => ({ id: `${file.name}-${file.size}-${file.lastModified}`, name: file.name, type: file.type, size: file.size, file }))].slice(-5))} onRemoveAttachment={(id) => setPendingAttachments((items) => items.filter((item) => item.id !== id))} onOpenAgent={() => { setRightTab("agent"); setMobileToolOpen(true); setWorkspaceMode("agent"); }} onProviderChange={selectAIProvider} onModelChange={setAIModel} />
              </div>
              <RightPanel tab={rightTab} onTabChange={(tab) => { setRightTab(tab); setMobileToolOpen(true); setWorkspaceMode(tab); }} onOpenChat={() => setMobileToolOpen(false)} projectName={activeПроект?.name ?? "NEXUM"} projectId={activeПроектId} previewOnline={previewOnline} previewKey={previewKey} onRefreshPreview={() => setПредпросмотрKey((key) => key + 1)} jobId={chatJobId} stage={agentStage} activitySteps={activitySteps} activityEvents={activityEvents} currentActivity={currentActivity} problems={problems} productPlan={productPlan} onRepair={repairLastTask} />
            </div>
          </div>
          <div className="os-workspace-layer os-workspace-code" aria-hidden={!codeMode}>
            <CodePanel projectId={activeПроектId} projectName={activeПроект?.name ?? "NEXUM"} previewOnline={previewOnline} onRefreshPreview={() => setПредпросмотрKey((key) => key + 1)} onClose={() => { setCodeMode(false); setProjectMode("files"); }} />
          </div>
        </div>
        </OSProjectWindow>
        )}
      </main>
      <CommandPalette key={paletteOpen ? "open" : "closed"} open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} />
      <NewProjectModal open={modalOpen} name={newПроектName} loading={projectActionLoading} error={projectCreationError} onNameChange={setNewПроектName} onClose={() => { setProjectCreationError(""); setModalOpen(false); }} onSubmit={(data) => void createПроект(data)} />
      {connectorModal && <ConnectorModal />}
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}

export default App;