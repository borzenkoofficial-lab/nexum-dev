import "./App.css";
import { useEffect, useState } from "react";
import { BottomPanel } from "./components/BottomPanel";
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
  const [apiError, setApiError] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [aiProviders, setAIProviders] = useState<AIProviderInfo[]>([]);
  const [aiModels, setAIModels] = useState<Record<string, string[]>>({});
  const [aiProvider, setAIProvider] = useState("mock");
  const [aiModel, setAIModel] = useState("mock-v1");
  const [aiStatus, setAIStatus] = useState<AIProviderStatus | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
  const [rightTab, setRightTab] = useState<"preview" | "terminal">("preview");
  const [notice, setNotice] = useState("");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [previewOnline, setPreviewOnline] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [builderStarted, setBuilderStarted] = useState(false);

  const activeProject = projects.find((project) => project.id === activeProjectId);
  const selectedModels = aiModels[aiProvider] ?? [];

  async function loadProjects(preferredId = activeProjectId) {
    setProjectsLoading(true);
    try {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Projects request failed");
      const data = (await response.json()) as { projects?: Project[] };
      const nextProjects = data.projects ?? [];
      const preferred = nextProjects.find((project) => project.id === preferredId && project.status === "active");
      const fallback = nextProjects.find((project) => project.id === "nexum" && project.status === "active")
        ?? nextProjects.find((project) => project.status === "active");
      setProjects(nextProjects);
      setActiveProjectId(preferred?.id ?? fallback?.id ?? "nexum");
      setApiError(false);
    } catch {
      setApiError(true);
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
        if (!providersResponse.ok || !modelsResponse.ok) throw new Error("AI config unavailable");
        const providersData = (await providersResponse.json()) as { providers?: AIProviderInfo[] };
        const modelsData = (await modelsResponse.json()) as { models?: Record<string, string[]> };
        const providers = providersData.providers ?? [];
        const defaultProvider = providers.find((provider) => provider.isDefault) ?? providers[0];
        setAIProviders(providers);
        setAIModels(modelsData.models ?? {});
        if (defaultProvider) { setAIProvider(defaultProvider.id); setAIModel(defaultProvider.model); }
      } catch {
        setApiError(true);
      }
    }
    void loadAIConfig();
  }, []);

  useEffect(() => {
    if (!aiProvider) return;
    let cancelled = false;
    async function refreshAIStatus() {
      try {
        const response = await fetch(`/api/ai/status?provider=${encodeURIComponent(aiProvider)}`);
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

  async function selectProject(projectId: string) {
    setProjectActionLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/select`, { method: "POST" });
      if (!response.ok) throw new Error("Project selection failed");
      setActiveProjectId(projectId);
      setReply("");
      await loadProjects(projectId);
    } catch {
      setApiError(true);
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
      if (!response.ok) throw new Error("Project creation failed");
      const data = (await response.json()) as { project: Project };
      await selectProject(data.project.id);
      setNewProjectName("");
      setModalOpen(false);
    } catch {
      setApiError(true);
    } finally {
      setProjectActionLoading(false);
    }
  }

  async function sendMessage(task = message) {
    if (!task.trim() || !activeProjectId) return;
    setMessage(task);
    setLastMessage(task);
    setBuilderStarted(true);
    setRightTab("preview");
    setAgentStage("thinking");
    setReply("");
    setApiError(false);
    const runningTimer = window.setTimeout(() => setAgentStage("running"), 450);
    const buildingTimer = window.setTimeout(() => setAgentStage("building"), 1400);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: task, projectId: activeProjectId, provider: aiProvider, model: aiModel }),
      });
      if (!response.ok) throw new Error("API request failed");
      const data = (await response.json()) as {
        reply?: string;
        error?: string;
        steps?: Array<{ tool?: string; success?: boolean }>;
      };
      if (data.error) throw new Error(data.error);
      setReply(data.reply ?? "");
      setPreviewKey((key) => key + 1);
    } catch {
      setApiError(true);
    } finally {
      window.clearTimeout(runningTimer);
      window.clearTimeout(buildingTimer);
      setAgentStage(null);
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

  function showPlaceholder(label: string) {
    setNotice(`${label} is not connected yet`);
    window.setTimeout(() => setNotice(""), 3200);
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
    { label: "Open Terminal", hint: "T", run: () => setBottomPanelOpen(true) },
    { label: "Run Tests", hint: "T", run: () => runTask("Запусти тесты в изолированной среде") },
    { label: "Run Build", hint: "B", run: () => runTask("Проверь сборку проекта") },
    { label: "Git Status", hint: "G", run: () => runTask("Покажи статус Git") },
    { label: "Git Diff", hint: "D", run: () => runTask("Что изменилось?") },
    { label: "Start Preview", hint: "P", run: () => showPlaceholder("Start Preview") },
    { label: "Restart Preview", hint: "R", run: () => showPlaceholder("Restart Preview") },
    { label: "Ask AI", hint: "A", run: () => focusTask() },
    { label: "Switch Model", hint: "M", run: () => document.querySelector<HTMLSelectElement>("select[aria-label='AI model']")?.focus() },
    { label: "Settings", hint: "", run: () => showPlaceholder("Settings") },
  ];

  return (
    <div className="app">
      <Sidebar projects={projects} activeProjectId={activeProjectId} projectsLoading={projectsLoading} projectActionLoading={projectActionLoading} mobileOpen={mobileSidebarOpen} onNewProject={() => { setMobileSidebarOpen(false); setModalOpen(true); }} onSelectProject={(id) => { setMobileSidebarOpen(false); void selectProject(id); }} />
      <main className="main">
        <TopBar projectName={activeProject?.name ?? "NEXUM"} providers={aiProviders} models={selectedModels} provider={aiProvider} model={aiModel} ollamaStatus={ollamaStatus} stage={agentStage} onProviderChange={selectAIProvider} onModelChange={setAIModel} onToggleSidebar={() => setMobileSidebarOpen((open) => !open)} />
        <div className={`workspace ${builderStarted ? "builder-started" : "builder-idle"}`}>
          <div className="main-column">
            <ChatPanel message={message} reply={reply} stage={agentStage} apiError={apiError} onMessageChange={setMessage} onSubmit={() => void sendMessage()} onRetry={() => void sendMessage(lastMessage)} onQuickTask={runTask} />
            <QuickActions onNewProject={() => setModalOpen(true)} onOpenProject={openProjectPicker} onAsk={() => focusTask()} onTask={runTask} onPlaceholder={showPlaceholder} />
          </div>
          <RightPanel tab={rightTab} onTabChange={setRightTab} onOpenTerminal={() => setBottomPanelOpen(true)} projectName={activeProject?.name ?? "NEXUM"} projectId={activeProjectId} previewOnline={previewOnline} previewKey={previewKey} onRefreshPreview={() => setPreviewKey((key) => key + 1)} />
        </div>
      </main>
      <BottomPanel open={bottomPanelOpen} onClose={() => setBottomPanelOpen(false)} />
      <StatusBar projectName={activeProject?.name ?? "NEXUM"} provider={aiProvider} aiStatus={aiStatus} previewOnline={previewOnline} onOpenTerminal={() => setBottomPanelOpen(true)} />
      <CommandPalette key={paletteOpen ? "open" : "closed"} open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} />
      <NewProjectModal open={modalOpen} name={newProjectName} loading={projectActionLoading} onNameChange={setNewProjectName} onClose={() => setModalOpen(false)} onSubmit={(event) => void createProject(event)} />
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}

export default App;
