import { useState } from "react";
import type { Project as Проект } from "./types";

type Props = {
  projects: Проект[];
  onNewProject: (description?: string) => void;
  onOpenProject: (id: string, tab?: "preview" | "files" | "agent" | "code") => void;
  onOpenView: (view: "home" | "project" | "connectors" | "settings" | "news" | "diagnostics") => void;
};

export function BuilderHome({ projects, onNewProject, onOpenProject, onOpenView }: Props) {
  const recent = projects.slice(0, 6);
  const [brief, setBrief] = useState("");

  function createFromBrief() {
    onNewProject(brief.trim());
  }

  function usePrompt(value: string) {
    setBrief(value);
  }

  return (
    <section className="builder-home">
      <header className="builder-home-header">
        <button className="builder-home-brand" type="button" onClick={() => onOpenView("home")} aria-label="NEXUM home">NEXUM</button>
        <nav className="builder-home-nav" aria-label="Main navigation">
          <button type="button" onClick={() => onOpenView("news")}>Journal</button>
          <button type="button" onClick={() => onOpenView("connectors")}>Connectors</button>
          <button type="button" onClick={() => onOpenView("settings")}>Settings</button>
        </nav>
      </header>

      <main className="builder-home-main">
        <div className="builder-home-hero">
          <p className="builder-home-kicker">NEXUM.DEV</p>
          <h1>Что создадим?</h1>
          <p className="builder-home-subtitle">Опишите идею. NEXUM спланирует продукт, создаст код и покажет результат в реальном времени.</p>

          <div className="builder-home-composer">
            <textarea
              aria-label="Describe what you want to build"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="Создай сайт, приложение или интерфейс…"
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  createFromBrief();
                }
              }}
            />
            <div className="builder-home-composer-footer">
              <span>⌘ Enter</span>
              <button type="button" onClick={createFromBrief}>Создать</button>
            </div>
          </div>

          <div className="builder-home-prompts">
            <button type="button" onClick={() => usePrompt("Создай лендинг для бизнеса")}>Лендинг для бизнеса</button>
            <button type="button" onClick={() => usePrompt("Создай SaaS-продукт")}>SaaS-продукт</button>
            <button type="button" onClick={() => usePrompt("Создай мобильное приложение")}>Мобильное приложение</button>
          </div>
        </div>

        {recent.length > 0 && (
          <section className="builder-home-projects">
            <div className="builder-home-section-head">
              <h2>Последние проекты</h2>
              <span>{recent.length}</span>
            </div>
            <div className="builder-home-project-grid">
              {recent.map((project) => (
                <button key={project.id} type="button" className="builder-home-project" onClick={() => onOpenProject(project.id, "agent")}>
                  <span className="builder-home-project-preview">
                    <span>{project.name.slice(0, 1).toUpperCase()}</span>
                  </span>
                  <span className="builder-home-project-meta">
                    <strong>{project.name}</strong>
                    <small>{project.status === "active" ? "Active project" : "Project"}</small>
                  </span>
                  <span className="builder-home-project-arrow">Open</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="builder-home-footer">
        <span>Build with NEXUM</span>
        <span>AI-powered development</span>
      </footer>
    </section>
  );
}
