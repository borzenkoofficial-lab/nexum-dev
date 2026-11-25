import { useState } from "react";
import type { Project as Проект } from "./types";

type Props = {
  projects: Проект[];
  onNewProject: (description?: string) => void;
  onOpenProject: (id: string, tab?: "preview" | "files" | "agent" | "code") => void;
  onOpenView: (view: "home" | "project" | "connectors" | "settings" | "news" | "diagnostics" | "agents" | "business-agents") => void;
};

const starters = [
  { label: "Сайт компании", prompt: "Создай современный сайт для моей компании с услугами, преимуществами и формой заявки." },
  { label: "Веб-приложение", prompt: "Создай полноценное веб-приложение с авторизацией, личным кабинетом и основными рабочими сценариями." },
  { label: "AI-агент", prompt: "Создай AI-агента для автоматизации бизнес-процесса. Сначала определи архитектуру и необходимые инструменты." },
];

export function BuilderHome({ projects, onNewProject, onOpenProject, onOpenView }: Props) {
  const recent = projects.slice(0, 5);
  const [brief, setBrief] = useState("");

  function createFromBrief() {
    const description = brief.trim();
    if (!description) return;
    onNewProject(description);
  }

  function setPrompt(value: string) {
    setBrief(value);
    document.querySelector<HTMLTextAreaElement>(".kv-home-composer textarea")?.focus();
  }

  return (
    <section className="builder-home kv-home">
      <a className="kv-skip-link" href="#kv-home-content">Перейти к содержимому</a>
      <div className="kv-home-workspace">
        <header className="kv-home-topbar">
          <div className="kv-home-breadcrumb"><span>Рабочая среда</span><i>/</i><strong>Обзор</strong></div>
          <div className="kv-home-top-actions">
            <span className="kv-home-top-context">Панель управления</span>
            <button type="button" onClick={() => onOpenView("settings")} aria-label="Открыть настройки">⚙</button>
          </div>
        </header>

        <main className="kv-home-content" id="kv-home-content">
          <div className="kv-home-heading">
            <div><p className="kv-home-eyebrow">КВАРД / WORKSPACE</p><h1>Рабочая среда</h1><p>Создавайте цифровые продукты и управляйте разработкой в одном месте.</p></div>
            <div className="kv-home-project-count"><strong>{projects.length}</strong><span>проектов</span></div>
          </div>

          <section className="kv-home-create-section" aria-labelledby="kv-home-create-title">
            <div className="kv-home-section-title"><div><span>НОВАЯ ЗАДАЧА</span><h2 id="kv-home-create-title">Что будем создавать?</h2></div><small>Опишите результат — детали проработает агент</small></div>
            <div className="builder-home-composer kv-home-composer">
              <textarea
                aria-label="Опишите, что нужно создать"
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                placeholder="Например: создай CRM для строительной компании с заказами, клиентами и аналитикой…"
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    createFromBrief();
                  }
                }}
              />
              <div className="builder-home-composer-footer">
                <span><kbd>Ctrl</kbd><kbd>Enter</kbd> для запуска</span>
                <button type="button" onClick={createFromBrief} disabled={!brief.trim()}>Начать создание <span aria-hidden="true">↗</span></button>
              </div>
            </div>
            <div className="kv-home-starters" aria-label="Шаблоны задач">
              <span>БЫСТРЫЙ СТАРТ</span>
              {starters.map((starter) => <button key={starter.label} type="button" onClick={() => setPrompt(starter.prompt)}>{starter.label}<span aria-hidden="true">↗</span></button>)}
            </div>
          </section>

          <section className="kv-home-recent" aria-labelledby="kv-home-recent-title">
            <div className="kv-home-section-title"><div><span>ВАША РАБОТА</span><h2 id="kv-home-recent-title">Последние проекты</h2></div><small>{projects.length ? `Всего: ${projects.length}` : "Пока нет проектов"}</small></div>
            {recent.length ? (
              <div className="kv-home-project-list">
                {recent.map((project) => (
                  <button key={project.id} type="button" className="kv-home-project-row" onClick={() => onOpenProject(project.id, "agent")}>
                    <span className="kv-home-project-avatar">{project.name.slice(0, 1).toUpperCase()}</span>
                    <span className="kv-home-project-details"><strong>{project.name}</strong><small>{project.status === "active" ? "Активный проект" : "Проект"}</small></span>
                    <span className="kv-home-project-open">Открыть <b aria-hidden="true">→</b></span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="kv-home-empty">
                <span className="kv-home-empty-mark">К</span>
                <div><strong>Ваше первое рабочее пространство начинается здесь</strong><p>Опишите задачу выше. КВАРД создаст проект и откроет среду разработки.</p></div>
                <button type="button" onClick={() => document.querySelector<HTMLTextAreaElement>(".kv-home-composer textarea")?.focus()}>Описать проект</button>
              </div>
            )}
          </section>
        </main>
        <footer className="kv-home-footer"><span>КВАРД <i>•</i> Среда разработки</span><button type="button" onClick={() => onOpenView("news")}>Обновления продукта</button></footer>
      </div>
    </section>
  );
}
