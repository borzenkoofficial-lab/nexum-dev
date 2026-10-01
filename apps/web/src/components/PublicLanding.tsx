import { useEffect, useState } from "react";
import "./PublicLanding.css";

type Project = { id: string; name: string; status?: string; updatedAt?: string; };

type Props = {
  projects: Project[];
  onCreateProject: () => void;
  onOpenProject: (id: string) => void;
  onOpenNews: () => void;
};

const headlines = [
  "Создавайте продукты.",
  "Стройте приложения.",
  "Запускайте идеи.",
  "Работайте с AI.",
  "Создавайте целые системы.",
];

const systems = [
  { label: "NEXUM DIGITAL", angle: -92 },
  { label: "NEXUM OS", angle: -68 },
  { label: "AI CORE", angle: -28 },
  { label: "AGENT", angle: 8 },
  { label: "BUILDER", angle: 44 },
  { label: "MARKETPLACE", angle: 78 },
];

export function PublicLanding({ projects, onCreateProject, onOpenProject, onOpenNews }: Props) {
  const [headline, setHeadline] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setHeadline((v) => (v + 1) % headlines.length), 3600);
    return () => window.clearInterval(timer);
  }, []);

  const active = projects.filter((p) => p.status === "active").slice(0, 4);

  return (
    <section className="public-landing">
      <div className="landing-noise" />
      <header className="landing-nav">
        <button className="landing-brand" onClick={onOpenNews} type="button" aria-label="NEXUM Digital">
          <span className="landing-brand-mark">N</span>
          <span><b>NEXUM</b><small>DIGITAL</small></span>
        </button>
        <nav>
          <a href="#systems">Systems</a>
          <a href="#projects">Projects</a>
          <a href="#platform">Platform</a>
        </nav>
        <button className="landing-nav-cta" onClick={onCreateProject} type="button">Open NEXUM <span>↗</span></button>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-copy">
            <div className="landing-eyebrow"><i /> NEXUM DIGITAL / AI CREATION SYSTEM</div>
            <h1>
              {headlines.map((item, i) => (
                <span key={item} className={i === headline ? "headline-line active" : "headline-line"}>{item}</span>
              ))}
              <em>В одном пространстве.</em>
            </h1>
            <p>NEXUM объединяет рабочую среду, AI Core, автономного Agent, Builder и экосистему сервисов в единую систему создания цифровых продуктов.</p>
            <div className="landing-actions">
              <button className="landing-primary" onClick={onCreateProject} type="button">Создать проект <span>→</span></button>
              <button className="landing-secondary" onClick={onOpenNews} type="button">Исследовать NEXUM <span>⌘</span></button>
            </div>
            <div className="landing-proof">
              <span><b>01</b> Describe</span><i>→</i><span><b>02</b> Agent</span><i>→</i><span><b>03</b> Build</span><i>→</i><span><b>04</b> Preview</span>
            </div>
          </div>

          <div className="globe-stage" id="systems" aria-label="NEXUM ecosystem">
            <div className="globe-halo" />
            <div className="globe-orbit orbit-a" />
            <div className="globe-orbit orbit-b" />
            <div className="globe">
              <div className="globe-grid globe-grid-a" />
              <div className="globe-grid globe-grid-b" />
              <div className="globe-light" />
              <div className="globe-continents"><span/><span/><span/><span/></div><div className="globe-core">N</div><div className="globe-scan" />
            </div>
            <div className="globe-caption"><span>GLOBAL SYSTEM</span><b>NEXUM / 01</b></div>
            {systems.map((system) => (
              <div key={system.label} className="system-node" style={{ ["--angle" as string]: `${system.angle}deg` }}>
                <i />
                <span>{system.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-platform" id="platform">
          <div className="section-kicker">THE PLATFORM</div>
          <div className="platform-heading"><h2>Не просто AI.<br /><em>Целая среда.</em></h2><p>От идеи до работающего продукта — без разрыва между чатом, кодом, Preview, файлами и инфраструктурой.</p></div>
          <div className="platform-mockup">
            <div className="mockup-top"><span className="traffic"><i/><i/><i/></span><b>NEXUM.DEV / WORKSPACE</b><span className="mockup-status">● LIVE</span></div>
            <div className="mockup-body">
              <aside className="mock-sidebar"><strong>N</strong><span className="sel"/><span/><span/><span/><small>OS</small></aside>
              <div className="mock-chat"><div className="mock-label">AI AGENT</div><h3>Build the product.<br /><em>Not just the code.</em></h3><p>Describe an idea. NEXUM plans, builds, previews and iterates with you.</p><div className="mock-command">Describe your product… <b>↗</b></div></div>
              <div className="mock-preview"><div className="mock-preview-bar"><span>PREVIEW</span><i>↗</i></div><div className="mock-site"><div className="mock-site-nav"><b>NEXUM</b><span>Studio</span><span>Products</span><span>Contact</span></div><div className="mock-site-hero"><small>AI PRODUCT STUDIO</small><strong>Build what<br />comes next.</strong><div /></div></div></div>
            </div>
          </div>
        </section>

        <section className="landing-projects" id="projects">
          <div className="section-kicker">PROJECTS / LIVE WORKSPACES</div>
          <div className="projects-heading"><h2>Ваши идеи<br /><em>становятся продуктами.</em></h2><button onClick={onCreateProject} type="button">+ Новый проект</button></div>
          <div className="project-showcase-grid">
            {active.length ? active.map((project, i) => (
              <button className={`showcase-card showcase-${i + 1}`} key={project.id} onClick={() => onOpenProject(project.id)} type="button">
                <div className="showcase-chrome"><span>{project.name}</span><i>↗</i></div>
                <div className="showcase-screen"><div className="screen-header"><b>{project.name}</b><span>AI / WORKSPACE</span></div><div className="screen-layout"><div className="screen-sidebar"/><div className="screen-content"><span/><span/><span/></div><div className="screen-float">AGENT<br/><b>READY</b></div></div></div>
                <div className="showcase-meta"><b>{project.name}</b><span>Open workspace →</span></div>
              </button>
            )) : (
              <button className="showcase-card showcase-empty" onClick={onCreateProject} type="button"><div className="empty-plus">+</div><b>Создайте первый продукт</b><span>Открыть NEXUM Builder →</span></button>
            )}
          </div>
        </section>

        <section className="landing-systems-strip" id="systems-detail">
          <div className="section-kicker">NEXUM SYSTEMS</div>
          <div className="systems-strip-grid">
            <article><span>01</span><b>OS</b><p>A desktop environment for your entire digital workspace.</p></article>
            <article><span>02</span><b>AI CORE</b><p>Model routing, memory, tools and intelligence underneath NEXUM.</p></article>
            <article><span>03</span><b>AGENT</b><p>An autonomous execution layer that turns intent into actions.</p></article>
            <article><span>04</span><b>BUILDER</b><p>Design, code, preview and iterate without leaving the system.</p></article>
            <article><span>05</span><b>MARKETPLACE</b><p>Services, extensions and capabilities connected to the ecosystem.</p></article>
          </div>
        </section>

        <section className="landing-ecosystem">
          <div><div className="section-kicker">ONE ECOSYSTEM</div><h2>OS. AI. Agent.<br /><em>Builder. Marketplace.</em></h2></div>
          <p>Каждый слой NEXUM работает как самостоятельная система — вместе они образуют единое цифровое пространство для создания, запуска и развития продуктов.</p>
        </section>

        <footer className="landing-footer"><strong>NEXUM DIGITAL</strong><span>Build what comes next.</span><button onClick={onCreateProject} type="button">Enter NEXUM →</button></footer>
      </main>
    </section>
  );
}
