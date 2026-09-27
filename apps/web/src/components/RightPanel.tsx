import { useEffect, useState, type ReactNode } from "react";
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
}

export function RightPanel({ tab, onTabChange, projectName, projectId, previewOnline, previewKey, onRefreshPreview, jobId, stage, activitySteps, activityEvents, currentActivity, problems, productPlan }: RightPanelProps) {
  const previewUrl = projectId ? `/api/preview/${projectId}/index.html` : "";
  const [files, setFiles] = useState<string[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [selectedFile, setSelectedFile] = useState("");
  const [content, setContent] = useState("");
  const [savedContent, setСохранитьdContent] = useState("");
  const [editorLoading, setEditorLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState("");

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
      setContent(data.content ?? ""); setСохранитьdContent(data.content ?? "");
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
      setСохранитьdContent(content); onRefreshPreview();
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Не удалось сохранить файл");
    } finally { setSaving(false); }
  }

  const dirty = content !== savedContent;

  let panelContent: ReactNode;
  if (tab === "preview") {
    panelContent = previewOnline ? (
      <div className="preview-frame-wrap">
        <iframe key={previewKey} className="preview-frame" title={projectName + " live preview"} src={previewUrl} sandbox="allow-scripts allow-forms allow-modals" />
      </div>
    ) : (
      <div className="preview-content">
        <div className="preview-icon">{projectName.slice(0, 1) || "N"}</div>
        <strong>{projectName}</strong>
        <div className="coming-soon">Предпросмотр ожидает файл index.html</div>
        <span>Спросите агента: «Создай приложение и запусти предпросмотр»</span>
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
    panelContent = <AgentActivityPanel jobId={jobId} stage={stage} activitySteps={activitySteps} activityEvents={activityEvents} currentActivity={currentActivity} problems={problems} productPlan={productPlan} />;
  }

  return (
    <aside className="right-panel" aria-label="Инструменты проекта">
      <div className="panel-tabs" role="tablist">
        <button className={tab === "preview" ? "active" : ""} type="button" onClick={() => onTabChange("preview")}>Предпросмотр</button>
        <button className={tab === "files" ? "active" : ""} type="button" onClick={() => onTabChange("files")}>Файлы</button>
        <button className={tab === "agent" ? "active" : ""} type="button" onClick={() => onTabChange("agent")}>Агент</button>
        {tab === "preview" && previewOnline && <button className="preview-refresh" type="button" onClick={onRefreshPreview} aria-label="Обновить предпросмотр">↻</button>}
      </div>
      {panelContent}
    </aside>
  );
}
