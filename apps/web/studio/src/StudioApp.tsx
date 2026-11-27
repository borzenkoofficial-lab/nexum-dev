import { useCallback, useEffect, useState } from "react";
import { nexumRuntime } from "../../src/runtime/Runtime";
import { KvardMark } from "../../src/components/KvardMark.ts";
import { JobChanges } from "../../src/components/JobChanges";
import { ProjectChecks } from "../../src/components/ProjectChecks";
import { KvardEmptyState } from "../../src/components/ui/index.ts";
import { AgentPanel } from "./AgentPanel";
import { EditorPane } from "./EditorPane";
import { FileTree } from "./FileTree";
import { clampPane, isTerminal, PANE_LIMITS, type JobSnapshot } from "./model.ts";

interface ProjectSummary { id: string; name: string }
type Tab = "editor" | "preview" | "changes" | "checks";
type MobilePane = "files" | "work" | "agent";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "editor", label: "Редактор" },
  { id: "preview", label: "Предпросмотр" },
  { id: "changes", label: "Изменения" },
  { id: "checks", label: "Проверки" },
];

function readStored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStored(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* per-viewer convenience only */ }
}

function Separator({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (next: number) => void }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className="st-separator"
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") { event.preventDefault(); onChange(value - 16); }
        if (event.key === "ArrowRight") { event.preventDefault(); onChange(value + 16); }
      }}
      onPointerDown={(event) => {
        const startX = event.clientX;
        const start = value;
        const target = event.currentTarget;
        target.setPointerCapture(event.pointerId);
        const move = (moveEvent: PointerEvent) => onChange(start + (moveEvent.clientX - startX));
        const up = () => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); };
        target.addEventListener("pointermove", move);
        target.addEventListener("pointerup", up);
      }}
    />
  );
}

export function StudioApp() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(() => readStored("kvard:studio:project"));
  const [files, setFiles] = useState<string[]>([]);
  const [filesKey, setFilesKey] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("editor");
  const [mobilePane, setMobilePane] = useState<MobilePane>("work");
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [filesWidth, setFilesWidth] = useState(() => clampPane("files", Number(readStored("kvard:studio:files-width") ?? PANE_LIMITS.files.initial)));
  const [agentWidth, setAgentWidth] = useState(() => clampPane("agent", Number(readStored("kvard:studio:agent-width") ?? PANE_LIMITS.agent.initial)));

  useEffect(() => { writeStored("kvard:studio:files-width", String(filesWidth)); }, [filesWidth]);
  useEffect(() => { writeStored("kvard:studio:agent-width", String(agentWidth)); }, [agentWidth]);

  useEffect(() => {
    const controller = new AbortController();
    void nexumRuntime.network.fetch("/api/projects", { signal: controller.signal, dedupe: false, operation: "studio-projects" })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { projects?: ProjectSummary[]; error?: string } | null;
        if (!response.ok || !Array.isArray(body?.projects)) throw new Error(body?.error ?? `HTTP ${response.status}`);
        setProjects(body.projects);
        setProjectId((current) => (current && body.projects!.some((item) => item.id === current) ? current : body.projects![0]?.id ?? null));
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Не удалось загрузить проекты."); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!projectId) return;
    writeStored("kvard:studio:project", projectId);
    const controller = new AbortController();
    void nexumRuntime.network.fetch(`/api/projects/${encodeURIComponent(projectId)}/files`, { signal: controller.signal, dedupe: false, operation: "studio-files" })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { files?: string[] } | null;
        if (!controller.signal.aborted) setFiles(Array.isArray(body?.files) ? body.files : []);
      })
      .catch(() => { if (!controller.signal.aborted) setFiles([]); });
    return () => controller.abort();
  }, [projectId, filesKey]);

  const switchProject = (id: string) => {
    setProjectId(id);
    setSelected(null);
    setJobId(null);
    setJob(null);
  };

  async function createProject() {
    const name = window.prompt("Название нового проекта");
    if (!name?.trim()) return;
    const response = await nexumRuntime.network.fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), type: "static" }), retries: 0, operation: "studio-create" });
    const body = await response.json().catch(() => null) as { project?: ProjectSummary; error?: string } | null;
    if (!response.ok || !body?.project) { setLoadError(body?.error ?? "Не удалось создать проект."); return; }
    setProjects((current) => [...(current ?? []), body.project!]);
    switchProject(body.project.id);
  }

  const onJobUpdate = useCallback((snapshot: JobSnapshot) => {
    setJob(snapshot);
    if (isTerminal(snapshot.status)) {
      // The Agent may have created/changed files: refresh the tree, the open file and the preview.
      setFilesKey((value) => value + 1);
      setPreviewRevision((value) => value + 1);
    }
  }, []);

  if (loadError && !projects) return <main className="st-center"><KvardEmptyState title="Studio недоступна" description={loadError} /></main>;
  if (!projects) return <main className="st-center" aria-busy="true"><p className="st-muted">Загружаю проекты…</p></main>;

  const agentBusy = Boolean(job && !isTerminal(job.status));
  return (
    <div className="st-root" data-mobile-pane={mobilePane}>
      <header className="st-topbar">
        <KvardMark size={22} />
        <strong className="st-brand">KVARD Studio</strong>
        <label className="st-project">
          <span className="st-visually-hidden">Проект</span>
          <select value={projectId ?? ""} onChange={(event) => switchProject(event.target.value)}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => void createProject()}>Новый проект</button>
        <a className="st-platform-link" href="/">Платформа</a>
      </header>
      <nav className="st-mobile-tabs" aria-label="Панели Studio">
        {(["files", "work", "agent"] as const).map((pane) => (
          <button key={pane} type="button" aria-pressed={mobilePane === pane} onClick={() => setMobilePane(pane)}>{pane === "files" ? "Файлы" : pane === "work" ? "Работа" : "Агент"}</button>
        ))}
      </nav>
      {!projectId ? (
        <main className="st-center"><KvardEmptyState title="Проектов пока нет" description="Создайте проект, чтобы начать." action={<button type="button" onClick={() => void createProject()}>Новый проект</button>} /></main>
      ) : (
        <div className="st-layout" style={{ gridTemplateColumns: `${filesWidth}px 6px minmax(0, 1fr) 6px ${agentWidth}px` }}>
          <aside className="st-files" aria-label="Файлы">
            <header className="st-pane-head"><strong>Файлы</strong><button type="button" className="st-icon-button" aria-label="Обновить список файлов" onClick={() => setFilesKey((value) => value + 1)}>↻</button></header>
            <FileTree key={projectId} files={files} selected={selected} onOpen={(path) => { setSelected(path); setTab("editor"); setMobilePane("work"); }} />
          </aside>
          <Separator label="Ширина панели файлов" value={filesWidth} min={PANE_LIMITS.files.min} max={PANE_LIMITS.files.max} onChange={(next) => setFilesWidth(clampPane("files", next))} />
          <main className="st-work">
            <div className="st-tabs" role="tablist" aria-label="Рабочая область">
              {TABS.map((item) => (
                <button key={item.id} role="tab" type="button" id={`st-tab-${item.id}`} aria-selected={tab === item.id} aria-controls="st-tabpanel" tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)}>{item.label}</button>
              ))}
            </div>
            <div id="st-tabpanel" role="tabpanel" aria-labelledby={`st-tab-${tab}`} className="st-tabpanel">
              {tab === "editor" && <EditorPane projectId={projectId} path={selected} reloadKey={filesKey} onSaved={() => setPreviewRevision((value) => value + 1)} />}
              {tab === "preview" && (
                <div className="st-preview">
                  <div className="st-editor-head"><span className="st-muted">Предпросмотр проекта</span><button type="button" onClick={() => setPreviewRevision((value) => value + 1)}>Обновить</button></div>
                  <iframe title="Предпросмотр проекта" src={`/api/preview/${encodeURIComponent(projectId)}/index.html?v=${previewRevision}`} />
                </div>
              )}
              {tab === "changes" && (jobId ? <JobChanges key={jobId} jobId={jobId} stage={job?.stage ?? null} eventCount={job?.events.length ?? 0} /> : <KvardEmptyState title="Изменений пока нет" description="Здесь появятся файлы, которые изменит задача агента." />)}
              {tab === "checks" && <ProjectChecks key={projectId} projectId={projectId} agentBusy={agentBusy} />}
            </div>
          </main>
          <Separator label="Ширина панели агента" value={agentWidth} min={PANE_LIMITS.agent.min} max={PANE_LIMITS.agent.max} onChange={(next) => setAgentWidth(clampPane("agent", agentWidth + (agentWidth - next)))} />
          <AgentPanel key={projectId} projectId={projectId} jobId={jobId} onJobStarted={(id) => { setJobId(id); setJob(null); }} onJobUpdate={onJobUpdate} />
        </div>
      )}
    </div>
  );
}
