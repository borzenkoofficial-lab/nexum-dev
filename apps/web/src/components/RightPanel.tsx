import { useEffect, useState } from "react";

interface RightPanelProps {
  tab: "preview" | "files" | "terminal";
  onTabChange: (tab: "preview" | "files" | "terminal") => void;
  onOpenTerminal: () => void;
  projectName: string;
  projectId: string;
  previewOnline: boolean;
  previewKey: number;
  onRefreshPreview: () => void;
}

export function RightPanel({ tab, onTabChange, onOpenTerminal, projectName, projectId, previewOnline, previewKey, onRefreshPreview }: RightPanelProps) {
  const previewUrl = projectId ? `/api/preview/${projectId}/index.html` : "";
  const [files, setFiles] = useState<string[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [selectedFile, setSelectedFile] = useState("");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [editorLoading, setEditorLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState("");

  useEffect(() => {
    if (tab !== "files" || !projectId) return;
    let cancelled = false;
    setFilesLoading(true); setFileError("");
    fetch(`/api/projects/${encodeURIComponent(projectId)}/files`)
      .then(async (response) => { const data = await response.json().catch(() => ({})) as { files?: string[]; error?: string }; if (!response.ok) throw new Error(data.error || `Files API: HTTP ${response.status}`); if (!cancelled) setFiles(data.files ?? []); })
      .catch((error) => { if (!cancelled) setFileError(error instanceof Error ? error.message : "Unable to load files"); })
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
      setEditorError(error instanceof Error ? error.message : "Unable to open file");
    } finally { setEditorLoading(false); }
  }

  async function saveFile() {
    if (!selectedFile || saving) return;
    setSaving(true); setEditorError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/file`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: selectedFile, content }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || `Save API: HTTP ${response.status}`);
      setSavedContent(content); onRefreshPreview();
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Unable to save file");
    } finally { setSaving(false); }
  }

  const dirty = content !== savedContent;
  return <aside className="right-panel" aria-label="Project tools">
    <div className="panel-tabs" role="tablist"><button className={tab === "preview" ? "active" : ""} type="button" onClick={() => onTabChange("preview")}>Preview</button><button className={tab === "files" ? "active" : ""} type="button" onClick={() => onTabChange("files")}>Files</button><button className={tab === "terminal" ? "active" : ""} type="button" onClick={() => onTabChange("terminal")}>Terminal</button>{tab === "preview" && previewOnline && <button className="preview-refresh" type="button" onClick={onRefreshPreview} aria-label="Refresh preview">↻</button>}</div>
    {tab === "preview" ? (previewOnline ? <div className="preview-frame-wrap"><iframe key={previewKey} className="preview-frame" title={`${projectName} live preview`} src={previewUrl} sandbox="allow-scripts allow-forms allow-modals" /></div> : <div className="preview-content"><div className="preview-icon">{projectName.slice(0,1) || "N"}</div><strong>{projectName}</strong><div className="coming-soon">Preview is waiting for an index.html</div><span>Ask the Agent: “Создай приложение и запусти preview”</span></div>) : tab === "files" ? <div className="editor-shell">
      <div className="editor-filebar"><div className="editor-file-name">{selectedFile ? <><span>{selectedFile}</span>{dirty && <i aria-label="Unsaved changes">●</i>}</> : "Select a file"}</div>{selectedFile && <button className="editor-save" type="button" disabled={!dirty || saving} onClick={saveFile}>{saving ? "Saving…" : "Save"}</button>}</div>
      <div className="editor-body">
        <div className="file-tree editor-tree">{filesLoading ? <div className="files-empty">Loading files...</div> : fileError ? <div className="files-empty error-state-inline">{fileError}</div> : files.map((file) => <button key={file} className={`file-row ${selectedFile === file ? "selected" : ""}`} type="button" title={file} onClick={() => void openFile(file)}><span>{file.endsWith(".css") ? "◇" : file.endsWith(".js") || file.endsWith(".ts") || file.endsWith(".tsx") ? "ƒ" : file.endsWith(".json") ? "{}" : "□"}</span><strong>{file}</strong></button>)}</div>
        <div className="code-editor">{editorLoading ? <div className="editor-empty">Loading file…</div> : selectedFile ? <><div className="editor-gutter" aria-hidden="true">{content.split("\n").map((_, index) => <span key={index}>{index + 1}</span>)}</div><textarea spellCheck={false} value={content} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void saveFile(); } }} aria-label={`Editing ${selectedFile}`} /></> : <div className="editor-empty"><strong>Choose a file</strong><span>Open a project file to edit it here.</span></div>}</div>
      </div>
      {editorError && <div className="editor-error">{editorError}</div>}
    </div> : <div className="terminal-empty"><span className="terminal-prompt">$</span><span>Use the Agent to run safe build and test commands.</span><button type="button" onClick={onOpenTerminal}>Open panel</button></div>}
  </aside>;
}
