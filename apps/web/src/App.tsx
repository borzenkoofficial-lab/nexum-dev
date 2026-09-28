import "./App.css";
import { useEffect, useRef, useState } from "react";
import { ChatPanel } from "./components/ChatPanel";
import { CommandPalette } from "./components/CommandPalette";
import { CodePanel } from "./components/CodePanel";
import { NewProjectModal } from "./components/NewProjectModal";
import { NewsPage } from "./components/NewsPage";
import { QuickActions } from "./components/QuickActions";
import { RightPanel } from "./components/RightPanel";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import type { AIProviderInfo, AIProviderStatus, AgentStage as АгентStage, Project as Проект } from "./components/types";
// UI controls persist locally; server-side credentials remain outside the client bundle.

function App() {
  const [projects, setПроектs] = useState<Проект[]>([]);
  const [activeПроектId, setActiveПроектId] = useState(() => {
    const segments = window.location.pathname.split("/").filter(Boolean);
    return segments[0] === "projects" && segments[1] ? decodeURIComponent(segments[1]) : "nexum";
  });
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [lastMessage, setLastMessage] = useState("");
  const [agentStage, setАгентStage] = useState<АгентStage>(null);
  const [projectsLoading, setПроектsLoading] = useState(true);
  const [projectActionLoading, setПроектActionLoading] = useState(false);
  const [apiError, setApiError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [newПроектName, setNewПроектName] = useState("");
  const [aiProviders, setAIProviders] = useState<AIProviderInfo[]>([]);
  const [aiModels, setAIModels] = useState<Record<string, string[]>>({});
  const [aiProvider, setAIProvider] = useState("mock");
  const [aiModel, setAIModel] = useState("mock-v1");
  const [aiStatus, setAIStatus] = useState<AIProviderStatus | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [rightTab, setRightTab] = useState<"preview" | "files" | "agent">("preview");
  const [codeMode, setCodeMode] = useState(false);
  const [notice, setNotice] = useState("");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [previewOnline, setПредпросмотрOnline] = useState(false);
  const [previewKey, setПредпросмотрKey] = useState(0);
  const [builderStarted, setBuilderStarted] = useState(false);
  const [chatJobId, setChatJobId] = useState<string | null>(null);
  const [view, setViewState] = useState<"home" | "project" | "connectors" | "settings" | "news">(() => {
    const path = window.location.pathname;
    return path.startsWith("/projects/") && path.split("/").filter(Boolean)[1] ? "project" : path === "/settings" ? "settings" : path === "/connectors" ? "connectors" : path === "/news" ? "news" : "home";
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
  const conversationПроектRef = useRef<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<Array<{ id: string; name: string; type: string; size: number; file: File }>>([]);
  const [uiSettings, setUiSettings] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("nexum:ui-settings") || "{}") as Partial<{animations:boolean; compact:boolean; autoПредпросмотр:boolean; sound:boolean; glow:boolean}>;
      return { animations: saved.animations !== false, compact: Boolean(saved.compact), autoПредпросмотр: saved.autoПредпросмотр !== false, sound: Boolean(saved.sound), glow: saved.glow !== false };
    } catch { return { animations:true, compact:false, autoПредпросмотр:true, sound:false, glow:true }; }
  });
  useEffect(() => { try { localStorage.setItem("nexum:ui-settings", JSON.stringify(uiSettings)); } catch {} }, [uiSettings]);
  useEffect(() => { document.documentElement.dataset.motion=uiSettings.animations?"on":"off"; document.documentElement.dataset.compact=uiSettings.compact?"on":"off"; document.documentElement.dataset.glow=uiSettings.glow?"on":"off"; }, [uiSettings]);

  const activeПроект = projects.find((project) => project.id === activeПроектId);

  function navigate(nextView: "home" | "project" | "connectors" | "settings" | "news", projectId?: string, replace = false) {
    setViewState(nextView);
    const target = nextView === "project"
      ? "/projects/" + encodeURIComponent(projectId ?? activeПроектId)
      : nextView === "connectors" ? "/connectors"
      : nextView === "settings" ? "/settings"
      : nextView === "news" ? "/news" : "/projects";
    if (window.location.pathname !== target) {
      if (replace) window.history.replaceState({ view: nextView, projectId }, "", target);
      else window.history.pushState({ view: nextView, projectId }, "", target);
    }
  }

  const setView = (nextView: "home" | "project" | "connectors" | "settings" | "news") => navigate(nextView);

  useEffect(() => {
    const onPopState = () => {
      const path = window.location.pathname;
      const segments = path.split("/").filter(Boolean);
      if (segments[0] === "projects" && segments[1]) {
        setActiveПроектId(decodeURIComponent(segments[1]));
        setViewState("project");
      } else if (path === "/connectors") setViewState("connectors");
      else if (path === "/settings") setViewState("settings");
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
      void fetch("/api/agent/client-error", {
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
      void fetch(`/api/projects/${encodeURIComponent(activeПроектId)}/preview/runtime-error`, {
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
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("nexum:connectors") || "[]");
      if (Array.isArray(saved)) setConnectedConnectors(saved.filter((item): item is string => typeof item === "string"));
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem("nexum:connectors", JSON.stringify(connectedConnectors)); } catch {} }, [connectedConnectors]);

  useEffect(() => {
    if (!activeПроектId) return;
    fetch(`/api/projects/${encodeURIComponent(activeПроектId)}/preview/status`).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { online?: boolean };
      setПредпросмотрOnline(Boolean(data.online));
    }).catch(() => setПредпросмотрOnline(false));
  }, [activeПроектId, previewKey]);
  const selectedModels = aiModels[aiProvider] ?? [];

  async function loadПроектs(preferredId = activeПроектId) {
    setПроектsLoading(true);
    try {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error(`Проекты API: HTTP ${response.status}`);
      const data = (await response.json()) as { projects?: Проект[] };
      const nextПроектs = data.projects ?? [];
      const preferred = nextПроектs.find((project) => project.id === preferredId && project.status === "active");
      const fallback = nextПроектs.find((project) => project.id === "nexum" && project.status === "active")
        ?? nextПроектs.find((project) => project.status === "active");
      setПроектs(nextПроектs);
      setActiveПроектId(preferred?.id ?? fallback?.id ?? "nexum");
      setApiError("");
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

  function openПроект(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (project) {
      setActiveПроектId(projectId);
      setReply("");
      setАгентStage(null);
      setViewState("project");
      navigate("project", projectId);
    }
    void selectПроект(projectId);
  }

  async function selectПроект(projectId: string) {
    setПроектActionLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/select`, { method: "POST" });
      if (!response.ok) throw new Error(`API выбора проекта: HTTP ${response.status}`);
      setChatJobId(null);
      setАгентStage(null);
      setActiveПроектId(projectId);
      setReply("");
      await loadПроектs(projectId);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Не удалось выбрать проект");
    } finally {
      setПроектActionLoading(false);
    }
  }

  async function deleteПроект(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    const confirmed = window.confirm(`Удалить проект «${project.name}» навсегда? Все файлы проекта будут удалены. Это действие нельзя отменить.`);
    if (!confirmed) return;

    setПроектActionLoading(true);
    setApiError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({})) as { project?: Проект; error?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось удалить проект");
      const fallbackId = projects.find((item) => item.status === "active" && item.id !== projectId)?.id ?? "nexum";
      await loadПроектs(activeПроектId === projectId ? fallbackId : activeПроектId);
      if (activeПроектId === projectId) {
        setActiveПроектId(fallbackId);
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
      setApiError(error instanceof Error ? error.message : "Не удалось удалить проект");
    } finally {
      setПроектActionLoading(false);
    }
  }

  async function createПроект(data: { name: string; description: string; type: string }) {
    if (!data.name.trim()) return;
    setПроектActionLoading(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: data.name.trim(), description: data.description, type: data.type }),
      });
      if (!response.ok) throw new Error(`API создания проекта: HTTP ${response.status}`);
      const responseData = (await response.json()) as { project: Проект };
      await selectПроект(responseData.project.id);
      setView("project");
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
      void sendMessage(buildBrief, responseData.project.id);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Не удалось создать проект");
    } finally {
      setПроектActionLoading(false);
    }
  }

  function repairLastTask() {
    const task = lastMessage.trim();
    if (!task) {
      setRightTab("preview");
      return;
    }
    const repairTask = `Исправь результат последней задачи. Проверь Preview, найди ошибки и внеси необходимые исправления: ${task}`;
    setMessage(repairTask);
    setRightTab("agent");
    window.setTimeout(() => void sendMessage(repairTask), 0);
  }

  async function sendMessage(task = message, projectIdOverride?: string) {
    const targetПроектId = projectIdOverride ?? activeПроектId;
    if (!task.trim() || !targetПроектId) return;
    setLastMessage(task);
    setBuilderStarted(true);
    setRightTab("agent");
    setАгентStage("thinking");
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

      setChatJobId(data.jobId);
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
        setАгентStage((data?.job?.stage as typeof agentStage) ?? (status === "running" ? "running" : "thinking"));
        timer = window.setTimeout(pollJob, 900);
      } catch (error) {
        if (cancelled) return;
        console.error("[Nexum] Chat job polling failed:", error);
        setApiError(error instanceof Error ? error.message : "Ошибка получения статуса задачи чата");
        setАгентStage("error");
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

  function openПроектPicker() {
    navigate("home");
    setMobileSidebarOpen(true);
    setNotice("Выберите проект из списка");
    window.setTimeout(() => setNotice(""), 3200);
  }

  const runTask = (task: string) => void sendMessage(task);
  const paletteActions = [
    { label: "New Проект", hint: "N", run: () => setModalOpen(true) },
    { label: "Open Проект", hint: "O", run: openПроектPicker },
    { label: "Поиск файлов", hint: "S", run: () => focusTask("Найди ") },
    { label: "Open Агент Activity", hint: "A", run: () => setRightTab("agent") },
    { label: "Запустить тесты", hint: "T", run: () => runTask("Запусти тесты в изолированной среде") },
    { label: "Запустить сборку", hint: "B", run: () => runTask("Проверь сборку проекта") },
    { label: "Статус Git", hint: "G", run: () => runTask("Покажи статус Git") },
    { label: "Изменения Git", hint: "D", run: () => runTask("Что изменилось?") },
    { label: "Открыть предпросмотр", hint: "P", run: () => { setRightTab("preview"); setПредпросмотрKey((key) => key + 1); setNotice("Предпросмотр обновлён"); } },
    { label: "Перезапустить предпросмотр", hint: "R", run: () => { setRightTab("preview"); setПредпросмотрKey((key) => key + 1); setNotice("Предпросмотр перезапущен"); } },
    { label: "Ask ИИ", hint: "A", run: () => focusTask() },
    { label: "Сменить модель", hint: "M", run: () => document.querySelector<HTMLSelectElement>("select[aria-label='ИИ model']")?.focus() },
    { label: "Настройки", hint: "", run: () => setView("settings") },
  ];

  return (
    <div className={"app app-" + view}>
      {<Sidebar projects={projects} activeProjectId={activeПроектId} projectsLoading={projectsLoading} projectActionLoading={projectActionLoading} mobileOpen={mobileSidebarOpen} view={view} onDeleteProject={(id) => void deleteПроект(id)} onViewChange={(next) => { setMobileSidebarOpen(false); setView(next); }} onNewProject={() => { setMobileSidebarOpen(false); setModalOpen(true); }} onSelectProject={(id) => { setMobileSidebarOpen(false); openПроект(id); }} />}
      <main className="main">
        {view !== "project" && <TopBar projectName={view === "connectors" ? "Интеграции" : view === "settings" ? "Настройки" : view === "news" ? "Новости NEXUM" : "NEXUM.DEV"} providers={aiProviders} models={selectedModels} provider={aiProvider} model={aiModel} aiStatus={aiStatus} stage={agentStage} onProviderChange={selectAIProvider} onModelChange={setAIModel} onToggleSidebar={() => setMobileSidebarOpen((open) => !open)} />}
        {view === "home" ? (
          <section className="nexum-home">
            <div className="home-hero"><div><div className="eyebrow">NEXUM.DEV</div><h1>Создавайте, не покидая рабочее пространство.</h1><p>Создайте проект, откройте его как отдельное рабочее пространство, подключите сервисы и поручите агенту разработку.</p></div><button className="home-primary" type="button" onClick={() => setModalOpen(true)}>+ Новый проект</button></div>
            <div className="home-section-title"><span>ВАШИ ПРОЕКТЫ</span><button type="button" onClick={() => setModalOpen(true)}>Новый проект</button></div>
            <div className="project-grid">{projects.filter((project) => project.status === "active").map((project) => <button key={project.id} className="project-window" type="button" onClick={() => openПроект(project.id)}><span className="window-chrome"><i/><i/><i/></span><span className="project-window-mark">{project.name.slice(0, 1)}</span><div className="project-window-head"><strong>{project.name}</strong><span className="project-type-badge">{project.type ?? "Проект"}</span></div><p className="project-window-description">{project.description || "Проект готов к разработке. Откройте рабочее пространство и задайте первую задачу агенту."}</p><span className="project-window-meta"><span>Обновлён {new Date(project.updatedAt).toLocaleDateString("ru-RU")}</span><b>Открыть →</b></span></button>)}{projects.length === 0 && <div className="empty-card">Создайте свой первый проект — после создания он появится здесь.</div>}</div>
          </section>
        ) : view === "news" ? (
          <NewsPage />
        ) : view === "connectors" ? (
          <section className="connectors-page">
            <div className="page-heading"><div><div className="eyebrow">ИНТЕГРАЦИИ</div><h1>Интеграции</h1><p>Подключите сервисы, которые используют ваши проекты.</p></div><button className="home-primary" type="button" onClick={() => setConnectorModal("Пользовательская интеграция")}>+ Добавить интеграцию</button></div>
            <div className="connector-grid">{[["GitHub","Репозиторий, ветки, коммиты и задачи","Разработка"],["Supabase","База данных, авторизация и хранилище","Бэкенд"],["OpenAI","Модели ИИ и доступ к API","ИИ"],["Telegram","Боты, сообщения и автоматизация","Коммуникации"],["Stripe","Платежи и подписки","Платежи"],["Notion","Страницы, базы данных и база знаний","Продуктивность"]].map(([name,description,category]) => <article className="connector-card" key={name}><div className="connector-icon">{name.slice(0,1)}</div><div className="connector-copy"><span>{category}</span><strong>{name}</strong><p>{description}</p></div><button type="button" onClick={() => { setConnectedConnectors((items) => items.includes(name) ? items.filter((item) => item !== name) : [...items, name]); setConnectorModal(name); }}>Подключить</button></article>)}</div>
          </section>
        ) : view === "settings" ? (
          <section className="settings-page">
            <div className="page-heading"><div><div className="eyebrow">УПРАВЛЕНИЕ РАБОЧИМ ПРОСТРАНСТВОМ</div><h1>Настройки</h1><p>ИИ, поведение рабочего пространства и параметры интерфейса.</p></div></div>
            <div className="settings-grid">
              <div className="settings-card"><strong>Провайдер ИИ</strong><span>{aiProvider} · {aiModel}</span><small>Активный провайдер и модель агента.</small></div>
              <div className="settings-card"><strong>Поведение предпросмотра</strong><span>{uiSettings.autoПредпросмотр ? "Автообновление включено" : "Ручное обновление"}</span><small>Автоматически обновлять предпросмотр после успешной работы агента.</small><div className="settings-option-row"><div className="settings-option-copy"><b>Автопредпросмотр</b><span>Обновлять после сборки</span></div><button type="button" aria-label="Toggle auto preview" className={`nexum-toggle ${uiSettings.autoПредпросмотр?"on":""}`} onClick={()=>setUiSettings(s=>({...s,autoПредпросмотр:!s.autoПредпросмотр}))}></button></div></div>
              <div className="settings-card"><strong>Анимации и эффекты</strong><span>{uiSettings.animations ? "Анимированный интерфейс" : "Минимум анимаций"}</span><small>Управляет переходами, анимациями появления и микро-взаимодействиями.</small><div className="settings-option-row"><div className="settings-option-copy"><b>Анимации</b><span>Переходы и движение</span></div><button type="button" aria-label="Toggle animations" className={`nexum-toggle ${uiSettings.animations?"on":""}`} onClick={()=>setUiSettings(s=>({...s,animations:!s.animations}))}></button></div><div className="settings-option-row"><div className="settings-option-copy"><b>Свечение</b><span>Акцентная подсветка и свечение фокуса</span></div><button type="button" aria-label="Toggle ambient glow" className={`nexum-toggle ${uiSettings.glow?"on":""}`} onClick={()=>setUiSettings(s=>({...s,glow:!s.glow}))}></button></div></div>
              <div className="settings-card"><strong>Плотность интерфейса</strong><span>{uiSettings.compact ? "Компактный" : "Комфортный"}</span><small>Выберите объём информации, отображаемый одновременно.</small><div className="settings-option-row"><div className="settings-option-copy"><b>Компактный режим</b><span>Более плотные панели и элементы управления</span></div><button type="button" aria-label="Toggle compact mode" className={`nexum-toggle ${uiSettings.compact?"on":""}`} onClick={()=>setUiSettings(s=>({...s,compact:!s.compact}))}></button></div></div>
              <div className="settings-card"><strong>Уведомления</strong><span>{uiSettings.sound ? "Звук включён" : "Без звука"}</span><small>Необязательный звук завершения агента при успехе или ошибке.</small><div className="settings-option-row"><div className="settings-option-copy"><b>Звук завершения</b><span>Агент завершил работу / ошибка</span></div><button type="button" aria-label="Toggle completion sound" className={`nexum-toggle ${uiSettings.sound?"on":""}`} onClick={()=>setUiSettings(s=>({...s,sound:!s.sound}))}></button></div></div>
              <div className="settings-card"><strong>Горячие клавиши</strong><span>⌘/Ctrl + K</span><small>Открывайте палитру команд для проектов, проверок, Git и переключения разделов.</small></div>
              <div className="settings-card"><strong>Хранилище проектов</strong><span>{projects.filter((project) => project.status === "active").length} активных проектов</span><small>Каждый проект хранит собственные файлы, предпросмотр и контекст диалога.</small></div>
            </div>
            <div className="settings-card" style={{marginTop:12}}><strong>ИИ API key</strong><span>Автоматическое определение провайдера</span><small>Вставьте ключ OpenAI, OpenRouter или OrcaRouter. NEXUM проверит его и сохранит только в памяти текущего сервера.</small><div style={{display:"flex",gap:8,marginTop:12}}><input type="password" value={aiApiKey} onChange={event=>setAiApiKey(event.target.value)} placeholder="Вставьте API-ключ" autoComplete="off" style={{flex:1,minWidth:0}}/><button type="button" className="home-primary" disabled={aiApiKeyLoading||!aiApiKey.trim()} onClick={()=>void connectAIKey()}>{aiApiKeyLoading?"Проверяю…":"Подключить ИИ"}</button></div></div>
            {localAITestEnabled && <div className="settings-card" style={{marginTop:12}}><strong>Тестовая сессия OpenRouter</strong><span>{localAIConfigured?"Подключено":"Не подключено"}</span><small>Временный ключ сессии для тестирования моделей без хранения учётных данных в репозитории.</small><div style={{display:"flex",gap:8,marginTop:12}}><input type="password" value={localAIKey} onChange={event=>setLocalAIKey(event.target.value)} placeholder="sk-or-v1-…" autoComplete="off" style={{flex:1,minWidth:0}}/><button type="button" className="home-primary" disabled={localAIKeyLoading||!localAIKey.trim()} onClick={()=>void saveLocalAIKey()}>{localAIKeyLoading?"Проверяю…":"Подключить"}</button></div></div>}
          </section>
        ) : (
        <>
        <div className="workspace-toolbar">
          <div className="workspace-breadcrumb"><span>Проекты</span><b>/</b><strong>{activeПроект?.name ?? "NEXUM"}</strong></div>
          <div className="workspace-actions">
            <button type="button" onClick={() => setConnectorModal("Интеграция проекта")}>◇ Подключить</button>
            <button type="button" onClick={async () => { const url = `${window.location.origin}/api/preview/${activeПроектId}/index.html`; try { await navigator.clipboard.writeText(url); setNotice("Ссылка на предпросмотр скопирована"); } catch { setNotice(url); } }}>Поделиться</button>
            <button className="workspace-deploy" type="button" onClick={() => { const url = `/api/preview/${activeПроектId}/index.html`; window.open(url, "_blank", "noopener,noreferrer"); setNotice("Предпросмотр открыт в новой вкладке"); }}>Открыть</button>
            <button className="workspace-more" type="button" aria-label="Меню проекта" onClick={() => setWorkspaceMenuOpen((open) => !open)}>•••</button>
            {workspaceMenuOpen && <div className="workspace-menu"><button type="button" onClick={() => { setWorkspaceMenuOpen(false); setView("settings"); }}>Настройки проекта</button><button type="button" onClick={async () => {
                setWorkspaceMenuOpen(false);
                try {
                  const response = await fetch(`/api/projects/${encodeURIComponent(activeПроектId)}/duplicate`, { method: "POST" });
                  const data = await response.json() as { project?: Проект; error?: string };
                  if (!response.ok || !data.project) throw new Error(data.error || "Не удалось дублировать проект");
                  await loadПроектs(data.project.id);
                  setActiveПроектId(data.project.id);
                  setNotice("Проект дублирован");
                } catch (error) { setApiError(error instanceof Error ? error.message : "Не удалось дублировать проект"); }
              }}>Дублировать проект</button><button type="button" onClick={() => {
                setWorkspaceMenuOpen(false);
                void deleteПроект(activeПроектId);
              }}>Удалить проект</button></div>}
          </div>
        </div>
        <div className="project-editor-header">
          <button className="project-back" type="button" onClick={() => navigate("home")} aria-label="Вернуться к проектам">← <span>Проекты</span></button>
          <div className="project-editor-title">
            <span className="project-editor-mark">{(activeПроект?.name ?? "N").slice(0, 1)}</span>
            <div><strong>{activeПроект?.name ?? "NEXUM"}</strong><span>Проект</span></div>
          </div>
          <div className="project-editor-status"><span className={previewOnline ? "status-dot online" : "status-dot"} />{agentStage && !["completed","error"].includes(agentStage) ? "Агент работает" : previewOnline ? "Предпросмотр готов" : "Готов к работе"}</div>
          <div className="project-editor-actions">
            <button type="button" onClick={() => setRightTab("preview")}>Предпросмотр</button>
            <button type="button" className="project-code-button" onClick={() => setCodeMode(true)}>Код</button>
            <button type="button" onClick={() => setRightTab("agent")}>Агент</button>
            <button className="project-editor-share" type="button" onClick={() => { const url = window.location.origin + "/api/preview/" + activeПроектId + "/index.html"; void navigator.clipboard.writeText(url).then(() => setNotice("Ссылка скопирована")).catch(() => setNotice(url)); }}>Поделиться</button>
          </div>
        </div>
        {codeMode ? <CodePanel projectId={activeПроектId} projectName={activeПроект?.name ?? "NEXUM"} previewOnline={previewOnline} onRefreshПредпросмотр={() => setПредпросмотрKey((key) => key + 1)} onClose={() => setCodeMode(false)} /> : <div className={`workspace ${builderStarted ? "builder-started" : "builder-idle"}`}>
          <div className="main-column">
            <ChatPanel projectName={activeПроект?.name ?? "NEXUM"} message={message} reply={reply} stage={agentStage} apiError={apiError} messages={conversation} attachments={pendingAttachments} onMessageChange={setMessage} onSubmit={() => void sendMessage()} onRetry={() => void sendMessage(lastMessage)} onQuickTask={runTask} onFilesSelected={(files) => setPendingAttachments((items) => [...items, ...files.map((file) => ({ id: `${file.name}-${file.size}-${file.lastModified}`, name: file.name, type: file.type, size: file.size, file }))].slice(-5))} onRemoveAttachment={(id) => setPendingAttachments((items) => items.filter((item) => item.id !== id))} onOpenАгент={() => setRightTab("agent")} />

          </div>
          <RightPanel tab={rightTab} onTabChange={setRightTab} projectName={activeПроект?.name ?? "NEXUM"} projectId={activeПроектId} previewOnline={previewOnline} previewKey={previewKey} onRefreshПредпросмотр={() => setПредпросмотрKey((key) => key + 1)} jobId={chatJobId} stage={agentStage} activitySteps={activitySteps} activityEvents={activityEvents} currentActivity={currentActivity} problems={problems} productPlan={productPlan} onPreviewError={(message) => { setProblems((items) => [...items, { message, source: "preview" }].slice(-20)); setRightTab("agent"); setАгентStage("error"); }} onRepair={repairLastTask} />
        </div>}
        </>
        )}
      </main>
      <StatusBar projectName={activeПроект?.name ?? "NEXUM"} provider={aiProvider} aiStatus={aiStatus} previewOnline={previewOnline} />
      <CommandPalette key={paletteOpen ? "open" : "closed"} open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} />
      <NewProjectModal open={modalOpen} name={newПроектName} loading={projectActionLoading} onNameChange={setNewПроектName} onClose={() => setModalOpen(false)} onSubmit={(data) => void createПроект(data)} />
      {connectorModal && <div className="modal-backdrop connector-backdrop" onMouseDown={() => setConnectorModal(null)}><section className="connector-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div className="modal-top"><div><span className="eyebrow">ИНТЕГРАЦИЯ</span><h2>{connectorModal}</h2></div><button type="button" onClick={() => setConnectorModal(null)}>×</button></div><p>{connectedConnectors.includes(connectorModal) ? "Эта интеграция включена в интерфейсе рабочего пространства. OAuth/API-данные провайдера пока не сохраняются." : "Включить интеграцию для текущего рабочего пространства. OAuth/API-данные провайдера пока не сохраняются."}</p><div className="connector-modal-actions"><button type="button" onClick={() => setConnectorModal(null)}>Отмена</button><button className="home-primary" type="button" onClick={() => { if (!connectedConnectors.includes(connectorModal)) setConnectedConnectors((items) => [...items, connectorModal]); setConnectorModal(null); setNotice(connectorModal + " интеграция подключена"); }}>Продолжить</button></div></section></div>}
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}

export default App;
