import "./App.css";
import { useEffect, useRef, useState } from "react";
import { ChatPanel } from "./components/ChatPanel";
import { CommandPalette } from "./components/CommandPalette";
import { NewProjectModal } from "./components/NewProjectModal";
import { QuickActions } from "./components/QuickActions";
import { RightPanel } from "./components/RightPanel";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import type { AIProviderInfo, AIProviderStatus, AgentStage, Project } from "./components/types";
// UI controls persist locally; server-side credentials remain outside the client bundle.

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
  const [view, setViewState] = useState<"home" | "project" | "connectors" | "settings">(() => {
    const path = window.location.pathname;
    return path.startsWith("/projects/") && path.split("/").filter(Boolean)[1] ? "project" : path === "/settings" ? "settings" : path === "/connectors" ? "connectors" : "home";
  });
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
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiApiKeyLoading, setAiApiKeyLoading] = useState(false);
  const localAITestEnabled = true;
  const [localAIConfigured, setLocalAIConfigured] = useState(false);
  const [localAIKeyLoading, setLocalAIKeyLoading] = useState(false);
  const [conversation, setConversation] = useState<Array<{ id: string; role: "user" | "assistant"; content: string; timestamp: number; attachments?: string[] }>>([]);
  const conversationProjectRef = useRef<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<Array<{ id: string; name: string; type: string; size: number; file: File }>>([]);
  const [uiSettings, setUiSettings] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("nexum:ui-settings") || "{}") as Partial<{animations:boolean; compact:boolean; autoPreview:boolean; sound:boolean; glow:boolean}>;
      return { animations: saved.animations !== false, compact: Boolean(saved.compact), autoPreview: saved.autoPreview !== false, sound: Boolean(saved.sound), glow: saved.glow !== false };
    } catch { return { animations:true, compact:false, autoPreview:true, sound:false, glow:true }; }
  });
  useEffect(() => { try { localStorage.setItem("nexum:ui-settings", JSON.stringify(uiSettings)); } catch {} }, [uiSettings]);
  useEffect(() => { document.documentElement.dataset.motion=uiSettings.animations?"on":"off"; document.documentElement.dataset.compact=uiSettings.compact?"on":"off"; document.documentElement.dataset.glow=uiSettings.glow?"on":"off"; }, [uiSettings]);

  const activeProject = projects.find((project) => project.id === activeProjectId);

  function navigate(nextView: "home" | "project" | "connectors" | "settings", projectId?: string, replace = false) {
    setViewState(nextView);
    const target = nextView === "project"
      ? "/projects/" + encodeURIComponent(projectId ?? activeProjectId)
      : nextView === "connectors" ? "/connectors"
      : nextView === "settings" ? "/settings"
      : "/projects";
    if (window.location.pathname !== target) {
      if (replace) window.history.replaceState({ view: nextView, projectId }, "", target);
      else window.history.pushState({ view: nextView, projectId }, "", target);
    }
  }

  const setView = (nextView: "home" | "project" | "connectors" | "settings") => navigate(nextView);

  useEffect(() => {
    const onPopState = () => {
      const path = window.location.pathname;
      const segments = path.split("/").filter(Boolean);
      if (segments[0] === "projects" && segments[1]) {
        setActiveProjectId(decodeURIComponent(segments[1]));
        setViewState("project");
      } else if (path === "/connectors") setViewState("connectors");
      else if (path === "/settings") setViewState("settings");
      else setViewState("home");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    conversationProjectRef.current = null;
    try {
      const saved = JSON.parse(localStorage.getItem(`nexum:conversation:${activeProjectId}`) || "[]");
      setConversation(Array.isArray(saved) ? saved.slice(-100) : []);
    } catch { setConversation([]); }
    conversationProjectRef.current = activeProjectId;
  }, [activeProjectId]);

  useEffect(() => {
    if (conversationProjectRef.current !== activeProjectId) return;
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
      if (!response.ok) throw new Error(`Проекты API: HTTP ${response.status}`);
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
      setApiError(error instanceof Error ? error.message : "Не удалось связаться с API");
    } finally {
      setProjectsLoading(false);
    }
  }

  useEffect(() => {
    const segments = window.location.pathname.split("/").filter(Boolean);
    const preferred = segments[0] === "projects" && segments[1] ? decodeURIComponent(segments[1]) : "nexum";
    void loadProjects(preferred);
  }, []);

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
        const response = await fetch(`/api/ai/status?provider=${encodeURIComponent(aiProvider)}&model=${encodeURIComponent(aiModel)}`);
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

  function openProject(projectId: string) {
    navigate("project", projectId);
    void selectProject(projectId);
  }

  async function selectProject(projectId: string) {
    setProjectActionLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/select`, { method: "POST" });
      if (!response.ok) throw new Error(`API выбора проекта: HTTP ${response.status}`);
      setChatJobId(null);
      setAgentStage(null);
      setActiveProjectId(projectId);
      setReply("");
      await loadProjects(projectId);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Не удалось выбрать проект");
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
      if (!response.ok) throw new Error(data.error || "Не удалось удалить проект");
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
      setNotice(`Project «${project.name}» удалён`);
      window.setTimeout(() => setNotice(""), 3200);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Не удалось удалить проект");
    } finally {
      setProjectActionLoading(false);
    }
  }

  async function createProject(data: { name: string; description: string; type: string }) {
    if (!data.name.trim()) return;
    setProjectActionLoading(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: data.name.trim(), description: data.description, type: data.type }),
      });
      if (!response.ok) throw new Error(`API создания проекта: HTTP ${response.status}`);
      const data = (await response.json()) as { project: Project };
      await selectProject(data.project.id);
      setView("project");
      const buildBrief = [
        `Создай новый проект типа «${data.project.type ?? data.type}».`,
        data.description.trim()
          ? `Задача пользователя: ${data.description.trim()}`
          : `Начни с полноценной реализации проекта типа «${data.project.type ?? data.type}» и выбери подходящую структуру приложения.`,
        "Тип проекта — обязательное требование: реализуй именно этот тип продукта, а не обычный лендинг.",
        "Не ограничивайся созданием названия или стартового шаблона: создай рабочую структуру, интерфейс, страницы, компоненты и необходимые сценарии для выбранного типа.",
      ].join("\n");
      setMessage(data.description.trim());
      setNewProjectName("");
      setModalOpen(false);
      void sendMessage(buildBrief, data.project.id);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Не удалось создать проект");
    } finally {
      setProjectActionLoading(false);
    }
  }

  async function sendMessage(task = message, projectIdOverride?: string) {
    const targetProjectId = projectIdOverride ?? activeProjectId;
    if (!task.trim() || !targetProjectId) return;
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
      const chatContext = conversation
        .slice(-8)
        .map((item) => ({ role: item.role, content: item.content.slice(0, 900) }))
        .filter((item) => item.content.trim());
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: task,
          projectId: targetProjectId,
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

      setChatJobId(data.jobId);
    } catch (error) {
      console.error("[Nexum] Chat job creation failed:", error);
      setApiError(error instanceof Error ? error.message : "Не удалось отправить запрос к чату");
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
        setAgentStage((data?.job?.stage as typeof agentStage) ?? (status === "running" ? "running" : "thinking"));
        timer = window.setTimeout(pollJob, 900);
      } catch (error) {
        if (cancelled) return;
        console.error("[Nexum] Chat job polling failed:", error);
        setApiError(error instanceof Error ? error.message : "Ошибка получения статуса задачи чата");
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

  async function connectAIKey() {
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
      if (!response.ok || !data.success) throw new Error(data.error || "Не удалось проверить API-ключ");
      const provider = data.provider || "openai";
      setAiApiKey("");
      setAIProvider(provider);
      setAIModel(data.model || aiModels[provider]?.[0] || (provider === "openai" ? "gpt-5" : provider === "orcarouter" ? "deepseek/deepseek-v4-flash-free" : "openrouter/free"));
      setNotice(provider === "openai" ? "OpenAI подключён — модели GPT готовы" : "OpenRouter подключён");
      window.setTimeout(() => setNotice(""), 3200);
      const modelsResponse = await fetch("/api/ai/models");
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
      const response = await fetch("/api/ai/local-test", {
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

  function openProjectPicker() {
    navigate("home");
    setMobileSidebarOpen(true);
    setNotice("Выберите проект из списка");
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
    <div className={"app app-" + view}>
      {view !== "project" && <Sidebar projects={projects} activeProjectId={activeProjectId} projectsLoading={projectsLoading} projectActionLoading={projectActionLoading} mobileOpen={mobileSidebarOpen} view={view} onDeleteProject={(id) => void deleteProject(id)} onViewChange={(next) => { setMobileSidebarOpen(false); setView(next); }} onNewProject={() => { setMobileSidebarOpen(false); setModalOpen(true); }} onSelectProject={(id) => { setMobileSidebarOpen(false); openProject(id); }} />}
      <main className="main">
        {view !== "project" && <TopBar projectName={view === "connectors" ? "Интеграции" : view === "settings" ? "Настройки" : "NEXUM.DEV"} providers={aiProviders} models={selectedModels} provider={aiProvider} model={aiModel} aiStatus={aiStatus} stage={agentStage} onProviderChange={selectAIProvider} onModelChange={setAIModel} onToggleSidebar={() => setMobileSidebarOpen((open) => !open)} />}
        {view === "home" ? (
          <section className="nexum-home">
            <div className="home-hero"><div><div className="eyebrow">NEXUM.DEV</div><h1>Создавайте, не покидая рабочее пространство.</h1><p>Создайте проект, откройте его как отдельное рабочее пространство, подключите сервисы и поручите агенту разработку.</p></div><button className="home-primary" type="button" onClick={() => setModalOpen(true)}>+ Новый проект</button></div>
            <div className="home-section-title"><span>ВАШИ ПРОЕКТЫ</span><button type="button" onClick={() => setModalOpen(true)}>Новый проект</button></div>
            <div className="project-grid">{projects.filter((project) => project.status === "active").map((project) => <button key={project.id} className="project-window" type="button" onClick={() => openProject(project.id)}><span className="window-chrome"><i/><i/><i/></span><span className="project-window-mark">{project.name.slice(0, 1)}</span><div className="project-window-head"><strong>{project.name}</strong><span className="project-type-badge">{project.type ?? "Проект"}</span></div><p className="project-window-description">{project.description || "Проект готов к разработке. Откройте рабочее пространство и задайте первую задачу агенту."}</p><span className="project-window-meta"><span>Обновлён {new Date(project.updatedAt).toLocaleDateString("ru-RU")}</span><b>Открыть →</b></span></button>)}{projects.length === 0 && <div className="empty-card">Создайте свой первый проект — после создания он появится здесь.</div>}</div>
          </section>
        ) : view === "connectors" ? (
          <section className="connectors-page">
            <div className="page-heading"><div><div className="eyebrow">ИНТЕГРАЦИИ</div><h1>Интеграции</h1><p>Подключите сервисы, которые используют ваши проекты.</p></div><button className="home-primary" type="button" onClick={() => setConnectorModal("Пользовательская интеграция")}>+ Добавить интеграцию</button></div>
            <div className="connector-grid">{[["GitHub","Репозиторий, ветки, коммиты и задачи","Разработка"],["Supabase","База данных, авторизация и хранилище","Бэкенд"],["OpenAI","Модели ИИ и доступ к API","ИИ"],["Telegram","Боты, сообщения и автоматизация","Коммуникации"],["Stripe","Платежи и подписки","Платежи"],["Notion","Страницы, базы данных и база знаний","Продуктивность"]].map(([name,description,category]) => <article className="connector-card" key={name}><div className="connector-icon">{name.slice(0,1)}</div><div className="connector-copy"><span>{category}</span><strong>{name}</strong><p>{description}</p></div><button type="button" onClick={() => { setConnectedConnectors((items) => items.includes(name) ? items.filter((item) => item !== name) : [...items, name]); setConnectorModal(name); }}>Подключить</button></article>)}</div>
          </section>
        ) : view === "settings" ? (
          <section className="settings-page">
            <div className="page-heading"><div><div className="eyebrow">УПРАВЛЕНИЕ РАБОЧИМ ПРОСТРАНСТВОМ</div><h1>Настройки</h1><p>ИИ, workspace behavior and interface preferences.</p></div></div>
            <div className="settings-grid">
              <div className="settings-card"><strong>ИИ provider</strong><span>{aiProvider} · {aiModel}</span><small>Активный провайдер и модель агента.</small></div>
              <div className="settings-card"><strong>Поведение предпросмотра</strong><span>{uiSettings.autoPreview ? "Автообновление включено" : "Ручное обновление"}</span><small>Автоматически обновлять предпросмотр после успешной работы агента.</small><div className="settings-option-row"><div className="settings-option-copy"><b>Автопредпросмотр</b><span>Обновлять после сборки</span></div><button type="button" aria-label="Toggle auto preview" className={`nexum-toggle ${uiSettings.autoPreview?"on":""}`} onClick={()=>setUiSettings(s=>({...s,autoPreview:!s.autoPreview}))}></button></div></div>
              <div className="settings-card"><strong>Анимации и эффекты</strong><span>{uiSettings.animations ? "Анимированный интерфейс" : "Минимум анимаций"}</span><small>Управляет переходами, анимациями появления и микро-взаимодействиями.</small><div className="settings-option-row"><div className="settings-option-copy"><b>Анимации</b><span>Переходы и движение</span></div><button type="button" aria-label="Toggle animations" className={`nexum-toggle ${uiSettings.animations?"on":""}`} onClick={()=>setUiSettings(s=>({...s,animations:!s.animations}))}></button></div><div className="settings-option-row"><div className="settings-option-copy"><b>Свечение</b><span>Акцентная подсветка и свечение фокуса</span></div><button type="button" aria-label="Toggle ambient glow" className={`nexum-toggle ${uiSettings.glow?"on":""}`} onClick={()=>setUiSettings(s=>({...s,glow:!s.glow}))}></button></div></div>
              <div className="settings-card"><strong>Плотность интерфейса</strong><span>{uiSettings.compact ? "Компактный" : "Комфортный"}</span><small>Выберите объём информации, отображаемый одновременно.</small><div className="settings-option-row"><div className="settings-option-copy"><b>Компактный mode</b><span>Более плотные панели и элементы управления</span></div><button type="button" aria-label="Toggle compact mode" className={`nexum-toggle ${uiSettings.compact?"on":""}`} onClick={()=>setUiSettings(s=>({...s,compact:!s.compact}))}></button></div></div>
              <div className="settings-card"><strong>Уведомления</strong><span>{uiSettings.sound ? "Звук включён" : "Без звука"}</span><small>Необязательный звук завершения агента при успехе или ошибке.</small><div className="settings-option-row"><div className="settings-option-copy"><b>Звук завершения</b><span>Агент завершил работу / ошибка</span></div><button type="button" aria-label="Toggle completion sound" className={`nexum-toggle ${uiSettings.sound?"on":""}`} onClick={()=>setUiSettings(s=>({...s,sound:!s.sound}))}></button></div></div>
              <div className="settings-card"><strong>Горячие клавиши</strong><span>⌘/Ctrl + K</span><small>Открывайте палитру команд для проектов, проверок, Git и переключения разделов.</small></div>
              <div className="settings-card"><strong>Хранилище проектов</strong><span>{projects.filter((project) => project.status === "active").length} активных проектов</span><small>Каждый проект хранит собственные файлы, предпросмотр и контекст диалога.</small></div>
            </div>
            <div className="settings-card" style={{marginTop:12}}><strong>ИИ API key</strong><span>Автоматическое определение провайдера</span><small>Paste an OpenAI, OpenRouter, or OrcaRouter key. NEXUM verifies the key and keeps it only in running server memory.</small><div style={{display:"flex",gap:8,marginTop:12}}><input type="password" value={aiApiKey} onChange={event=>setAiApiKey(event.target.value)} placeholder="Вставьте API-ключ" autoComplete="off" style={{flex:1,minWidth:0}}/><button type="button" className="home-primary" disabled={aiApiKeyLoading||!aiApiKey.trim()} onClick={()=>void connectAIKey()}>{aiApiKeyLoading?"Проверяю…":"Подключить ИИ"}</button></div></div>
            {localAITestEnabled && <div className="settings-card" style={{marginTop:12}}><strong>Тестовая сессия OpenRouter</strong><span>{localAIConfigured?"Подключено":"Не подключено"}</span><small>Временный ключ сессии для тестирования моделей без хранения учётных данных в репозитории.</small><div style={{display:"flex",gap:8,marginTop:12}}><input type="password" value={localAIKey} onChange={event=>setLocalAIKey(event.target.value)} placeholder="sk-or-v1-…" autoComplete="off" style={{flex:1,minWidth:0}}/><button type="button" className="home-primary" disabled={localAIKeyLoading||!localAIKey.trim()} onClick={()=>void saveLocalAIKey()}>{localAIKeyLoading?"Проверяю…":"Подключить"}</button></div></div>}
          </section>
        ) : (
        <>
        <div className="workspace-toolbar">
          <div className="workspace-breadcrumb"><span>Проекты</span><b>/</b><strong>{activeProject?.name ?? "NEXUM"}</strong></div>
          <div className="workspace-actions">
            <button type="button" onClick={() => setConnectorModal("Интеграция проекта")}>◇ Подключить</button>
            <button type="button" onClick={async () => { const url = `${window.location.origin}/api/preview/${activeProjectId}/index.html`; try { await navigator.clipboard.writeText(url); setNotice("Ссылка на предпросмотр скопирована"); } catch { setNotice(url); } }}>↗ Share</button>
            <button className="workspace-deploy" type="button" onClick={() => { const url = `/api/preview/${activeProjectId}/index.html`; window.open(url, "_blank", "noopener,noreferrer"); setNotice("Предпросмотр открыт в новой вкладке"); }}>Опубликовать</button>
            <button className="workspace-more" type="button" aria-label="Project menu" onClick={() => setWorkspaceMenuOpen((open) => !open)}>•••</button>
            {workspaceMenuOpen && <div className="workspace-menu"><button type="button" onClick={() => { setWorkspaceMenuOpen(false); setView("settings"); }}>Project settings</button><button type="button" onClick={async () => {
                setWorkspaceMenuOpen(false);
                try {
                  const response = await fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/duplicate`, { method: "POST" });
                  const data = await response.json() as { project?: Project; error?: string };
                  if (!response.ok || !data.project) throw new Error(data.error || "Duplicate failed");
                  await loadProjects(data.project.id);
                  setActiveProjectId(data.project.id);
                  setNotice("Project дублирован");
                } catch (error) { setApiError(error instanceof Error ? error.message : "Duplicate failed"); }
              }}>Дублировать проект</button><button type="button" onClick={() => {
                setWorkspaceMenuOpen(false);
                void deleteProject(activeProjectId);
              }}>Удалить проект</button></div>}
          </div>
        </div>
        <div className="project-editor-header">
          <button className="project-back" type="button" onClick={() => navigate("home")} aria-label="Вернуться к проектам">← <span>Проекты</span></button>
          <div className="project-editor-title">
            <span className="project-editor-mark">{(activeProject?.name ?? "N").slice(0, 1)}</span>
            <div><strong>{activeProject?.name ?? "NEXUM"}</strong><span>Проект</span></div>
          </div>
          <div className="project-editor-status"><span className={previewOnline ? "status-dot online" : "status-dot"} />{agentStage && !["completed","error"].includes(agentStage) ? "Агент работает" : previewOnline ? "Preview готов" : "Готов к работе"}</div>
          <div className="project-editor-actions">
            <button type="button" onClick={() => setRightTab("preview")}>Preview</button>
            <button type="button" onClick={() => setRightTab("files")}>Code</button>
            <button type="button" onClick={() => setRightTab("agent")}>Agent</button>
            <button className="project-editor-share" type="button" onClick={() => { const url = window.location.origin + "/api/preview/" + activeProjectId + "/index.html"; void navigator.clipboard.writeText(url).then(() => setNotice("Ссылка скопирована")).catch(() => setNotice(url)); }}>Share</button>
          </div>
        </div>
        <div className={`workspace ${builderStarted ? "builder-started" : "builder-idle"}`}>
          <div className="main-column">
            <ChatPanel projectName={activeProject?.name ?? "NEXUM"} message={message} reply={reply} stage={agentStage} apiError={apiError} messages={conversation} attachments={pendingAttachments} onMessageChange={setMessage} onSubmit={() => void sendMessage()} onRetry={() => void sendMessage(lastMessage)} onQuickTask={runTask} onFilesSelected={(files) => setPendingAttachments((items) => [...items, ...files.map((file) => ({ id: `${file.name}-${file.size}-${file.lastModified}`, name: file.name, type: file.type, size: file.size, file }))].slice(-5))} onRemoveAttachment={(id) => setPendingAttachments((items) => items.filter((item) => item.id !== id))} onOpenAgent={() => setRightTab("agent")} />
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
      <NewProjectModal open={modalOpen} name={newProjectName} loading={projectActionLoading} onNameChange={setNewProjectName} onClose={() => setModalOpen(false)} onSubmit={(data) => void createProject(data)} />
      {connectorModal && <div className="modal-backdrop connector-backdrop" onMouseDown={() => setConnectorModal(null)}><section className="connector-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div className="modal-top"><div><span className="eyebrow">CONNECTOR</span><h2>{connectorModal}</h2></div><button type="button" onClick={() => setConnectorModal(null)}>×</button></div><p>{connectedConnectors.includes(connectorModal) ? "Эта интеграция включена в интерфейсе рабочего пространства. OAuth/API-данные провайдера пока не сохраняются." : "Включить интеграцию для текущего рабочего пространства. OAuth/API-данные провайдера пока не сохраняются."}</p><div className="connector-modal-actions"><button type="button" onClick={() => setConnectorModal(null)}>Отмена</button><button className="home-primary" type="button" onClick={() => { if (!connectedConnectors.includes(connectorModal)) setConnectedConnectors((items) => [...items, connectorModal]); setConnectorModal(null); setNotice(connectorModal + " интеграция подключена"); }}>Продолжить</button></div></section></div>}
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}

export default App;
