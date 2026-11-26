import "./App.css";
import { AuthGate } from "./auth/AuthGate";
import { AdminControlCenter } from "./components/AdminControlCenter";
import "./builder.css";
import "./kvard-design-system.css";
import "./kvard-ui-kit.css";
import { NexumWelcome } from "./components/NexumWelcome";
import { useEffect, useRef, useState } from "react";
import { KvardToast } from "./components/ui/index.ts";
import { CommandPalette } from "./components/CommandPalette";
import { NewProjectModal } from "./components/NewProjectModal";
import { NewsPage } from "./components/NewsPage";
import { IntegrationPage } from "./components/IntegrationPage";
import { DiagnosticsPage } from "./components/DiagnosticsPage";
import { AgentsPage } from "./components/AgentsPage";
import { BusinessAgentsPage } from "./components/BusinessAgentsPage";
import { AgentApprovalPanel, type AgentApprovalView } from "./components/AgentApprovalPanel";
import { BuilderShell } from "./components/BuilderShell";
import { BuilderChat } from "./components/BuilderChat";
import { BuilderTools } from "./components/BuilderTools";
import { BuilderCode } from "./components/BuilderCode";
import { BuilderHome } from "./components/BuilderHome";
import { Sidebar } from "./components/Sidebar";
import { NexumApplicationManager } from "./components/NexumApplicationManager";
import { NexumOSEventCenter, type NexumOSEventItem } from "./components/NexumOSEventCenter";
import { OSAppWindow } from "./components/OSAppWindow";
import type { AIProviderInfo, AIProviderStatus, AgentStage as АгентStage, Project as Проект } from "./components/types";
import { diagnosticsEvent, getDiagnosticsSessionId, startDiagnostics } from "./diagnostics";
import { nexumRuntime } from "./runtime";
import { conversationForProject, readProjectConversation, shouldPersistProjectConversation, type ProjectConversationMessage } from "./components/projectConversation";
// UI controls persist locally; server-side credentials remain outside the client bundle.

function ConnectorModal({ name, onClose }: { name: string; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return <div className="modal-backdrop connector-backdrop" onMouseDown={onClose}>
    <section className="connector-modal" role="dialog" aria-modal="true" aria-labelledby="connector-modal-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-top"><div><span className="eyebrow">ИНТЕГРАЦИЯ</span><h2 id="connector-modal-title">{name}</h2></div><button type="button" aria-label="Закрыть" onClick={onClose}>×</button></div>
      <p>Подключение этой интеграции пока не реализовано на серверной стороне. Никакие OAuth/API-данные не создаются и не сохраняются.</p>
      <div className="connector-modal-actions"><button type="button" onClick={onClose}>Закрыть</button><button className="home-primary" type="button" disabled aria-disabled="true">Недоступно</button></div>
    </section>
  </div>;
}

function broadcastChatJobTerminal(jobId: string, projectId: string, status: "completed" | "failed" | "cancelled") {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel("kvard-chat-job-sync-v1");
    channel.postMessage({ type: "terminal", jobId, projectId, status, sentAt: Date.now() });
    channel.close();
  } catch {
    // Cross-tab synchronization is an enhancement; server state remains authoritative.
  }
}

function WorkspaceApp() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try { return localStorage.getItem("kvard:theme") === "dark" ? "dark" : "light"; } catch { return "light"; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("kvard:theme", theme); } catch {}
  }, [theme]);
  useEffect(() => { startDiagnostics(); diagnosticsEvent({ type: "app-mounted", level: "info", message: "КВАРД application mounted" }); }, []);
  const [projects, setПроектs] = useState<Проект[]>([]);
  const [activeПроектId, setActiveПроектId] = useState(() => {
    const segments = window.location.pathname.split("/").filter(Boolean);
    return segments[0] === "projects" && segments[1] ? decodeURIComponent(segments[1]) : "nexum";
  });
  const [message, setMessage] = useState("");
  const [pendingAgentDefinitionId, setPendingAgentDefinitionId] = useState<string | null>(null);
  const [pendingAgentProjectId, setPendingAgentProjectId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [lastMessage, setLastMessage] = useState("");
  const [agentStage, setАгентStage] = useState<АгентStage>(null);
  const [projectsLoading, setПроектsLoading] = useState(true);
  const [projectActionLoading, setПроектActionLoading] = useState(false);
  const [apiError, setApiError] = useState("");
  const [projectCreationError, setProjectCreationError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [newПроектName, setNewПроектName] = useState("");
  const [newПроектDescription, setNewПроектDescription] = useState("");
  function openNewProject(description = "") {
    setNewПроектDescription(description);
    setProjectCreationError("");
    setModalOpen(true);
  }

  const [aiProviders, setAIProviders] = useState<AIProviderInfo[]>([]);
  const [aiModels, setAIModels] = useState<Record<string, string[]>>({});
  const [aiProvider, setAIProvider] = useState("mock");
  const [aiModel, setAIModel] = useState("mock-v1");
  const [aiStatus, setAIStatus] = useState<AIProviderStatus | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [rightTab, setRightTab] = useState<"preview" | "files" | "agent">("preview");
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
  const [chatJobId, setChatJobId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<AgentApprovalView | null>(null);
  const [pendingApprovalProjectId, setPendingApprovalProjectId] = useState<string | null>(null);
  const [approvalActionLoading, setApprovalActionLoading] = useState(false);
  const [approvalActionError, setApprovalActionError] = useState("");
  const chatJobIdRef = useRef<string | null>(null);
  const setAuthoritativeChatJobId = (jobId: string | null) => {
    if (chatJobIdRef.current !== jobId) {
      setPendingApproval(null);
      setPendingApprovalProjectId(null);
      setApprovalActionError("");
      setApprovalActionLoading(false);
    }
    chatJobIdRef.current = jobId;
    setChatJobId(jobId);
    if (import.meta.env.VITE_E2E === "true") {
      (window as unknown as { __NEXUM_E2E_ACTIVE_CHAT_JOB_ID__?: string | null }).__NEXUM_E2E_ACTIVE_CHAT_JOB_ID__ = jobId;
    }
  };
  const clearAuthoritativeChatJobIfOwned = (jobId: string) => {
    if (chatJobIdRef.current !== jobId) return false;
    setAuthoritativeChatJobId(null);
    return true;
  };
  const [projectTaskMeta, setProjectTaskMeta] = useState<Record<string, { task: string; timestamp: number; status: "queued" | "running" | "completed" | "failed" | "cancelled" }>>(() => { try { return JSON.parse(localStorage.getItem("nexum:project-task-meta") || "{}"); } catch { return {}; } });
  const [view, setViewState] = useState<"home" | "project" | "connectors" | "settings" | "news" | "diagnostics" | "agents" | "business-agents">(() => {
    const path = window.location.pathname;
    return path.startsWith("/projects/") && path.split("/").filter(Boolean)[1] ? "project" : path === "/settings" ? "settings" : path === "/connectors" ? "connectors" : path === "/news" ? "news" : path === "/diagnostics" ? "diagnostics" : path === "/agents" ? "agents" : path === "/business-agents" ? "business-agents" : "home";
  });
  const [connectorModal, setConnectorModal] = useState<string | null>(null);
  const connectedConnectors: string[] = [];
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
  const [anyModelApiKey, setAnyModelApiKey] = useState("");
  const [anyModelApiKeyLoading, setAnyModelApiKeyLoading] = useState(false);
  const [anyModelConnectionState, setAnyModelConnectionState] = useState<"unknown" | "ready" | "checking" | "connected" | "error">("unknown");
  const [anyModelConnectionMessage, setAnyModelConnectionMessage] = useState("Проверка подключения ещё не выполнялась.");
  const localAITestEnabled = true;
  const [localAIConfigured, setLocalAIConfigured] = useState(false);
  const [localAIKeyLoading, setLocalAIKeyLoading] = useState(false);
  const [conversation, setConversation] = useState<ProjectConversationMessage[]>([]);
  const [conversationProjectId, setConversationProjectId] = useState<string | null>(null);
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
  function navigate(nextView: "home" | "project" | "connectors" | "settings" | "news" | "diagnostics" | "agents" | "business-agents", projectId?: string, replace = false) {
    setViewState(nextView);
    const target = nextView === "project"
      ? "/projects/" + encodeURIComponent(projectId ?? activeПроектId)
      : nextView === "connectors" ? "/connectors"
      : nextView === "settings" ? "/settings"
      : nextView === "news" ? "/news" : nextView === "diagnostics" ? "/diagnostics" : nextView === "agents" ? "/agents" : nextView === "business-agents" ? "/business-agents" : "/projects";
    if (window.location.pathname !== target) {
      if (replace) window.history.replaceState({ view: nextView, projectId }, "", target);
      else window.history.pushState({ view: nextView, projectId }, "", target);
    }
  }

  const setView = (nextView: "home" | "project" | "connectors" | "settings" | "news" | "diagnostics" | "agents" | "business-agents") => navigate(nextView);

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
      else if (path === "/agents") setViewState("agents");
      else if (path === "/business-agents") setViewState("business-agents");
      else setViewState("home");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    setConversationProjectId(null);
    setConversation(readProjectConversation(activeПроектId, localStorage));
    setConversationProjectId(activeПроектId);
  }, [activeПроектId]);

  useEffect(() => {
    if (!shouldPersistProjectConversation(activeПроектId, conversationProjectId)) return;
    try { localStorage.setItem(`nexum:conversation:${activeПроектId}`, JSON.stringify(conversation.slice(-100))); } catch {}
  }, [activeПроектId, conversationProjectId, conversation]);

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
    if (projectsLoading) return;
    let cancelled = false;
    async function restoreActiveAgentJob() {
      try {
        const response = await nexumRuntime.network.fetch("/api/chat/jobs");
        if (!response.ok || cancelled) return;
        const data = await response.json() as { jobs?: Array<{ id: string; projectId?: string; status?: string; stage?: string; currentMessage?: string }> };
        const job = (data.jobs ?? []).find((item) => (item.status === "queued" || item.status === "running") && item.projectId === activeПроектId);
        if (!job && !cancelled && chatJobIdRef.current === null) {
          const recentResponse = await nexumRuntime.network.fetch("/api/chat/jobs/recent");
          if (!recentResponse.ok || cancelled) return;
          const recentData = await recentResponse.json() as { jobs?: Array<{
            id: string; projectId?: string; status?: "completed" | "failed" | "cancelled";
            stage?: string; currentMessage?: string; reply?: string;
            steps?: Array<{ iteration: number; tool: string; success: boolean }>;
            events?: Array<{ id: number; timestamp: number; iteration: number; type: string; tool?: string; message: string }>;
            problems?: Array<{ message: string; source?: string }>;
            error?: string; updatedAt?: number;
            recoveryAssessment?: {
              disposition: "safe_to_restart" | "inspect_before_retry" | "manual_review_required";
              reason: string;
              automaticResumeAllowed: false;
            };
            checkpointRecoveryAssessment?: {
              disposition: "checkpoint_compatible" | "inspect_before_resume" | "manual_review_required";
              reason: string;
              automaticResumeAllowed: false;
            };
            productPlan?: { goal?: string; productType?: string; pages?: string[]; components?: string[]; acceptanceCriteria?: string[] };
          }> };
          const completedJob = (recentData.jobs ?? []).find((item) => item.projectId === activeПроектId);
          if (!completedJob || cancelled) return;
          if (completedJob.reply) {
            setReply(completedJob.reply);
            upsertAssistantReply(completedJob.id, completedJob.reply);
          }
          setActivitySteps(completedJob.steps ?? []);
          setActivityEvents(completedJob.events ?? []);
          setProblems(completedJob.problems ?? []);
          const checkpointMessage = completedJob.checkpointRecoveryAssessment?.disposition === "checkpoint_compatible"
            ? "Контрольная точка совпадает с текущим проектом и журналом действий. Автоматическое продолжение пока отключено."
            : completedJob.checkpointRecoveryAssessment?.disposition === "inspect_before_resume"
              ? "Контрольная точка не подтверждена относительно текущего проекта или журнала. Перед продолжением нужна проверка."
              : completedJob.checkpointRecoveryAssessment?.disposition === "manual_review_required"
                ? "Контрольная точка неполна или не прошла проверку целостности. Требуется ручная проверка."
                : "";
          const recoveryMessage = completedJob.recoveryAssessment?.disposition === "safe_to_restart"
            ? "Сбой прервал задачу до зафиксированных операций изменения. Её можно запустить заново."
            : completedJob.recoveryAssessment?.disposition === "inspect_before_retry"
              ? "Задача прервана после возможного изменения проекта или незавершённой команды. Сначала проверьте текущее состояние проекта; автоматический повтор отключён."
              : completedJob.recoveryAssessment?.disposition === "manual_review_required"
                ? "Задача прервана во время подтверждения или неизвестного действия. Перед повтором требуется ручная проверка."
                : "";
          setCurrentActivity([
            completedJob.error ?? completedJob.currentMessage ?? (completedJob.status === "completed" ? "Последняя задача завершена." : "Последняя задача завершилась."),
            recoveryMessage,
            checkpointMessage,
          ].filter(Boolean).join(" "));
          setАгентStage(completedJob.status === "completed" ? "completed" : "error");
          if (completedJob.productPlan) setProductPlan({
            goal: completedJob.productPlan.goal ?? "",
            productType: completedJob.productPlan.productType ?? "Product",
            pages: completedJob.productPlan.pages ?? [],
            components: completedJob.productPlan.components ?? [],
            acceptanceCriteria: completedJob.productPlan.acceptanceCriteria ?? [],
          });
          setProjectTaskMeta((items) => ({
            ...items,
            [activeПроектId]: {
              ...(items[activeПроектId] ?? { task: "Последняя задача", timestamp: completedJob.updatedAt ?? Date.now() }),
              status: completedJob.status ?? "completed",
            },
          }));
          setRightTab("agent");
          setWorkspaceMode("agent");
          return;
        }
        if (!job || cancelled || chatJobIdRef.current !== null) return;
        setAuthoritativeChatJobId(job.id);
        
        setRightTab("agent");
        setWorkspaceMode("agent");
        
        setАгентStage((job.stage as typeof agentStage) ?? "running");
        setCurrentActivity(job.currentMessage ?? "Восстанавливаю активную Agent задачу после перезагрузки.");
      } catch {
        // Reload recovery is best-effort; backend Job remains the source of truth.
      }
    }
    void restoreActiveAgentJob();
    return () => { cancelled = true; };
  }, [activeПроектId, projectsLoading]);

  useEffect(() => {
    async function loadAIConfig() {
      try {
        const [providersResponse, modelsResponse, keyStatusResponse] = await Promise.all([
          nexumRuntime.network.fetch("/api/ai/providers"),
          nexumRuntime.network.fetch("/api/ai/models"),
          nexumRuntime.network.fetch("/api/ai/key-status"),
        ]);
        if (!providersResponse.ok || !modelsResponse.ok) throw new Error(`AI config API: HTTP ${!providersResponse.ok ? providersResponse.status : modelsResponse.status}`);
        const providersData = (await providersResponse.json()) as { providers?: AIProviderInfo[] };
        const modelsData = (await modelsResponse.json()) as { models?: Record<string, string[]> };
        const keyStatusData = keyStatusResponse.ok
          ? (await keyStatusResponse.json()) as { providers?: { anymodel?: boolean } }
          : null;
        const providers = providersData.providers ?? [];
        if (keyStatusData?.providers?.anymodel) {
          setAnyModelConnectionState("connected");
          setAnyModelConnectionMessage("AnyModel подключён и готов к работе.");
        } else {
          setAnyModelConnectionState("ready");
          setAnyModelConnectionMessage("AnyModel API-ключ не подключён.");
        }
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
    if (mode === "preview" || mode === "agent" || mode === "files") { setRightTab(mode); }
  }

  async function selectПроект(projectId: string): Promise<boolean> {
    const jobIdAtSelectionStart = chatJobIdRef.current;
    setПроектActionLoading(true);
    try {
      const response = await nexumRuntime.network.fetch(`/api/projects/${projectId}/select`, { method: "POST" });
      if (!response.ok) throw new Error(`API выбора проекта: HTTP ${response.status}`);
      if (chatJobIdRef.current === jobIdAtSelectionStart) {
        setAuthoritativeChatJobId(null);
        setАгентStage(null);
      }
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
      setNewПроектDescription("");
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
      setWorkspaceMode("preview");
      return;
    }

    const failureEvidence = problems
      .slice(-5)
      .map((item) => (item.source ? item.source + ": " : "") + item.message)
      .filter(Boolean)
      .join("\n");

    const repairTask = [
      "ИСПРАВЛЕНИЕ ПОСЛЕ ОШИБКИ АГЕНТА.",
      "Не начинай новый продукт и не создавай новый Product Plan.",
      "Продолжи работу с текущим проектом и текущими файлами.",
      "Сначала изучи текущее состояние проекта и точную причину последней ошибки.",
      "Затем внеси минимальные необходимые исправления, повтори проверку/сборку и доведи задачу до завершения.",
      "Исходная задача: " + task,
      failureEvidence ? "Последние ошибки Agent:\n" + failureEvidence : "",
    ].filter(Boolean).join("\n");

    setMessage(repairTask);
    setRightTab("agent");
    setProjectMode("agent");
    setWorkspaceMode("agent");
    window.setTimeout(() => void sendMessage(repairTask), 0);
  }

  async function cancelAgent() {
    const jobId = chatJobIdRef.current;
    if (!jobId) return;
    try {
      const response = await nexumRuntime.network.fetch(`/api/chat/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
      const data = await response.json().catch(() => ({})) as { success?: boolean; job?: { status?: string; error?: string } };
      if (!response.ok || !data.success) throw new Error(data.job?.error || `Cancel API: HTTP ${response.status}`);
      // Cancellation can race with normal completion. Only publish/clear a job
      // when the server confirms the canonical terminal status is "cancelled".
      if (data.job?.status !== "cancelled") {
        if (data.job?.status === "completed" || data.job?.status === "failed") {
          setCurrentActivity(data.job.status === "completed"
            ? "Задача успела завершиться до отмены."
            : data.job.error || "Задача завершилась с ошибкой до отмены.");
        }
        return;
      }
      broadcastChatJobTerminal(jobId, activeПроектId, "cancelled");
      setАгентStage("error");
      setCurrentActivity("Agent отменён пользователем.");
      setProjectTaskMeta((items) => ({ ...items, [activeПроектId]: { ...(items[activeПроектId] ?? { task: lastMessage || "Последняя задача", timestamp: Date.now() }), status: "cancelled" } }));
      clearAuthoritativeChatJobIfOwned(jobId);
      pushOSEvent("info", "Agent cancelled", "Выполнение задачи остановлено пользователем.");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Не удалось отменить Agent");
    }
  }

  async function decideAgentApproval(decision: "approve" | "reject") {
    const jobId = chatJobIdRef.current;
    const approval = pendingApproval;
    if (!jobId || !approval || approvalActionLoading) return;
    setApprovalActionLoading(true);
    setApprovalActionError("");
    try {
      const response = await nexumRuntime.network.fetch(
        `/api/chat/jobs/${encodeURIComponent(jobId)}/approvals/${encodeURIComponent(approval.id)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) },
      );
      const data = await response.json().catch(() => ({})) as {
        success?: boolean;
        error?: string;
        job?: { pendingApproval?: AgentApprovalView };
      };
      if (data.job?.pendingApproval && data.job.pendingApproval.status !== "pending") {
        setPendingApproval(null);
        setPendingApprovalProjectId(null);
        setCurrentActivity(decision === "approve" ? "Действие подтверждено. Агент продолжает работу." : "Действие отклонено. Агент получил отказ и продолжает работу.");
      }
      if (!response.ok || !data.success) throw new Error(data.error || `Approval API: HTTP ${response.status}`);
      setPendingApproval(null);
      setPendingApprovalProjectId(null);
      setCurrentActivity(decision === "approve" ? "Подтверждение получено. Агент продолжает работу." : "Действие отклонено. Агент получил отказ.");
    } catch (error) {
      setApprovalActionError(error instanceof Error ? error.message : "Не удалось отправить решение.");
    } finally {
      setApprovalActionLoading(false);
    }
  }

  function upsertAssistantReply(jobId: string, content: string) {
    const id = `assistant-${jobId}`;
    setConversation((items) => {
      const current = items.find((item) => item.id === id);
      if (current?.content === content) return items;
      if (current) return items.map((item) => item.id === id ? { ...item, content } : item);
      return [...items, { id, role: "assistant", content, timestamp: Date.now() }];
    });
  }

  async function sendMessage(task = message, projectIdOverride?: string) {
    setPendingApproval(null);
    setPendingApprovalProjectId(null);
    setApprovalActionError("");
    const targetПроектId = projectIdOverride ?? activeПроектId;
    const agentDefinitionIdForRequest = pendingAgentProjectId === (projectIdOverride ?? activeПроектId) ? pendingAgentDefinitionId : null;
    if (!task.trim() || !targetПроектId) return;
    setLastMessage(task);
    setProjectTaskMeta((items) => ({ ...items, [targetПроектId]: { task: task.trim(), timestamp: Date.now(), status: "queued" } }));
    
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
      const targetConversation = conversationForProject(
        targetПроектId,
        conversationProjectId,
        conversation,
        localStorage,
      );
      const chatContext = targetConversation
        .slice(-8)
        .map((item) => ({ role: item.role, content: item.content.slice(0, 900) }))
        .filter((item) => item.content.trim());
      const response = await nexumRuntime.network.fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: task,
          projectId: targetПроектId,
          provider: aiProvider,
          model: aiModel,
          attachments: serializedAttachments,
          conversation: chatContext,
          ...(agentDefinitionIdForRequest ? { agentDefinitionId: agentDefinitionIdForRequest } : {}),
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

      if (agentDefinitionIdForRequest && pendingAgentDefinitionId === agentDefinitionIdForRequest) {
        setPendingAgentDefinitionId(null);
        setPendingAgentProjectId(null);
      }
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
    let terminalHandled = false;
    let reconnecting = false;
    // True from the moment the stream reports a lost connection until a fresh
    // server snapshot proves the job is reachable again. Kept separate from the
    // displayed text so a recovery snapshot cannot silently erase the notice.
    let connectionLost = false;
    let snapshotRecoveryInFlight = false;
    let lastAppliedUpdatedAt = 0;
    const activeJobId = chatJobId;
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("kvard-chat-job-sync-v1") : null;
    const source = new EventSource(`/api/chat/jobs/${encodeURIComponent(activeJobId)}/events`);

    type ChatJobSnapshot = {
      status?: "queued" | "running" | "completed" | "failed" | "cancelled";
      projectId?: string;
      updatedAt?: number;
      pendingApproval?: AgentApprovalView;
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

    async function applyJob(job: ChatJobSnapshot, shouldBroadcast = true) {
      if (cancelled || chatJobIdRef.current !== activeJobId) return;
      if (typeof job.updatedAt === "number") {
        if (job.updatedAt < lastAppliedUpdatedAt) return;
        lastAppliedUpdatedAt = job.updatedAt;
      }
      const status = job.status;
      const isTerminal = status === "completed" || status === "failed" || status === "cancelled";
      if (isTerminal && terminalHandled) return;
      if (shouldBroadcast && isTerminal) {
        broadcastChatJobTerminal(activeJobId, job.projectId ?? activeПроектId, status);
      }
      if (typeof job.reply === "string" && job.reply.length > 0) {
        setReply(job.reply);
        upsertAssistantReply(activeJobId, job.reply);
      }
      if (job.pendingApproval?.status === "pending") {
        setPendingApproval(job.pendingApproval);
        setPendingApprovalProjectId(job.projectId ?? activeПроектId);
      } else {
        setPendingApproval(null);
        setPendingApprovalProjectId(null);
      }

      if (status === "completed") {
        if (terminalHandled) return;
        terminalHandled = true;
        setProjectTaskMeta((items) => ({ ...items, [activeПроектId]: { ...(items[activeПроектId] ?? { task: lastMessage || "Последняя задача", timestamp: Date.now() }), status: "completed" } }));
        setActivitySteps(job.steps ?? []);
        setActivityEvents(job.events ?? []);
        setCurrentActivity(job.currentMessage ?? "Готово.");
        pushOSEvent("success", "Build completed", "Agent завершил задачу. Preview готовится.");
        setProblems(job.problems ?? []);
        if (job.productPlan) setProductPlan({
          goal: job.productPlan.goal ?? "",
          productType: job.productPlan.productType ?? "Product",
          pages: job.productPlan.pages ?? [],
          components: job.productPlan.components ?? [],
          acceptanceCriteria: job.productPlan.acceptanceCriteria ?? [],
        });
        setReply(job.reply ?? "");
        if (job.reply) upsertAssistantReply(activeJobId, job.reply);
        setRightTab("preview");
        setProjectMode("preview");

        let previewReady = false;
        for (let attempt = 0; attempt < 12; attempt += 1) {
          if (cancelled) return;
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
            // Continue briefly while the generated preview becomes available.
          }
          await new Promise((resolve) => window.setTimeout(resolve, 500));
        }
        if (cancelled) return;
        setПредпросмотрOnline(previewReady);
        setПредпросмотрKey((key) => key + 1);
        setАгентStage("completed");
        clearAuthoritativeChatJobIfOwned(activeJobId);
        source.close();
        return;
      }

      if (status === "cancelled") {
        if (terminalHandled) return;
        terminalHandled = true;
        setProjectTaskMeta((items) => ({ ...items, [activeПроектId]: { ...(items[activeПроектId] ?? { task: lastMessage || "Последняя задача", timestamp: Date.now() }), status: "cancelled" } }));
        setCurrentActivity(job.error ?? "Agent отменён.");
        setАгентStage("error");
        clearAuthoritativeChatJobIfOwned(activeJobId);
        source.close();
        return;
      }

      if (status === "failed") {
        if (terminalHandled) return;
        terminalHandled = true;
        setProjectTaskMeta((items) => ({ ...items, [activeПроектId]: { ...(items[activeПроектId] ?? { task: lastMessage || "Последняя задача", timestamp: Date.now() }), status: "failed" } }));
        setActivitySteps(job.steps ?? []);
        setActivityEvents(job.events ?? []);
        setProblems(job.problems ?? []);
        setCurrentActivity(job.error || job.currentMessage || "ИИ-агент завершил работу с ошибкой.");
        if (job.productPlan) setProductPlan({
          goal: job.productPlan.goal ?? "",
          productType: job.productPlan.productType ?? "Product",
          pages: job.productPlan.pages ?? [],
          components: job.productPlan.components ?? [],
          acceptanceCriteria: job.productPlan.acceptanceCriteria ?? [],
        });
        setApiError(job.error || "ИИ-агент завершил работу с ошибкой");
        setАгентStage("error");
        pushOSEvent("error", "Agent error", job.error || "Не удалось выполнить задачу");
        clearAuthoritativeChatJobIfOwned(activeJobId);
        source.close();
        return;
      }

      setActivitySteps(job.steps ?? []);
      setActivityEvents(job.events ?? []);
      // While the browser reports it is offline, a late event from a stale stream
      // must not claim the connection is back: keep the notice until it truly is.
      const browserOffline = typeof navigator !== "undefined" && navigator.onLine === false;
      if (!connectionLost) {
        setCurrentActivity(job.currentMessage ?? "ИИ выполняет задачу…");
      } else if (!browserOffline) {
        connectionLost = false;
        reconnecting = false;
        setCurrentActivity("Соединение восстановлено. Продолжаю получать обновления…");
      }
      setProblems(job.problems ?? []);
      if (job.productPlan) setProductPlan({
        goal: job.productPlan.goal ?? "",
        productType: job.productPlan.productType ?? "Product",
        pages: job.productPlan.pages ?? [],
        components: job.productPlan.components ?? [],
        acceptanceCriteria: job.productPlan.acceptanceCriteria ?? [],
      });
      setАгентStage((job.stage as typeof agentStage) ?? (status === "running" ? "running" : "thinking"));
    }

    channel?.addEventListener("message", (event: MessageEvent<{ type?: string; jobId?: string }>) => {
      if (cancelled || terminalHandled || event.data?.type !== "terminal" || event.data.jobId !== activeJobId) return;
      // Another tab changed this job. Re-read the canonical server snapshot rather
      // than trusting a cross-tab message as state or authority.
      void nexumRuntime.network.fetch(`/api/chat/jobs/${encodeURIComponent(activeJobId)}`)
        .then(async (response) => {
          if (!response.ok || cancelled) return;
          const data = await response.json() as { job?: ChatJobSnapshot };
          if (data.job) await applyJob(data.job, false);
        })
        .catch(() => undefined);
    });

    source.addEventListener("job", (event) => {
      if (cancelled) return;
      try {
        const job = JSON.parse((event as MessageEvent<string>).data) as ChatJobSnapshot;
        void applyJob(job);
      } catch (error) {
        console.error("[Nexum] Invalid ChatJob SSE event", error);
      }
    });
    source.addEventListener("unavailable", () => {
      if (cancelled || terminalHandled) return;
      connectionLost = true;
      setCurrentActivity("Связь с задачей временно недоступна. Восстанавливаю соединение…");
    });
    source.onopen = () => {
      if (cancelled || terminalHandled || !reconnecting) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      reconnecting = false;
      connectionLost = false;
      setCurrentActivity((current) =>
        current.includes("Связь с задачей временно недоступна")
          ? "Соединение восстановлено. Продолжаю получать обновления…"
          : current,
      );
    };
    source.onerror = () => {
      if (cancelled || terminalHandled) return;
      reconnecting = true;
      connectionLost = true;
      setCurrentActivity((current) =>
        current.includes("Связь с задачей временно недоступна")
          ? current
          : "Связь с задачей временно недоступна. Восстанавливаю соединение…",
      );
      // EventSource retries automatically. Recover one snapshot while reconnecting.
      recoverSnapshot();
    };

    // Recover one canonical snapshot, never overlapping REST requests on repeated
    // error/online notifications. A failed request keeps the "connection lost" notice.
    function recoverSnapshot() {
      if (snapshotRecoveryInFlight || cancelled || terminalHandled) return;
      snapshotRecoveryInFlight = true;
      void nexumRuntime.network.fetch(`/api/chat/jobs/${encodeURIComponent(activeJobId)}`)
        .then(async (response) => {
          if (!response.ok || cancelled) return;
          const data = await response.json() as { job?: ChatJobSnapshot };
          if (data.job) await applyJob(data.job);
        })
        .catch(() => undefined)
        .finally(() => {
          snapshotRecoveryInFlight = false;
        });
    }

    // Browsers can keep a dead stream open for a long time without firing onerror,
    // so the OS-level connectivity signal is surfaced to the user as well.
    const onBrowserOffline = () => {
      if (cancelled || terminalHandled) return;
      connectionLost = true;
      reconnecting = true;
      setCurrentActivity("Связь с задачей временно недоступна. Восстанавливаю соединение…");
    };
    const onBrowserOnline = () => {
      if (cancelled || terminalHandled || !connectionLost) return;
      recoverSnapshot();
    };
    window.addEventListener("offline", onBrowserOffline);
    window.addEventListener("online", onBrowserOnline);

    return () => {
      cancelled = true;
      window.removeEventListener("offline", onBrowserOffline);
      window.removeEventListener("online", onBrowserOnline);
      source.close();
      channel?.close();
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
        body: JSON.stringify({ apiKey: aiApiKey.trim(), provider: aiProvider }),
      });
      const data = await response.json().catch(() => ({})) as { success?: boolean; provider?: string; model?: string; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "Не удалось проверить API-ключ");
      const provider = data.provider || "openai";
      setAiApiKey("");
      setAIProvider(provider);
      setAIModel(data.model || aiModels[provider]?.[0] || (provider === "openai" ? "gpt-5" : provider === "anymodel" ? "gpt-6-astra" : provider === "orcarouter" ? "deepseek/deepseek-v4-flash-free" : "openrouter/free"));
      setNotice(provider === "openai" ? "OpenAI подключён — модели GPT готовы" : provider === "anymodel" ? "AnyModel подключён — модели готовы" : provider === "orcarouter" ? "OrcaRouter подключён" : "OpenRouter подключён");
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

  async function connectAnyModelKey() {
    if (!anyModelApiKey.trim()) return;
    setAnyModelApiKeyLoading(true);
    setAnyModelConnectionState("checking");
    setAnyModelConnectionMessage("Проверяю ключ AnyModel через API…");
    setApiError("");
    try {
      const response = await nexumRuntime.network.fetch("/api/ai/connect-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: anyModelApiKey.trim(), provider: "anymodel" }),
      });
      const data = await response.json().catch(() => ({})) as {
        success?: boolean;
        provider?: string;
        model?: string;
        status?: { available?: boolean; error?: string };
        error?: string;
      };
      if (!response.ok || !data.success) {
        throw new Error(data.error || data.status?.error || "Не удалось подключить AnyModel");
      }

      setAnyModelApiKey("");
      setAnyModelConnectionState("connected");
      setAnyModelConnectionMessage("AnyModel подключён и готов к работе.");
      setAIProvider("anymodel");
      setAIModel(data.model || "gpt-6-astra");
      setAIStatus(data.status ? { ...data.status, provider: "anymodel", model: data.model || "gpt-6-astra" } as AIProviderStatus : null);
      setNotice("AnyModel подключён — gpt-6-astra готов");
      window.setTimeout(() => setNotice(""), 3200);

      const modelsResponse = await nexumRuntime.network.fetch("/api/ai/models");
      if (modelsResponse.ok) {
        const modelsData = await modelsResponse.json() as { models?: Record<string, string[]> };
        setAIModels(modelsData.models ?? {});
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось подключить AnyModel";
      setAnyModelConnectionState("error");
      setAnyModelConnectionMessage(message);
      setApiError(message);
    } finally {
      setAnyModelApiKeyLoading(false);
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
    { label: "New Проект", hint: "N", run: () => openNewProject() },
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
    { label: "AI-агенты", hint: "A", run: () => setView("agents") },
    { label: "Бизнес-агенты", hint: "B", run: () => setView("business-agents") },
    { label: "Диагностика Agent", hint: "D", run: () => setView("diagnostics") },
    { label: "Настройки", hint: "", run: () => setView("settings") },
  ];

  if (!onboardingComplete || welcomeTestMode) {
    return <NexumWelcome onComplete={() => { setOnboardingComplete(true); setWelcomeTestMode(false); }} />;
  }

  return (
    <div className={"app app-" + view}>
      <Sidebar
        projects={projects}
        activeProjectId={activeПроектId}
        projectsLoading={projectsLoading}
        projectActionLoading={projectActionLoading}
        onNewProject={() => openNewProject()}
        onSelectProject={(projectId) => openПроект(projectId, "agent")}
        mobileOpen={false}
        view={view}
        onViewChange={(nextView) => navigate(nextView)}
      />
      {view !== "home" && <NexumOSEventCenter events={osEvents} onDismiss={(id) => setOsEvents((items) => items.filter((item) => item.id !== id))} />}
      {view !== "project" && view !== "home" && <NexumApplicationManager
        projectName={activeПроект?.name}
        projects={runningProjectIds.map((id) => ({ id, name: projects.find((p) => p.id === id)?.name ?? id, active: false, minimized: Boolean(projectWindowMinimizedByProject[id]) }))}
        projectModes={projectWindowModes}
        onSelectProject={(id) => openПроект(id, projectWindowModes[id] ?? "agent")}
        mode={workspaceMode}
        running={false}
        minimized={projectWindowMinimized}
        onSelectMode={setProjectMode}
        onMinimize={() => { setProjectWindowMinimizedByProject((items) => ({ ...items, [activeПроектId]: true })); }}
        onRestore={() => { setProjectWindowMinimizedByProject((items) => ({ ...items, [activeПроектId]: false })); }}
        onClose={() => { setProjectWindowMinimizedByProject((items) => ({ ...items, [activeПроектId]: false })); setRunningProjectIds((items) => items.filter((id) => id !== activeПроектId)); navigate("home"); }}
      />}
      <main className={`main nexum-os-runtime ${osBooted ? "os-booted" : "os-booting"}`}>
        {view === "business-agents" ? (
          <OSAppWindow title="Бизнес-агенты" subtitle="AI-сотрудники, знания и автоматизация" icon="✦" status="Business AI" onClose={() => navigate("home")} onMinimize={() => navigate("home")}>
            <BusinessAgentsPage />
          </OSAppWindow>
        ) : view === "agents" ? (
          <OSAppWindow title="AI-агенты" subtitle="Профили запуска и состояние Runtime" icon="◈" status="Рабочая среда" onClose={() => navigate("home")} onMinimize={() => navigate("home")}>
            <AgentsPage
              projects={projects}
              onUseProfile={(projectId, prompt) => {
                setPendingAgentDefinitionId(null);
                setPendingAgentProjectId(null);
                openПроект(projectId, "agent");
                setProjectMode("agent");
                setMessage(prompt);
                setNotice("Профиль загружен в Studio. Проверьте инструкцию и запустите задачу.");
              }}
              onUseAgent={(projectId, agentId, task) => {
                setPendingAgentDefinitionId(agentId);
                setPendingAgentProjectId(projectId);
                openПроект(projectId, "agent");
                setProjectMode("agent");
                setMessage(task);
                setNotice("Агент выбран. Проверьте задачу в Studio и отправьте её: сервер применит его системную инструкцию и список разрешённых инструментов.");
              }}
              onCreateProject={(description) => openNewProject(description)}
            />
          </OSAppWindow>
        ) : view === "diagnostics" ? (
          <OSAppWindow title="Диагностика" subtitle="Системное состояние и события" icon="⌁" status="Система готова" onClose={() => navigate("home")} onMinimize={() => navigate("home")}>
            <DiagnosticsPage />
          </OSAppWindow>
        ) : view === "home" ? (
          <BuilderHome
            projects={projects}
            onNewProject={(description) => openNewProject(description)}
            onOpenProject={(id, tab) => openПроект(id, tab)}
            onOpenView={(next) => navigate(next)}
          />
        ) : view === "news" ? (
          <OSAppWindow title="Журнал КВАРД" subtitle="Новости и системные обновления" icon="✦" status="Актуально" onClose={() => navigate("home")} onMinimize={() => navigate("home")}>
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
                <h1>Настройки</h1>
                <p>Тема, масштаб интерфейса, модели, проекты и уведомления.</p>
              </div>
            </div>

            <div className="settings-layout">
              <aside className="settings-index">
                <span>Разделы</span>
                <a href="#settings-interface">Интерфейс</a>
                <a href="#settings-ai">AI-провайдеры</a>
                <a href="#settings-projects">Проекты</a>
                <a href="#settings-notifications">Уведомления</a>
                <a href="#settings-shortcuts">Горячие клавиши</a>
                <a href="#settings-storage">Хранилище</a>
                <a href="#settings-api">Доступ к API</a>
              </aside>

              <div className="settings-content">
                <section id="settings-interface" className="settings-section">
                  <div className="settings-section-head">
                    
                    <div><h2>Интерфейс</h2><p>Масштаб, плотность и движение интерфейса.</p></div>
                  </div>
                  <div className="settings-card settings-card-wide kvard-theme-card">
                    <strong>Цветовая тема</strong>
                    <span>{theme === "light" ? "Светлая тема" : "Тёмная тема"}</span>
                    <small>Выберите оформление рабочего пространства. Настройка сохраняется на этом устройстве.</small>
                    <div className="settings-option-row kvard-theme-options" role="group" aria-label="Цветовая тема">
                      <button type="button" className={theme === "light" ? "selected" : ""} aria-pressed={theme === "light"} onClick={() => setTheme("light")}>Светлая</button>
                      <button type="button" className={theme === "dark" ? "selected" : ""} aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>Тёмная</button>
                    </div>
                  </div>
                  <div className="settings-card settings-card-wide">
                    <strong>Масштаб интерфейса</strong>
                    <span>{uiSettings.scale}% · оптимизировано для HiDPI</span>
                    <small>100% — базовый режим. 110% увеличивает читаемость на плотных экранах.</small>
                    <div className="settings-scale-group">
                      {[90, 100, 110].map((scale) => (
                        <button key={scale} type="button" className={uiSettings.scale === scale ? "selected" : ""} aria-pressed={uiSettings.scale === scale} onClick={() => setUiSettings((state) => ({ ...state, scale }))}>{scale}%</button>
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
                        <button type="button" aria-label="Компактный режим" aria-pressed={uiSettings.compact} className={`nexum-toggle ${uiSettings.compact ? "on" : ""}`} onClick={() => setUiSettings((state) => ({ ...state, compact: !state.compact }))} />
                      </div>
                    </div>
                    <div className="settings-card">
                      <strong>Движение</strong>
                      <span>{uiSettings.animations ? "Плавные переходы" : "Минимум движения"}</span>
                      <small>Только функциональная анимация без постоянного декоративного свечения.</small>
                      <div className="settings-option-row">
                        <div className="settings-option-copy"><b>Анимации</b><span>120–220 ms</span></div>
                        <button type="button" aria-label="Анимации" aria-pressed={uiSettings.animations} className={`nexum-toggle ${uiSettings.animations ? "on" : ""}`} onClick={() => setUiSettings((state) => ({ ...state, animations: !state.animations }))} />
                      </div>
                    </div>
                  </div>
                </section>

                <section id="settings-ai" className="settings-section">
                  <div className="settings-section-head">
                    
                    <div><h2>AI-провайдеры</h2><p>Провайдер, модель и ключи доступа.</p></div>
                  </div>
                  <div className="settings-grid">
                    <div className="settings-card settings-card-wide">
                      <strong>AI-провайдер</strong>
                      <span>{aiProviders.length ? "Выберите маршрут, который будет использовать Agent." : "Загрузка списка провайдеров…"}</span>
                      <div className="settings-api-row">
                        <select
                          aria-label="AI-провайдер"
                          value={aiProvider}
                          disabled={!aiProviders.length || aiApiKeyLoading}
                          onChange={(event) => selectAIProvider(event.target.value)}
                        >
                          {aiProviders.map((provider) => (
                            <option key={provider.id} value={provider.id}>{provider.name}</option>
                          ))}
                        </select>
                        <select
                          aria-label="AI-модель"
                          value={aiModel}
                          disabled={!aiProvider || aiApiKeyLoading}
                          onChange={(event) => setAIModel(event.target.value)}
                        >
                          {(aiModels[aiProvider] ?? [aiModel]).map((model) => (
                            <option key={model} value={model}>{model}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="settings-card">
                      <strong>Активная модель</strong>
                      <span>{aiProvider} · {aiModel}</span>
                      <small>Текущий маршрут AI Agent.</small>
                    </div>
                    <div className="settings-card">
                      <strong>Статус</strong>
                      <span className={aiStatus?.available ? "settings-status-ok" : "settings-status-muted"}>{aiStatus?.available ? "Подключено" : "Ожидание подключения"}</span>
                      <small>{aiStatus?.error || "КВАРД проверяет доступность выбранной модели."}</small>
                    </div>
                  </div>
                </section>

                <section id="settings-projects" className="settings-section">
                  <div className="settings-section-head">
                    
                    <div><h2>Проекты</h2><p>Поведение Builder и Preview.</p></div>
                  </div>
                  <div className="settings-grid">
                    <div className="settings-card">
                      <strong>Предпросмотр</strong>
                      <span>{uiSettings.autoПредпросмотр ? "Автообновление" : "Ручное обновление"}</span>
                      <small>Обновлять Preview после успешной работы Agent.</small>
                      <div className="settings-option-row">
                        <div className="settings-option-copy"><b>Автопредпросмотр</b><span>Обновлять после сборки</span></div>
                        <button type="button" aria-label="Автоматически обновлять предпросмотр" aria-pressed={uiSettings.autoПредпросмотр} className={`nexum-toggle ${uiSettings.autoПредпросмотр ? "on" : ""}`} onClick={() => setUiSettings((state) => ({ ...state, autoПредпросмотр: !state.autoПредпросмотр }))} />
                      </div>
                    </div>
                    <div className="settings-card"><strong>Активные проекты</strong><span>{projects.filter((project) => project.status === "active").length} проектов</span><small>Каждый проект хранит собственные файлы, Preview и контекст.</small></div>
                  </div>
                </section>

                <section id="settings-notifications" className="settings-section">
                  <div className="settings-section-head"><div><h2>Уведомления</h2><p>Только полезные сигналы от Agent.</p></div></div>
                  <div className="settings-card settings-card-wide">
                    <strong>Звук завершения</strong><span>{uiSettings.sound ? "Включён" : "Выключен"}</span><small>Сигнал при завершении или ошибке Agent.</small>
                    <div className="settings-option-row">
                      <div className="settings-option-copy"><b>Уведомлять звуком</b><span>Без визуального шума</span></div>
                      <button type="button" aria-label="Звук завершения задачи" aria-pressed={uiSettings.sound} className={`nexum-toggle ${uiSettings.sound ? "on" : ""}`} onClick={() => setUiSettings((state) => ({ ...state, sound: !state.sound }))} />
                    </div>
                  </div>
                </section>

                <section id="settings-shortcuts" className="settings-section">
                  <div className="settings-section-head"><div><h2>Горячие клавиши</h2><p>Быстрый доступ к рабочему пространству.</p></div></div>
                  <div className="settings-card settings-card-wide settings-shortcuts">
                    <div><strong>Палитра команд</strong><small>Открыть палитру команд</small></div>
                    <kbd>⌘ K</kbd>
                    <div><strong>Навигация</strong><small>Ctrl / Command + K поддерживается</small></div>
                  </div>
                </section>

                <section id="settings-storage" className="settings-section">
                  <div className="settings-section-head"><div><h2>Хранилище</h2><p>Данные проектов и локальные настройки.</p></div></div>
                  <div className="settings-card settings-card-wide">
                    <strong>Локальное состояние</strong><span>{projects.length} проектов загружено</span>
                    <small>Настройки интерфейса и история чатов сохраняются локально. Секретные ключи не встраиваются в клиентский bundle.</small>
                  </div>
                </section>

                <section id="settings-api" className="settings-section">
                  <div className="settings-section-head"><div><h2>Доступ к API</h2><p>Подключение внешних AI-моделей.</p></div></div>
                  <div className="settings-card settings-card-wide anymodel-api-card">
                    <div className="anymodel-api-head">
                      <div>
                        <strong>AnyModel API</strong>
                        <span>GPT-6 Astra · прямое подключение</span>
                      </div>
                      <div className={"anymodel-connection-sensor " + anyModelConnectionState} role="status" aria-live="polite">
                        <span className="anymodel-connection-dot" />
                        <span>
                          {anyModelConnectionState === "connected" ? "Подключено"
                            : anyModelConnectionState === "checking" ? "Проверяю…"
                            : anyModelConnectionState === "error" ? "Не подключено"
                            : anyModelApiKey ? "Ключ введён" : "Не подключено"}
                        </span>
                      </div>
                    </div>
                    <small>{anyModelConnectionMessage}</small>
                    <div className="settings-api-row">
                      <input
                        type="password"
                        value={anyModelApiKey}
                        onChange={(event) => {
                          const value = event.target.value;
                          setAnyModelApiKey(value);
                          if (!value.trim()) {
                            setAnyModelConnectionState("ready");
                            setAnyModelConnectionMessage("Введите AnyModel API-ключ для проверки.");
                          } else if (anyModelConnectionState === "connected") {
                            setAnyModelConnectionState("ready");
                            setAnyModelConnectionMessage("Ключ изменён — подключение нужно проверить заново.");
                          } else {
                            setAnyModelConnectionState("ready");
                            setAnyModelConnectionMessage("Ключ введён. Нажмите «Подключить AnyModel» для реальной проверки.");
                          }
                          setApiError("");
                        }}
                        placeholder="Вставьте AnyModel API key"
                        autoComplete="off"
                        aria-label="AnyModel API key"
                      />
                      <button type="button" className="home-primary" disabled={anyModelApiKeyLoading || !anyModelApiKey.trim()} onClick={() => void connectAnyModelKey()}>
                        {anyModelApiKeyLoading ? "Проверяю AnyModel…" : "Подключить AnyModel"}
                      </button>
                    </div>
                    <small>После проверки индикатор станет зелёным. Ключ не вшивается в web bundle.</small>
                  </div>
                  <div className="settings-card settings-card-wide">
                    <strong>Другой AI-провайдер</strong>
                    <span>{aiProvider} · {aiModel}</span>
                    <small>Для OpenAI / OpenRouter / Ollama и других маршрутов используйте общий API-доступ.</small>
                    <div className="settings-api-row">
                      <input type="password" value={aiApiKey} onChange={(event) => setAiApiKey(event.target.value)} placeholder="API-ключ выбранного провайдера" autoComplete="off" />
                      <button type="button" className="home-primary" disabled={aiApiKeyLoading || !aiApiKey.trim()} onClick={() => void connectAIKey()}>{aiApiKeyLoading ? "Проверяю…" : "Подключить"}</button>
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
        <BuilderShell
          projectName={activeПроект?.name ?? "КВАРД"}
          activeTool={codeMode ? "code" : rightTab}
          previewOnline={previewOnline}
          agentStage={agentStage}
          onToolChange={(tool) => {
            if (tool === "code") { setCodeMode(true); setProjectMode("code"); return; }
            setCodeMode(false); setRightTab(tool as "preview" | "files" | "agent");
            setProjectMode(tool);
          }}
          onClose={() => { setRunningProjectIds((items) => items.filter((id) => id !== activeПроектId)); navigate("home"); }}
          onConnect={() => setConnectorModal("Интеграция проекта")}
          onShare={async () => {
            const url = window.location.origin + "/api/preview/" + activeПроектId + "/index.html";
            try { await navigator.clipboard.writeText(url); setNotice("Ссылка на Preview скопирована для текущей авторизованной сессии"); } catch { setNotice(url); }
          }}
          onOpenPreview={() => { window.open("/api/preview/" + activeПроектId + "/index.html", "_blank", "noopener,noreferrer"); setNotice("Предпросмотр открыт в новой вкладке"); }}
        >
          {pendingApproval && pendingApprovalProjectId === activeПроектId && (
            <AgentApprovalPanel
              approval={pendingApproval}
              loading={approvalActionLoading}
              error={approvalActionError}
              onDecision={(decision) => void decideAgentApproval(decision)}
            />
          )}
          {codeMode ? (
            <BuilderCode projectId={activeПроектId} projectName={activeПроект?.name ?? "КВАРД"} previewOnline={previewOnline}
              onRefresh={() => setПредпросмотрKey((key) => key + 1)} onClose={() => { setCodeMode(false); setProjectMode("files"); }} />
          ) : (
            <div className="nx-builder-grid">
              <BuilderChat
                projectName={activeПроект?.name ?? "КВАРД"} providers={aiProviders} models={selectedModels} provider={aiProvider} model={aiModel}
                aiStatus={aiStatus} message={message} reply={reply} stage={agentStage} apiError={apiError} jobId={chatJobId}
                activitySteps={activitySteps} activityEvents={activityEvents} currentActivity={currentActivity}
                messages={conversation} attachments={pendingAttachments}
                onMessageChange={setMessage} onSubmit={() => void sendMessage()} onCancel={() => void cancelAgent()}
                onRetry={() => void sendMessage(lastMessage)} onQuickTask={runTask}
                onFilesSelected={(files) => setPendingAttachments((items) => [...items, ...files.map((file) => ({ id: `${file.name}-${file.size}-${file.lastModified}`, name: file.name, type: file.type, size: file.size, file }))].slice(-5))}
                onRemoveAttachment={(id) => setPendingAttachments((items) => items.filter((item) => item.id !== id))}
                onOpenAgent={() => { setRightTab("agent"); setProjectMode("agent"); }}
                onProviderChange={selectAIProvider} onModelChange={setAIModel}
              />
              <BuilderTools
                tab={rightTab} projectName={activeПроект?.name ?? "КВАРД"} projectId={activeПроектId}
                previewOnline={previewOnline} previewKey={previewKey} stage={agentStage} jobId={chatJobId}
                activitySteps={activitySteps} activityEvents={activityEvents} currentActivity={currentActivity}
                problems={problems} productPlan={productPlan}
                onTabChange={(tab) => { setRightTab(tab); setProjectMode(tab); }}
                onRefresh={() => setПредпросмотрKey((key) => key + 1)} onRepair={repairLastTask} onOpenAgent={() => { setProjectMode("agent"); }}
              />
            </div>
          )}
        </BuilderShell>
        )}
      </main>
      <CommandPalette key={paletteOpen ? "open" : "closed"} open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} />
      <NewProjectModal
        open={modalOpen}
        name={newПроектName}
        description={newПроектDescription}
        loading={projectActionLoading}
        error={projectCreationError}
        onNameChange={setNewПроектName}
        onDescriptionChange={setNewПроектDescription}
        onClose={() => { setProjectCreationError(""); setModalOpen(false); setNewПроектDescription(""); }}
        onSubmit={(data) => void createПроект(data)}
      />
      {connectorModal && <ConnectorModal name={connectorModal} onClose={() => setConnectorModal(null)} />}
      {notice && <KvardToast className="toast" tone="info">{notice}</KvardToast>}
    </div>
  );
}

export default function App() {
  const path = window.location.pathname;
  if (path === "/admin" || path.startsWith("/admin/")) {
    return <AuthGate><AdminControlCenter /></AuthGate>;
  }
  return <WorkspaceApp />;
}