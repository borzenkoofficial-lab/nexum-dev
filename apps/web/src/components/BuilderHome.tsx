import { useState } from "react";
import type { Project as Проект } from "./types";
import { KvardMark } from "./KvardMark.ts";
import { KvardPageHeader, KvardSurface } from "./ui/index.ts";

type Props = {
  projects: Проект[];
  onNewProject: (description?: string) => void;
  onOpenProject: (id: string, tab?: "preview" | "files" | "agent" | "code") => void;
  onOpenView: (view: "home" | "project" | "connectors" | "settings" | "news" | "diagnostics" | "agents" | "business-agents") => void;
};

const starters = [
  { label: "Сайт компании", description: "Страницы, услуги и заявки", prompt: "Создай современный сайт для моей компании с услугами, преимуществами и формой заявки." },
  { label: "Веб-приложение", description: "Интерфейс, данные и роли", prompt: "Создай полноценное веб-приложение с авторизацией, личным кабинетом и основными рабочими сценариями." },
  { label: "AI-агент", description: "Задачи, инструкции и инструменты", prompt: "Создай AI-агента для автоматизации бизнес-процесса. Сначала определи архитектуру и необходимые инструменты." },
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
        <section className="kv-home-content" id="kv-home-content" aria-label="Обзор">
          <div className="kv-home-heading">
            <div>
              <span className="kv-home-eyebrow">КВАРД / РАБОЧЕЕ ПРОСТРАНСТВО</span>
              <h1>Рабочая среда</h1>
              <p>Создавайте цифровые продукты и управляйте разработкой в одном месте.</p>
            </div>
            <div className="kv-home-project-count"><strong>{projects.length}</strong><span>проектов</span></div>
          </div>

          <KvardSurface as="section" className="kv-home-create-section" variant="raised" padding="lg" aria-labelledby="kv-home-create-title">
            <KvardPageHeader className="kv-home-section-title" headingLevel="h2" title="Что будем создавать?" titleId="kv-home-create-title" description="Опишите идею своими словами или начните с готового сценария." />
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
                <button type="button" onClick={createFromBrief} disabled={!brief.trim()}>Создать проект <span aria-hidden="true">↗</span></button>
              </div>
            </div>
            <div className="kv-home-starters" aria-label="Шаблоны задач">
              {starters.map((starter, index) => (
                <button className="kv-home-starter" key={starter.label} type="button" onClick={() => setPrompt(starter.prompt)}>
                  <span className="kv-home-starter-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <span className="kv-home-starter-copy"><strong>{starter.label}</strong><small>{starter.description}</small></span>
                  <span className="kv-home-starter-arrow" aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
          </KvardSurface>

          <section className="kv-home-recent" aria-labelledby="kv-home-recent-title">
            <KvardPageHeader className="kv-home-section-title" headingLevel="h2" title="Последние проекты" titleId="kv-home-recent-title" />
            {recent.length ? (
              <KvardSurface className="kv-home-project-list" variant="default" padding="none">
                {recent.map((project) => (
                  <button key={project.id} type="button" className="kv-home-project-row" onClick={() => onOpenProject(project.id, "agent")}>
                    <span className="kv-home-project-avatar">{project.name.slice(0, 1).toUpperCase()}</span>
                    <span className="kv-home-project-details"><strong>{project.name}</strong><small>{project.status === "active" ? "Активный проект" : "Проект"}</small></span>
                    <span className="kv-home-project-open">Открыть <b aria-hidden="true">→</b></span>
                  </button>
                ))}
              </KvardSurface>
            ) : (
              <KvardSurface className="kv-home-empty" variant="outline" padding="lg">
                <KvardMark size={42} />
                <div><strong>Пока нет проектов</strong><p>Опишите задачу выше, чтобы создать первый проект.</p></div>
                <button type="button" onClick={() => document.querySelector<HTMLTextAreaElement>(".kv-home-composer textarea")?.focus()}>К описанию</button>
              </KvardSurface>
            )}
          </section>
        </section>
        <footer className="kv-home-footer"><span>КВАРД <i>•</i> Среда разработки</span><button type="button" onClick={() => onOpenView("news")}>Обновления продукта</button></footer>
      </div>
    </section>
  );
}
