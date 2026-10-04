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
      : nextView === "news" ? "/news"
      : nextView === "diagnostics" ? "/diagnostics" : "/projects";
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

  // Remaining App implementation is intentionally preserved from the current branch.
