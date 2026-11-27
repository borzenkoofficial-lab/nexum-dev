import { useEffect, useState } from "react";
import { nexumRuntime } from "../runtime/Runtime";
import { KvardEmptyState, KvardStatusBadge } from "./ui/index.ts";

/** Shape of GET /api/chat/jobs/:id/diff → diff (apps/api/agent/checkpoint.ts). */
interface DiffLine { type: "context" | "add" | "remove"; text: string }
interface DiffHunk { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: DiffLine[] }
interface FileChange { path: string; status: "added" | "modified" | "deleted"; binary: boolean; omitted: boolean; additions: number; deletions: number; hunks: DiffHunk[] }
interface JobDiff { files: FileChange[]; totals: { files: number; additions: number; deletions: number }; truncated: boolean }

type State =
  | { status: "idle" | "loading" }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; diff: JobDiff };

const STATUS_LABEL: Record<FileChange["status"], { label: string; tone: "success" | "info" | "danger" }> = {
  added: { label: "Создан", tone: "success" },
  modified: { label: "Изменён", tone: "info" },
  deleted: { label: "Удалён", tone: "danger" },
};

/**
 * Files changed by the current Agent job (pre-task snapshot vs project now).
 * Refreshes when real job events arrive or the stage changes; no polling timer.
 */
export function JobChanges({ jobId, stage, eventCount }: { jobId: string | null; stage: string | null | undefined; eventCount: number }) {
  // Remounted per job (key) so a new job starts in "loading"; refreshes keep the last result visible.
  const [state, setState] = useState<State>(jobId ? { status: "loading" } : { status: "idle" });
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await nexumRuntime.network.fetch(`/api/chat/jobs/${encodeURIComponent(jobId)}/diff`, { signal: controller.signal, operation: "job-diff", dedupe: false });
        const body = await response.json().catch(() => null) as { diff?: JobDiff; error?: string } | null;
        if (controller.signal.aborted) return;
        if (response.status === 409 || response.status === 404) { setState({ status: "unavailable", message: body?.error ?? "Изменения появятся, когда агент начнёт работу." }); return; }
        if (!response.ok || !body?.diff || !Array.isArray(body.diff.files)) { setState({ status: "error", message: body?.error ?? `HTTP ${response.status}` }); return; }
        setState({ status: "ready", diff: body.diff });
      } catch (error) {
        if (!controller.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : "Не удалось загрузить изменения." });
      }
    })();
    return () => controller.abort();
  }, [jobId, stage, eventCount, reloadKey]);

  if (!jobId) return null;
  return (
    <section className="kv-changes" aria-labelledby="kv-changes-title" aria-busy={state.status === "loading"}>
      <div className="kv-changes-head">
        <strong id="kv-changes-title">Изменения</strong>
        {state.status === "ready" && state.diff.files.length > 0 && (
          <span className="kv-changes-totals"><span className="kv-add">+{state.diff.totals.additions}</span> <span className="kv-del">−{state.diff.totals.deletions}</span> · {state.diff.totals.files} файл.</span>
        )}
      </div>
      {state.status === "loading" && <p className="kv-changes-muted">Загружаю изменения…</p>}
      {state.status === "unavailable" && <p className="kv-changes-muted">{state.message}</p>}
      {state.status === "error" && <p className="kv-changes-muted" role="alert">Не удалось загрузить изменения: {state.message} <button type="button" onClick={() => setReloadKey((value) => value + 1)}>Повторить</button></p>}
      {state.status === "ready" && state.diff.files.length === 0 && <KvardEmptyState title="Файлы не менялись" description="Агент пока не изменил ни одного файла проекта." />}
      {state.status === "ready" && state.diff.files.length > 0 && (
        <ul className="kv-changes-list">
          {state.diff.files.map((file) => {
            const open = openPath === file.path;
            const status = STATUS_LABEL[file.status];
            return (
              <li key={file.path}>
                <button type="button" className="kv-changes-file" aria-expanded={open} onClick={() => setOpenPath(open ? null : file.path)}>
                  <span className="kv-changes-path" title={file.path}>{file.path}</span>
                  <KvardStatusBadge tone={status.tone} label={status.label} />
                  {!file.omitted && <span className="kv-changes-counts">{file.additions > 0 && <span className="kv-add">+{file.additions}</span>}{file.additions > 0 && file.deletions > 0 && " "}{file.deletions > 0 && <span className="kv-del">−{file.deletions}</span>}</span>}
                </button>
                {open && (file.omitted
                  ? <p className="kv-changes-muted">{file.binary ? "Бинарный файл — построчное сравнение недоступно." : "Изменение слишком большое для построчного показа."}</p>
                  : <pre className="kv-diff" aria-label={`Изменения в ${file.path}`}>{file.hunks.map((hunk, index) => (
                    <span key={index} className="kv-diff-hunk">
                      <span className="kv-diff-meta">@@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@{"\n"}</span>
                      {hunk.lines.map((line, lineIndex) => <span key={lineIndex} className={`kv-diff-line kv-diff-${line.type}`}>{line.type === "add" ? "+" : line.type === "remove" ? "−" : " "} {line.text}{"\n"}</span>)}
                    </span>
                  ))}</pre>)}
              </li>
            );
          })}
        </ul>
      )}
      {state.status === "ready" && state.diff.truncated && <p className="kv-changes-muted">Показаны первые {state.diff.files.length} файлов.</p>}
    </section>
  );
}
