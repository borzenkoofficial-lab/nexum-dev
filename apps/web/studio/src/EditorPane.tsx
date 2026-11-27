import { useEffect, useState } from "react";
import { nexumRuntime } from "../../src/runtime/Runtime";
import { KvardEmptyState } from "../../src/components/ui/index.ts";

/** Plain-text editor for one project file: GET/PUT /api/projects/:id/file. */
export function EditorPane({ projectId, path, reloadKey, onSaved }: { projectId: string; path: string | null; reloadKey: number; onSaved: () => void }) {
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    void (async () => {
      setStatus("loading");
      try {
        const response = await nexumRuntime.network.fetch(`/api/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(path)}`, { signal: controller.signal, dedupe: false, operation: "studio-file" });
        const body = await response.json().catch(() => null) as { content?: string; error?: string } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || typeof body?.content !== "string") throw new Error(body?.error ?? `HTTP ${response.status}`);
        setContent(body.content);
        setSaved(body.content);
        setStatus("idle");
        setError("");
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setStatus("error");
        setError(loadError instanceof Error ? loadError.message : "Не удалось открыть файл.");
      }
    })();
    return () => controller.abort();
  }, [projectId, path, reloadKey]);

  async function save() {
    if (!path) return;
    setStatus("saving");
    try {
      const response = await nexumRuntime.network.fetch(`/api/projects/${encodeURIComponent(projectId)}/file`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, content }), retries: 0, operation: "studio-save",
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
      setSaved(content);
      setStatus("idle");
      setError("");
      onSaved();
    } catch (saveError) {
      setStatus("error");
      setError(saveError instanceof Error ? saveError.message : "Не удалось сохранить файл.");
    }
  }

  if (!path) return <KvardEmptyState title="Выберите файл" description="Откройте файл в дереве слева, чтобы просмотреть или изменить его." />;
  const dirty = content !== saved;
  return (
    <div className="st-editor">
      <div className="st-editor-head">
        <span className="st-mono" title={path}>{path}{dirty ? " •" : ""}</span>
        <button type="button" disabled={!dirty || status === "saving" || status === "loading"} onClick={() => void save()}>{status === "saving" ? "Сохранение…" : dirty ? "Сохранить" : "Сохранено"}</button>
      </div>
      {error && <p className="st-error" role="alert">{error}{dirty ? " Изменения остаются в редакторе." : ""}</p>}
      <textarea
        aria-label={`Содержимое ${path}`}
        className="st-mono"
        spellCheck={false}
        disabled={status === "loading"}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (dirty) void save(); }
        }}
      />
    </div>
  );
}
