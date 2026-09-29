import { useEffect, useRef, useState, type ReactNode } from "react";
import { BottomPanel as AgentActivityPanel } from "./BottomPanel";
import type { AgentStage } from "./types";

interface RightPanelProps {
  tab: "preview" | "files" | "agent";
  onTabChange: (tab: "preview" | "files" | "agent") => void;
  jobId: string | null;
  stage: AgentStage;
  activitySteps: Array<{ iteration: number; tool: string; success: boolean }>;
  activityEvents: Array<{ id: number; timestamp: number; iteration: number; type: string; tool?: string; message: string }>;
  currentActivity: string;
  problems: Array<{ message: string; source?: string }>;
  productPlan: {
    goal: string;
    productType: string;
    pages: string[];
    components: string[];
    acceptanceCriteria: string[];
  } | null;
  projectName: string;
  projectId: string;
  previewOnline: boolean;
  previewKey: number;
  onRefreshPreview: () => void;
  onRepair?: () => void;
}

export function RightPanel({ tab, onTabChange, projectName, projectId, previewOnline, previewKey, onRefreshPreview, onRepair, jobId, stage, activitySteps, activityEvents, currentActivity, problems, productPlan }: RightPanelProps) {
  const previewUrl = projectId ? `/api/preview/${projectId}/index.html?v=${previewKey}` : "";
  const [files, setFiles] = useState<string[]>([]);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [selectedFile, setSelectedFile] = useState("");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [editorLoading, setEditorLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);\n  const touchStartX = useRef<number | null>(null);\n  const touchDeltaX = useRef(0);\n  const swipeSurfaceRef = useRef<HTMLElement | null>(null);\n\n  function handleTouchStart(event: React.TouchEvent<HTMLElement>) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
    touchDeltaX.current = 0;
    swipeSurfaceRef.current = event.currentTarget;
    event.currentTarget.classList.add("mobile-swipe-active");
  }

  function handleTouchMove(event: React.TouchEvent<HTMLElement>) {
    const start = touchStartX.current;
    const surface = swipeSurfaceRef.current;
    const point = event.touches[0];
    if (start == null || !surface || !point) return;
    const raw = point.clientX - start;
    const delta = Math.max(-120, Math.min(120, raw * 0.72));
    touchDeltaX.current = raw;
    surface.style.setProperty("--mobile-swipe-delta", `${delta}px`);
    surface.style.setProperty("--mobile-swipe-progress", String(Math.min(1, Math.abs(raw) / 180)));
    surface.classList.add("mobile-swipe-dragging");
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLElement>) {
    const start = touchStartX.current;
    const surface = swipeSurfaceRef.current;
    const end = event.changedTouches[0]?.clientX;
    const delta = end != null && start != null ? end - start : touchDeltaX.current;
    touchStartX.current = null;
    touchDeltaX.current = 0;
    if (surface) {
      surface.classList.remove("mobile-swipe-active", "mobile-swipe-dragging");
      surface.style.removeProperty("--mobile-swipe-delta");
      surface.style.removeProperty("--mobile-swipe-progress");
    }
    if (Math.abs(delta) < 64) return;
    const tabs = ["agent", "preview", "files"] as const;
    const index = tabs.indexOf(tab);
    if (delta < 0) onTabChange(tabs[(index + 1) % tabs.length]);
    else onTabChange(tabs[(index - 1 + tabs.length) % tabs.length]);
  }

  useEffect(() => {
    if (tab !== "files" || !projectId) return;
    let cancelled = false;
    setFilesLoading(true); setFileError("");
    fetch(`/api/projects/${encodeURIComponent(projectId)}/files`)
      .then(async (response) => { const data = await response.json().catch(() => ({})) as { files?: string[]; error?: string }; if (!response.ok) throw new Error(data.error || `Files API: HTTP ${response.status}`); if (!cancelled) setFiles(data.files ?? []); })
      .catch((error) => { if (!cancelled) setFileError(error instanceof Error ? error.message : "Не удалось загрузить файлы"); })
      .finally(() => { if (!cancelled) setFilesLoading(false); });
    return () => { cancelled = true; };
  }, [tab, projectId, previewKey]);

  async function openFile(path: string) {
    setSelectedFile(path); setEditorLoading(true); setEditorError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(path)}`);
      const data = await response.json() as { content?: string; error?: string };
      if (!response.ok) throw new Error(data.error || `File API: HTTP ${response.status}`);
      setContent(data.content ?? ""); setSavedContent(data.content ?? "");
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Не удалось открыть файл");
    } finally { setEditorLoading(false); }
  }

  async function saveFile() {
    if (!selectedFile || saving) return;
    setSaving(true); setEditorError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/file`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: selectedFile, content }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || `Сохранить API: HTTP ${response.status}`);
      setSavedContent(content); onRefreshPreview();
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Не удалось сохранить файл");
    } finally { setSaving(false); }
  }

  const dirty = content !== savedContent;

  useEffect(() => {
    setPreviewError("");
  }, [projectId, previewKey, previewOnline]);

  function handlePreviewLoad() {
    setPreviewError("");
    const frame = previewFrameRef.current;
    const frameWindow = frame?.contentWindow;
    if (!frameWindow) return;

    const handleError = (event: ErrorEvent) => {
      const message = event.message || "Ошибка выполнения Preview";
      const compact = message.slice(0, 600);
      setPreviewError(compact);
      void fetch("/api/agent/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: compact, source: "preview", url: frame?.src }),
      }).catch(() => undefined);
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason ?? "Unhandled promise rejection");
      const compact = reason.slice(0, 600);
      setPreviewError(compact);
      void fetch("/api/agent/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: compact, source: "preview", url: frame?.src }),
      }).catch(() => undefined);
    };

    frameWindow.addEventListener("error", handleError);
    frameWindow.addEventListener("unhandledrejection", handleRejection);
    window.setTimeout(() => {
      frameWindow.removeEventListener("error", handleError);
      frameWindow.removeEventListener("unhandledrejection", handleRejection);
    }, 5 * 60 * 1000);
  }

  let panelContent: ReactNode;
  if (tab === "preview") {
    panelContent = previewOnline ? (
      <div className={`preview-frame-wrap preview-stage-${stage ?? "idle"}`} data-stage={stage ?? "idle"}>
        <div className="preview-browser-bar" aria-label="Панель предпросмотра">
          <div className="preview-browser-dots" aria-hidden="true"><i /><i /><i /></div>
          <div className="preview-address"><span className="preview-address-lock">⌁</span><span>/preview/{projectId}</span><b>{previewOnline ? "LIVE" : "OFFLINE"}</b></div>
          <button type="button" className="preview-browser-reload" onClick={onRefreshPreview} aria-label="Перезагрузить предпросмотр">↻</button>
        </div>
        <div className="preview-viewport">
          <iframe ref={previewFrameRef} key={previewKey} className="preview-frame" title={projectName + " live preview"} src={previewUrl} onLoad={handlePreviewLoad} sandbox="allow-scripts" referrerPolicy="no-referrer" />
          {previewError && <div className="preview-runtime-error" role="alert">{previewError}</div>}
        </div>
      </div>
    ) : (
      <div className="preview-content preview-editorial-empty">
        <div className="preview-editorial-browser">
          <div className="preview-browser-bar"><div className="preview-browser-dots"><i/><i/><i/></div><div className="preview-address"><span>/preview/{projectId || "project"}</span><b>WAITING</b></div></div>
          <div className="preview-editorial-canvas">
            <div className="preview-editorial-copy"><span className="eyebrow">NEXUM / PREVIEW</span><strong>{projectName}</strong><p>Живой Preview появится, когда агент создаст первый рабочий интерфейс.</p><div><i/>Build</div><div><i/>Preview</div><div><i/>Verify</div></div>
            <div className="preview-editorial-device"><span/><span/><span/></div>
          </div>
        </div>
        <span className="coming-soon">Опишите продукт в чате — NEXUM построит его здесь.</span>
      </div>
    );
  } else if (tab === "files") {
    panelContent = (
      <div className="editor-shell">
        <div className="editor-filebar">
          <div className="editor-file-name">
            {selectedFile ? <><span>{selectedFile}</span>{dirty && <i aria-label="Несохранённые изменения">●</i>}</> : "Выберите файл"}
          </div>
          {selectedFile && <button className="editor-save" type="button" disabled={!dirty || saving} onClick={saveFile}>{saving ? "Сохраняю…" : "Сохранить"}</button>}
        </div>
        <div className="editor-body">
          <div className="file-tree editor-tree">
            {filesLoading ? <div className="files-empty">Загрузка файлов…</div> : fileError ? <div className="files-empty error-state-inline">{fileError}</div> : files.map((file) => (
              <button key={file} className={"file-row " + (selectedFile === file ? "selected" : "")} type="button" title={file} onClick={() => void openFile(file)}>
                <span>{file.endsWith(".css") ? "◇" : file.endsWith(".js") || file.endsWith(".ts") || file.endsWith(".tsx") ? "ƒ" : file.endsWith(".json") ? "{}" : "□"}</span>
                <strong>{file}</strong>
              </button>
            ))}
          </div>
          <div className="code-editor">
            {editorLoading ? <div className="editor-empty">Загрузка файла…</div> : selectedFile ? (
              <>
                <div className="editor-gutter" aria-hidden="true">{content.split("\n").map((_, index) => <span key={index}>{index + 1}</span>)}</div>
                <textarea spellCheck={false} value={content} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void saveFile(); } }} aria-label={"Редактирование " + selectedFile} />
              </>
            ) : (
              <div className="editor-empty"><strong>Выберите файл</strong><span>Откройте файл проекта, чтобы редактировать его здесь.</span></div>
            )}
          </div>
        </div>
        {editorError && <div className="editor-error">{editorError}</div>}
      </div>
    );
  } else {
    panelContent = <AgentActivityPanel jobId={jobId} stage={stage} activitySteps={activitySteps} activityEvents={activityEvents} currentActivity={currentActivity} problems={problems} productPlan={productPlan} onOpenPreview={() => onTabChange("preview")} onBackToChat={() => onTabChange("preview")} onRepair={() => onRepair?.()} />;
  }

  return (
    <aside className={`right-panel mobile-mode-${tab}`} aria-label="Инструменты проекта" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onTouchCancel={handleTouchEnd}>
      <div className="panel-tabs" role="tablist">
        <button className={tab === "preview" ? "active" : ""} type="button" onClick={() => onTabChange("preview")}>Предпросмотр</button>
        <button className={tab === "files" ? "active" : ""} type="button" onClick={() => onTabChange("files")}>Файлы</button>
        <button className={tab === "agent" ? "active" : ""} type="button" onClick={() => onTabChange("agent")}>Агент</button>
        {tab === "preview" && previewOnline && <>
          <button className="preview-refresh" type="button" onClick={onRefreshPreview} aria-label="Обновить предпросмотр">↻</button>
          <button className="preview-expand" type="button" onClick={() => setPreviewExpanded((open) => !open)} aria-label={previewExpanded ? "Свернуть предпросмотр" : "Развернуть предпросмотр"}>{previewExpanded ? "↙" : "↗"}</button>
        </>}
      </div>
      <div className={previewExpanded ? "preview-expanded" : ""}>
        {panelContent}
      </div>
    </aside>
  );
}
