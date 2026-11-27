import { useEffect, useState } from "react";
import { nexumRuntime } from "../runtime/Runtime";
import { KvardStatusBadge } from "./ui/index.ts";

const CHECKS = [
  { script: "build", label: "Сборка" },
  { script: "test", label: "Тесты" },
  { script: "lint", label: "Lint" },
  { script: "typecheck", label: "Типы" },
] as const;

type Script = typeof CHECKS[number]["script"];

interface CheckResult {
  script: Script;
  success: boolean;
  exitCode: number | null;
  durationMs: number | null;
  output: string;
  error?: string;
}

const OUTPUT_TAIL = 6000;

/** Runs the project's own npm scripts in the sandbox (POST /api/projects/:id/run) and shows the result. */
export function ProjectChecks({ projectId, agentBusy }: { projectId: string; agentBusy: boolean }) {
  const [scripts, setScripts] = useState<Script[] | null>(null);
  const [running, setRunning] = useState<Script | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await nexumRuntime.network.fetch(`/api/projects/${encodeURIComponent(projectId)}/file?path=package.json`, { signal: controller.signal, operation: "project-scripts", dedupe: false });
        if (controller.signal.aborted) return;
        if (!response.ok) { setScripts([]); return; }
        const body = await response.json() as { content?: string };
        const declared = (JSON.parse(body.content ?? "{}") as { scripts?: Record<string, unknown> }).scripts ?? {};
        setScripts(CHECKS.map((check) => check.script).filter((script) => typeof declared[script] === "string"));
      } catch {
        if (!controller.signal.aborted) setScripts([]);
      }
    })();
    return () => controller.abort();
  }, [projectId, agentBusy]);

  async function run(script: Script) {
    setRunning(script);
    setResult(null);
    try {
      const response = await nexumRuntime.network.fetch(`/api/projects/${encodeURIComponent(projectId)}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: `npm run ${script}` }),
        // The server may install dependencies first (up to 120 s) and then run the script (up to 120 s).
        timeoutMs: 270_000,
        retries: 0,
        operation: "project-check",
      });
      const body = await response.json().catch(() => null) as { success?: boolean; exitCode?: number | null; durationMs?: number; stdout?: string; stderr?: string; error?: string } | null;
      const output = [body?.stdout, body?.stderr].filter(Boolean).join("\n").trim();
      setResult({
        script,
        success: Boolean(response.ok && body?.success),
        exitCode: body?.exitCode ?? null,
        durationMs: typeof body?.durationMs === "number" ? body.durationMs : null,
        output: output.length > OUTPUT_TAIL ? "…\n" + output.slice(-OUTPUT_TAIL) : output,
        ...(body?.error ? { error: body.error } : !response.ok && !output ? { error: `HTTP ${response.status}` } : {}),
      });
    } catch (error) {
      setResult({ script, success: false, exitCode: null, durationMs: null, output: "", error: error instanceof Error ? error.message : "Не удалось выполнить проверку." });
    } finally {
      setRunning(null);
    }
  }

  return (
    <section className="kv-checks" aria-labelledby="kv-checks-title">
      <div className="kv-checks-head">
        <strong id="kv-checks-title">Проверки проекта</strong>
        {agentBusy && <small>Доступны после завершения задачи агента</small>}
      </div>
      {scripts === null && <p className="kv-checks-muted">Определяю доступные проверки…</p>}
      {scripts?.length === 0 && <p className="kv-checks-muted">В package.json нет скриптов build, test, lint или typecheck.</p>}
      {scripts && scripts.length > 0 && (
        <div className="kv-checks-actions" role="group" aria-label="Запуск проверок">
          {CHECKS.filter((check) => scripts.includes(check.script)).map((check) => (
            <button key={check.script} type="button" disabled={agentBusy || running !== null} aria-busy={running === check.script} onClick={() => void run(check.script)}>
              {running === check.script ? `${check.label}…` : check.label}
            </button>
          ))}
        </div>
      )}
      <div aria-live="polite">
        {result && (
          <div className="kv-checks-result" data-success={result.success}>
            <div className="kv-checks-result-head">
              <KvardStatusBadge tone={result.success ? "success" : "danger"} label={result.success ? "Успешно" : "Ошибка"} />
              <span>npm run {result.script}</span>
              <small>{[result.exitCode !== null ? `код ${result.exitCode}` : null, result.durationMs !== null ? `${(result.durationMs / 1000).toFixed(1)} с` : null].filter(Boolean).join(" · ")}</small>
            </div>
            {result.error && <p className="kv-checks-error">{result.error}</p>}
            {result.output && <pre className="kv-checks-output" tabIndex={0} aria-label={`Вывод npm run ${result.script}`}>{result.output}</pre>}
          </div>
        )}
      </div>
    </section>
  );
}
