import { useEffect, useMemo, useState } from "react";
import type { Project } from "./types";
import "../nexum-desktop-v3.css";
import "../nexum-desktop-v4.css";
import "../nexum-liquid-glass.css";

interface OSDesktopProps {
  projects: Project[];
  onNewProject: () => void;
  onOpenProject: (id: string, tab?: "preview" | "files" | "agent" | "code") => void;
  onOpenView: (view: "connectors" | "diagnostics" | "settings" | "news") => void;
  runningProjectIds?: string[];
  minimizedProjectIds?: string[];
  onRestoreProject?: (id: string) => void;
}

const apps = [
  { id: "projects", label: "Проекты", icon: "grid", tone: "light" },
  { id: "agent", label: "AI Agent", icon: "spark", tone: "dark" },
  { id: "code", label: "Code", icon: "code", tone: "code" },
  { id: "preview", label: "Preview", icon: "preview", tone: "preview" },
  { id: "connectors", label: "Connectors", icon: "link", tone: "light" },
  { id: "diagnostics", label: "Diagnostics", icon: "pulse", tone: "light" },
  { id: "settings", label: "Settings", icon: "gear", tone: "light" },
];

const monthNames = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const weekDays = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];

function AppIcon({ name }: { name: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "spark") return <svg {...common}><path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/></svg>;
  if (name === "code") return <svg {...common}><path d="m8 7-5 5 5 5"/><path d="m16 7 5 5-5 5"/><path d="m14 4-4 16"/></svg>;
  if (name === "preview") return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18"/><path d="M8 13h4M8 16h7"/></svg>;
  if (name === "link") return <svg {...common}><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1"/></svg>;
  if (name === "pulse") return <svg {...common}><path d="M3 12h4l2-6 4 12 2-6h6"/></svg>;
  if (name === "journal") return <svg {...common}><path d="M6 4.5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z"/><path d="M8 9h8M8 13h6"/></svg>;
  if (name === "gear") return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V20h-2.5v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H6V11.5h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1L9 6.7l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V5h2.5v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 .1 1h.1V13.5h-.1a1.7 1.7 0 0 0-1 1.5Z"/></svg>;
  return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>;
}

export function OSDesktop({ projects, onNewProject, onOpenProject, onOpenView, runningProjectIds = [], minimizedProjectIds = [], onRestoreProject }: OSDesktopProps) {
  const active = projects.filter((project) => project.status === "active");
  const [now, setNow] = useState(() => new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [controlCenterOpen, setControlCenterOpen] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const calendar = useMemo(() => {
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const mondayOffset = firstDay === 0 ? 6 : firstDay - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevDays = new Date(year, month, 0).getDate();
    return Array.from({ length: 42 }, (_, index) => {
      const dayNumber = index - mondayOffset + 1;
      if (dayNumber < 1) return { day: prevDays + dayNumber, outside: true, today: false };
      if (dayNumber > daysInMonth) return { day: dayNumber - daysInMonth, outside: true, today: false };
      return { day: dayNumber, outside: false, today: dayNumber === now.getDate() };
    });
  }, [now]);

  const launch = (id: string) => {
    if (id === "projects" || id === "agent" || id === "code" || id === "preview") {
      if (active[0]) onOpenProject(active[0].id, id === "agent" ? "agent" : id === "code" ? "code" : "preview");
      else onNewProject();
      return;
    }
    onOpenView(id as "connectors" | "diagnostics" | "settings" | "news");
  };

  const time = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const seconds = now.toLocaleTimeString("ru-RU", { second: "2-digit" });
  const dateLabel = now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  const capitalDate = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);

  const handlePointerMove = (event: React.MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    event.currentTarget.style.setProperty("--nx-mx", `${x}`);
    event.currentTarget.style.setProperty("--nx-my", `${y}`);
  };

  return (
    <section className="nexum-os-desktop" aria-label="NEXUM OS Desktop" onMouseMove={handlePointerMove}>
      <div className="os-menubar">
        <div className="os-brand"><span>N</span><strong>NEXUM OS</strong></div>
        <div className="os-menu-center"><span>Workspace</span><span>Window</span><span>Help</span></div>
        <div className="os-system">
          <span>{active.length} projects</span><i /><span>AI Ready</span>
          <button type="button" className="os-clock-menu" onClick={() => setCalendarOpen((value) => !value)} aria-expanded={calendarOpen}>
            <b>{time}</b><small>{capitalDate}</small>
          </button>
          <button type="button" className="os-control-center" onClick={() => setControlCenterOpen((v) => !v)} aria-expanded={controlCenterOpen}>•••</button>
        </div>
        {controlCenterOpen && (
          <div className="os-control-popover" role="dialog" aria-label="Control Center">
            <div className="os-control-title"><b>Control Center</b><button type="button" onClick={() => setControlCenterOpen(false)}>×</button></div>
            <div className="os-control-grid"><button type="button"><strong>AI</strong><span>Ready</span></button><button type="button"><strong>Preview</strong><span>Live</span></button><button type="button"><strong>Git</strong><span>Connected</span></button><button type="button"><strong>Agent</strong><span>Available</span></button></div>
          </div>
        )}
        {calendarOpen && (
          <div className="os-calendar-popover" role="dialog" aria-label="Календарь">
            <div className="os-calendar-top">
              <div><span>СЕГОДНЯ</span><strong>{time}</strong></div>
              <button type="button" onClick={() => setCalendarOpen(false)} aria-label="Закрыть календарь">×</button>
            </div>
            <div className="os-calendar-month"><strong>{monthNames[now.getMonth()]} {now.getFullYear()}</strong><span>{capitalDate}</span></div>
            <div className="os-calendar-grid">
              {weekDays.map((day) => <span key={day} className="os-calendar-weekday">{day}</span>)}
              {calendar.map((cell, index) => <span key={index} className={"os-calendar-day" + (cell.outside ? " outside" : "") + (cell.today ? " today" : "")}>{cell.day}</span>)}
            </div>
          </div>
        )}
      </div>

      <div className="os-desktop-content">
        <div className="os-desktop-topline">
          <div className="os-desktop-location"><span className="os-location-dot" /> NEXUM Workspace</div>
          <div className="os-desktop-status"><span>{active.length} projects</span><span className="status-live"><i /> AI Core Ready</span></div>
        </div>

        <div className="os-desktop-icons" aria-label="Desktop applications">
          {apps.map((app) => (
            <button key={app.id} type="button" className="os-app-icon" onClick={() => launch(app.id)}>
              <span className={"os-app-glyph " + app.tone} data-icon={app.icon}><AppIcon name={app.icon} /></span><b>{app.label}</b>
            </button>
          ))}
          <button type="button" className="os-app-icon" onClick={() => onOpenView("news")}><span className="os-app-glyph journal"><AppIcon name="journal" /></span><b>Journal</b></button>
        </div>

        <aside className="os-desktop-widgets" aria-label="Desktop widgets">
          <div className="os-widget os-clock-card">
            <span className="widget-kicker">NEXUM TIME</span>
            <strong>{time}<sup>{seconds}</sup></strong>
            <span>{capitalDate}</span>
            <i className="os-clock-orbit" aria-hidden="true" />
          </div>
          <button type="button" className="os-widget os-calendar-card" onClick={() => setCalendarOpen(true)}>
            <div className="os-calendar-card-head"><span>CALENDAR</span><strong>{monthNames[now.getMonth()].slice(0, 3).toUpperCase()} {now.getFullYear()}</strong></div>
            <div className="os-calendar-card-grid">{weekDays.map((day) => <span key={day} className="weekday">{day}</span>)}{calendar.slice(0, 35).map((cell, index) => <span key={index} className={(cell.outside ? "outside " : "") + (cell.today ? "today" : "")}>{cell.day}</span>)}</div>
          </button>
        </aside>

        <div className="os-desktop-projects" aria-label="Recent projects">
          <div className="os-stack-header"><span>RECENT</span><small>{active.length} projects</small></div>
          {active.length ? <div className="os-project-stack">{active.slice(0, 5).map((project, index) => (
            <button key={project.id} className="os-project-card" style={{"--stack-i": index} as React.CSSProperties} type="button" onClick={() => onOpenProject(project.id)}>
              <span className="os-project-window"><i /><i /><i /></span><span className="os-project-mark">{project.name.slice(0, 1)}</span><span className="os-project-info"><strong>{project.name}</strong><small>{project.type ?? "Project"}</small></span><span className="os-project-arrow">›</span>
            </button>
          ))}</div> : <button className="os-empty-project" type="button" onClick={onNewProject}><span>＋</span><b>Create your first project</b><small>NEXUM will create a dedicated workspace.</small></button>}
        </div>

        {runningProjectIds.length > 0 && (
          <div className="os-running-bar" aria-label="Running windows">
            <div className="os-section-head"><span>OPEN WINDOWS</span><small>{runningProjectIds.length}</small></div>
            <div className="os-running-list">{runningProjectIds.map((id) => {
              const project = active.find((item) => item.id === id);
              if (!project) return null;
              const minimized = minimizedProjectIds.includes(id);
              return <button key={id} type="button" className={"os-running-item" + (minimized ? " minimized" : "")} onClick={() => onRestoreProject?.(id)}><span className="os-running-mark">{project.name.slice(0, 1).toUpperCase()}</span><span><b>{project.name}</b><small>{minimized ? "Minimized" : "Workspace open"}</small></span><i /></button>;
            })}</div>
          </div>
        )}
      </div>

      <div className="os-dock" aria-label="NEXUM OS Dock">
        <button type="button" className="os-dock-item" onClick={() => launch("projects")} title="Projects"><span className="os-app-glyph light"><AppIcon name="grid" /></span></button>
        <button type="button" className="os-dock-item" onClick={() => launch("agent")} title="AI Agent"><span className="os-app-glyph dark"><AppIcon name="spark" /></span></button>
        <span className="os-dock-separator" />
        <button type="button" className="os-dock-item" onClick={() => launch("code")} title="Code"><span className="os-app-glyph code"><AppIcon name="code" /></span></button>
        <button type="button" className="os-dock-item" onClick={() => launch("preview")} title="Preview"><span className="os-app-glyph preview"><AppIcon name="preview" /></span></button>
        <span className="os-dock-separator" />
        <button type="button" className="os-dock-item" onClick={onNewProject} title="New project"><span className="os-app-glyph new">＋</span></button>
        <button type="button" className="os-dock-item" onClick={() => onOpenView("settings")} title="Settings"><span className="os-app-glyph light"><AppIcon name="gear" /></span></button>
      </div>
    </section>
  );
}
