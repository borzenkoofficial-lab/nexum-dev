import { useEffect, useState } from "react";
import type { FormEvent } from "react";

interface NewProjectModalProps {
  open: boolean;
  name: string;
  loading: boolean;
  onNameChange: (name: string) => void;
  onClose: () => void;
  error?: string;
  onSubmit: (data: { name: string; description: string; type: string }) => void;
}

const PROJECT_TYPES = [
  { id: "website", label: "Сайт", hint: "Лендинг, корпоративный сайт, портфолио" },
  { id: "webapp", label: "Веб-приложение", hint: "Интерфейс, логика, личный кабинет" },
  { id: "saas", label: "SaaS / сервис", hint: "Продукт с пользователями и функциями" },
  { id: "dashboard", label: "Dashboard", hint: "Панель управления и аналитика" },
  { id: "api", label: "API / backend", hint: "API, интеграции, серверная логика" },
  { id: "blank", label: "Пустой проект", hint: "Чистое рабочее пространство" },
] as const;

export function NewProjectModal({ open, name, loading, error, onNameChange, onClose, onSubmit }: NewProjectModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return <ProjectCreationForm name={name} loading={loading} error={error} onNameChange={onNameChange} onClose={onClose} onSubmit={onSubmit} />;
}

function ProjectCreationForm({ name, loading, error, onNameChange, onClose, onSubmit }: Omit<NewProjectModalProps, "open">) {
  const [selectedId, setSelectedId] = useState("webapp");
  const selected = PROJECT_TYPES.find((item) => item.id === selectedId) ?? PROJECT_TYPES[1];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      name: name.trim(),
      description: String(form.get("description") ?? "").trim(),
      type: selected.label,
    });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal new-project-modal" role="dialog" aria-modal="true" aria-labelledby="new-project-title" aria-describedby="new-project-description">
        <div className="modal-header">
          <div>
            <span className="eyebrow">НОВЫЙ ПРОЕКТ</span>
            <h2 id="new-project-title">Создать проект</h2>
            <p id="new-project-description" className="modal-intro">Сначала задайте направление. После создания откроется отдельное рабочее пространство проекта.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Закрыть" onClick={onClose}>×</button>
        </div>

        <form onSubmit={submit}>
          <label htmlFor="project-name">Название проекта</label>
          <input id="project-name" value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="Например: сайт строительной компании" autoFocus maxLength={64} required />

          <label className="project-description-label" htmlFor="project-description">Что хотите создать?</label>
          <textarea id="project-description" name="description" placeholder="Например: сайт компании с услугами, портфолио, формой заявки и адаптацией под телефон…" maxLength={500} rows={4} />

          <div className="project-type-label">Тип проекта</div>
          <div className="project-type-grid">
            {PROJECT_TYPES.map((item) => (
              <label key={item.id} className="project-type-card">
                <input type="radio" name="type" value={item.label} checked={item.id === selectedId} onChange={() => setSelectedId(item.id)} />
                <span><strong>{item.label}</strong><small>{item.hint}</small></span>
              </label>
            ))}
          </div>

          {error && <div className="project-creation-error" role="alert">{error}</div>}

          <div className="modal-summary">
            <span>После создания</span>
            <strong>{selected.label} — откроется рабочее пространство проекта</strong>
            <small>Название, тип и описание сохранятся в «Обзоре», а чат будет работать только с этим проектом.</small>
          </div>

          <div className="modal-actions">
            <button className="cancel-button" type="button" onClick={onClose}>Отмена</button>
            <button className="create-button" type="submit" disabled={loading || !name.trim()}>{loading ? "Создаю проект…" : "Создать и открыть"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
