import { useEffect, useMemo, useRef, useState } from "react";

interface CodePanelProps {
  projectId: string;
  projectName: string;
  previewOnline: boolean;
  previewKey: number;
  onRefreshPreview: () => void;
  onClose: () => void;
}

function fileIcon(path: string) {
  if (path.endsWith(".tsx") || path.endsWith(".ts")) return "TS";
  if (path.endsWith(".jsx") || path.endsWith(".js")) return "JS";
  if (path.endsWith(".css")) return "◇";
  if (path.endsWith(".json")) return "{}";
  if (path.endsWith(".html")) return "◈";
  if (path.endsWith(".md")) return "M";
  return "·";
}

export function CodePanel({ projectId, projectName, previewOnline, previewKey, onRefreshPreview, onClose }: CodePanelProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalLines, setTerminalLines] = useState<string[]>(["NEXUM Code terminal", "Проект подключён. Команды выполняются через Nexum Agent."]);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  const lines = useMemo(() => content.split("\n"), [content]);
  const dirty = content !== savedContent;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/projects/${encodeURIComponent(projectId)}/files`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { files?: string[]; error?: string };
        if (!response.ok) throw new Error(data.error || `Files API: HTTP ${response.status}`);
        if (!cancelled) {
          const next = data.files ?? [];
          setFiles(next);
          if (next.length > 0) setSelectedFile((current) => current || next[0]);
        }
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Не удалось загрузить файлы"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (!selectedFile) return;
    let cancelled = false;
    setFileLoading(true);
    setError("");
    fetch(`/api/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(selectedFile)}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { content?: string; error?: string };
        if (!response.ok) throw new Error(data.error || `File API: HTTP ${response.status}`);
        if (!cancelled) { setContent(data.content ?? ""); setSavedContent(data.content ?? ""); }
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Не удалось открыть файл"); })
      .finally(() => { if (!cancelled) setFileLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, selectedFile]);

  async function saveFile() {
    if (!selectedFile || saving || !dirty) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedFile, content }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || `Save API: HTTP ${response.status}`);
      setSavedContent(content);
      onRefreshPreview();
      setTerminalLines((items) => [...items.slice(-30), `✓ Saved ${selectedFile}`]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить файл");
    } finally {
      setSaving(false);
    }
  }

  function onEditorKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveFile();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const target = event.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const next = content.slice(0, start) + "  " + content.slice(end);
      setContent(next);
      requestAnimationFrame(() => {
        target.selectionStart = start + 2;
        target.selectionEnd = start + 2;
      });
    }
  }

  return (
    <section className="nexum-code" aria-label="Nexum Code">
      <header className="nexum-code-topbar">
        <div className="nexum-code-brand"><button type="button" onClick={onClose} aria-label="Вернуться в проект">←</button><strong>NEXUM <span>CODE</span></strong><em>{projectName}</em></div>
        <div className="nexum-code-actions">
          <button type="button" className={terminalOpen ? "active" : ""} onClick={() => setTerminalOpen((open) => !open)}>Terminal</button>
          <button type="button" onClick={onRefreshPreview}>Preview</button>
          <button type="button" className="nexum-code-save" disabled={!dirty || saving} onClick={() => void saveFile()}>{saving ? "Saving…" : dirty ? "Save" : "Saved"}</button>
        </div>
      </header>
      <div className="nexum-code-main">
        <aside className="nexum-code-sidebar">
          <div className="nexum-code-sidebar-title">EXPLORER <span>{files.length}</span></div>
          <div className="nexum-code-project-name">▾ {projectName}</div>
          {loading ? <div className="nexum-code-empty">Загрузка…</div> : files.map((file) => (
            <button key={file} type="button" className={selectedFile === file ? "nexum-code-file active" : "nexum-code-file"} onClick={() => { if (dirty && !window.confirm("Есть несохранённые изменения. Открыть другой файл без сохранения?")) return; setSelectedFile(file); }}>
              <span>{fileIcon(file)}</span><b>{file}</b>{selectedFile === file && dirty && <i>●</i>}
            </button>
          ))}
        </aside>
        <main className="nexum-code-editor">
          <div className="nexum-code-tabs">{selectedFile ? <div className="nexum-code-tab active"><span>{fileIcon(selectedFile)}</span>{selectedFile}{dirty && <i>●</i>}</div> : <span>Выберите файл</span>}</div>
          {fileLoading ? <div className="nexum-code-loading">Открываю файл…</div> : selectedFile ? (
            <div className="nexum-code-edit-wrap">
              <div className="nexum-code-gutter" aria-hidden="true">{lines.map((_, index) => <span key={index}>{index + 1}</span>)}</div>
              <textarea ref={editorRef} className="nexum-code-textarea" value={content} spellCheck={false} onChange={(event) => setContent(event.target.value)} onKeyDown={onEditorKeyDown} aria-label={`Редактор ${selectedFile}`} />
            </div>
          ) : <div className="nexum-code-loading">В проекте пока нет файлов.</div>}
          {error && <div className="nexum-code-error">{error}</div>}
          <footer className="nexum-code-status"><span>NEXUM CODE</span><span>{selectedFile || "No file"}</span><span>{dirty ? "Modified" : "Saved"}</span><span>{previewOnline ? "Preview: LIVE" : "Preview: OFFLINE"}</span><span className="nexum-code-status-right">UTF-8 · LF</span></footer>
        </main>
        {terminalOpen && <aside className="nexum-code-terminal"><div className="nexum-code-terminal-head"><strong>TERMINAL</strong><button type="button" onClick={() => setTerminalOpen(false)}>×</button></div><div className="nexum-code-terminal-body">{terminalLines.map((line, index) => <div key={index}>{line}</div>)}<div className="nexum-code-terminal-note">Для запуска команд и автоматического исправления используйте Agent — он работает с тем же файловым пространством.</div></div></aside>}
      </div>
    </section>
  );
}
