import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentStage } from "./types";
import { KvardPageHeader, KvardSegmentedControl, KvardSurface } from "./ui/index.ts";

interface Props {
  tab: "preview" | "files" | "agent";
  projectName: string;
  projectId: string;
  previewOnline: boolean;
  previewKey: number;
  stage: AgentStage;
  jobId: string | null;
  activitySteps: Array<{ iteration: number; tool: string; success: boolean }>;
  activityEvents: Array<{ id: number; timestamp: number; iteration: number; type: string; tool?: string; message: string }>;
  currentActivity: string;
  problems: Array<{ message: string; source?: string }>;
  productPlan: { goal: string; productType: string; pages: string[]; components: string[]; acceptanceCriteria: string[] } | null;
  onTabChange: (tab: "preview" | "files" | "agent") => void;
  onRefresh: () => void;
  onRepair: () => void;
  onOpenAgent: () => void;
}

const stages = [
  ["analyzing", "Анализ"],
  ["planning", "Планирование"],
  ["awaiting_approval", "Ожидает подтверждения"],
  ["editing", "Разработка"],
  ["testing", "Проверка"],
  ["completed", "Готово"],
] as const;

const deviceLabels = { desktop: "Компьютер", tablet: "Планшет", mobile: "Телефон" } as const;

export function BuilderTools(p: Props) {
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const dirty = content !== saved;

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(p.projectId) + "/files");
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Не удалось загрузить список файлов");
      const next = Array.isArray(data.files) ? data.files as string[] : [];
      setFiles(next);
      setSelected((current) => current && next.includes(current) ? current : (next[0] ?? ""));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [p.projectId]);

  useEffect(() => {
    if (p.tab !== "files") return;
    void loadFiles();
  }, [p.tab, loadFiles, p.previewKey]);

  useEffect(() => {
    if (!selected || p.tab !== "files") {
      setFileLoading(false);
      return;
    }
    let cancelled = false;
    setFileLoading(true);
    setError("");
    setContent("");
    setSaved("");
    fetch("/api/projects/" + encodeURIComponent(p.projectId) + "/file?path=" + encodeURIComponent(selected))
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || "Не удалось открыть файл");
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setContent(data.content ?? "");
        setSaved(data.content ?? "");
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });
    return () => { cancelled = true; };
  }, [selected, p.projectId, p.tab]);

  async function save() {
    if (!selected || !dirty || fileLoading || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(p.projectId) + "/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selected, content }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Не удалось сохранить файл");
      setSaved(content);
      p.onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  if (p.tab === "preview") {
    return (
      <KvardSurface as="section" className="nx-tool" variant="raised" padding="none" aria-label="Предпросмотр приложения">
        <KvardPageHeader
          className="nx-tool-head"
          headingLevel="h2"
          eyebrow="ПРЕДПРОСМОТР"
          title="Предпросмотр приложения"
          titleId="kv-builder-preview-title"
          description={p.previewOnline ? "Приложение доступно" : "Ожидает первую сборку"}
          descriptionId="kv-builder-preview-status"
          actions={<div className="nx-tool-actions">
            <button type="button" onClick={p.onRefresh}>↻ Обновить</button>
            <button type="button" onClick={() => window.open("/api/preview/" + encodeURIComponent(p.projectId) + "/index.html", "_blank", "noopener,noreferrer")}>Открыть ↗</button>
          </div>}
        />
        {p.previewOnline ? (
          <>
            <div className="nx-device-tabs">
              <KvardSegmentedControl
                ariaLabel="Размер предпросмотра"
                value={device}
                onChange={value => setDevice(value as typeof device)}
                items={[
                  { id: "desktop", label: deviceLabels.desktop },
                  { id: "tablet", label: deviceLabels.tablet },
                  { id: "mobile", label: deviceLabels.mobile },
                ]}
              />
            </div>
            <div className={"nx-preview " + device}>
              <div className="nx-browser"><span aria-hidden="true">● ● ●</span><small>preview / {p.projectName}</small><b>ДОСТУПЕН</b></div>
              <iframe ref={frame} title={"Предпросмотр проекта «" + p.projectName + "»"} src={"/api/preview/" + encodeURIComponent(p.projectId) + "/index.html?v=" + p.previewKey} sandbox="allow-scripts" />
            </div>
          </>
        ) : (
          <div className="nx-preview-empty">
            <div><span>PREVIEW</span><h3>Здесь появится ваше приложение</h3><p>Отправьте задачу в чате, чтобы начать разработку.</p><button type="button" onClick={p.onOpenAgent}>Открыть AI-агента</button></div>
          </div>
        )}
      </KvardSurface>
    );
  }

  if (p.tab === "files") {
    return (
      <KvardSurface as="section" className="nx-tool" variant="raised" padding="none" aria-label="Файлы проекта">
        <KvardPageHeader
          className="nx-tool-head"
          headingLevel="h2"
          eyebrow="ФАЙЛЫ"
          title="Исходный код проекта"
          titleId="kv-builder-files-title"
          actions={<button type="button" onClick={() => void loadFiles()} disabled={loading}>{loading ? "Загрузка…" : "Обновить"}</button>}
        />
        <div className="nx-files">
          <aside aria-label="Список файлов">
            {loading && !files.length ? <p role="status">Загрузка файлов…</p>
              : files.length ? files.map((file) => (
                <button className={selected === file ? "selected" : ""} aria-pressed={selected === file} key={file} type="button" onClick={() => setSelected(file)}>{file}</button>
              ))
              : <p>Файлы пока не созданы.</p>}
          </aside>
          <main>
            {selected ? (
              <>
                <div className="nx-file-head"><b>{selected}</b><button type="button" disabled={!dirty || fileLoading || saving} onClick={() => void save()}>{saving ? "Сохранение…" : fileLoading ? "Загрузка…" : dirty ? "Сохранить изменения" : "Сохранено"}</button></div>
                <textarea aria-label={"Содержимое файла " + selected} spellCheck={false} disabled={fileLoading} value={content} onChange={(event) => setContent(event.target.value)} />
              </>
            ) : <div className="nx-empty">Выберите файл проекта</div>}
          </main>
        </div>
        {error && <div className="nx-error" role="alert">{error}</div>}
      </KvardSurface>
    );
  }

  const live = Boolean(p.jobId) && p.stage !== "completed" && p.stage !== "error";
  const current = p.stage === "thinking" || p.stage === "reading"
    ? "analyzing"
    : p.stage === "running"
      ? "planning"
      : p.stage === "building"
        ? "editing"
        : p.stage ?? "";
  const currentIndex = stages.findIndex((stage) => stage[0] === current);
  const successfulSteps = p.activitySteps.filter((step) => step.success).length;

  return (
    <KvardSurface as="section" className="nx-tool nx-agent" variant="raised" padding="none" aria-label="Ход выполнения AI-агента">
      <KvardPageHeader
        className="nx-tool-head"
        headingLevel="h2"
        eyebrow="AI-АГЕНТ"
        title={live ? "Выполняет задачу" : p.stage === "completed" ? "Задача выполнена" : p.stage === "error" ? "Задача остановлена с ошибкой" : "Готов к работе"}
        titleId="kv-builder-agent-title"
        actions={<span className={"nx-agent-state " + (live ? "live" : p.stage === "error" ? "error" : p.stage === "completed" ? "done" : "")} role="status" aria-live="polite">{live ? "Работает" : p.stage === "error" ? "Ошибка" : p.stage === "completed" ? "Завершено" : "Ожидание"}</span>}
      />

      <div className="nx-run">
        <strong>{p.currentActivity || "Опишите задачу в чате, чтобы запустить агента."}</strong>
        <span>{p.activitySteps.length} действий · {successfulSteps} успешно</span>
        <div className="nx-progress" role="progressbar" aria-label="Этапы выполнения задачи" aria-valuemin={0} aria-valuemax={stages.length} aria-valuenow={p.stage === "completed" ? stages.length : Math.max(0, currentIndex + 1)}>
          {stages.map((stage, index) => <i className={index < currentIndex || p.stage === "completed" ? "done" : index === currentIndex && live ? "active" : ""} key={stage[0]} />)}
        </div>
      </div>

      <div className="nx-agent-list" aria-label="Этапы задачи">
        {stages.map((stage, index) => (
          <div key={stage[0]} className={index < currentIndex || p.stage === "completed" ? "done" : index === currentIndex && live ? "active" : ""}>
            <b>{String(index + 1).padStart(2, "0")}</b><span>{stage[1]}</span>
            {index < currentIndex || p.stage === "completed" ? <small>Завершено</small> : index === currentIndex && live ? <small>Текущий этап</small> : null}
          </div>
        ))}
      </div>

      {p.problems.length > 0 && (
        <div className="nx-problems" role="alert">
          <strong>Требуют внимания</strong>
          {p.problems.slice(0, 5).map((problem, index) => <p key={index}>! {problem.source ? problem.source + ": " : ""}{problem.message}</p>)}
          <button type="button" onClick={p.onRepair}>Исправить с AI-агентом</button>
        </div>
      )}

      {p.productPlan && (
        <div className="nx-plan">
          <small>ПЛАН ПРОДУКТА</small>
          <strong>{p.productPlan.productType}</strong>
          <p>{p.productPlan.goal}</p>
          <span>{p.productPlan.pages.length} страниц · {p.productPlan.components.length} компонентов</span>
        </div>
      )}

      <div className="nx-events">
        <strong>История выполнения</strong>
        {p.activityEvents.length
          ? [...p.activityEvents].reverse().slice(0, 20).map((event) => <p key={event.id}><b>{event.tool ?? "Агент"}</b> · {event.message}</p>)
          : <span>События появятся после запуска задачи.</span>}
      </div>
    </KvardSurface>
  );
}
