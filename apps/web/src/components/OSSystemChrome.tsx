import { useEffect, useState } from "react";

interface OSSystemChromeProps {
  appName: string;
  appIcon?: string;
  status?: string;
  onHome: () => void;
  onSearch: () => void;
  onSettings: () => void;
  onNewProject?: () => void;
  activeView: "home" | "project" | "connectors" | "settings" | "news" | "diagnostics";
}

const monthNames = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

export function OSSystemChrome({ appName, appIcon = "N", status = "Система готова", onHome, onSearch, onSettings, onNewProject, activeView }: OSSystemChromeProps) {
  const [now, setNow] = useState(() => new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const dateLabel = now.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" });
  const time = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <header className="nx-system-chrome" aria-label="NEXUM workspace navigation">
        <div className="nx-system-left">
          <button type="button" className="nx-system-brand" onClick={onHome} aria-label="Открыть NEXUM Workspace">
            <span>N</span><strong>NEXUM</strong>
          </button>
          <span className="nx-system-divider" />
          <div className="nx-system-app">
            <span className="nx-system-app-icon">{appIcon}</span>
            <div><strong>{appName}</strong><small>{status}</small></div>
          </div>
        </div>

        <nav className="nx-system-nav" aria-label="Системная навигация">
          <button type="button" className={activeView === "home" ? "active" : ""} onClick={onHome}>Рабочий стол</button>
          <button type="button" onClick={onNewProject}>Новый проект</button>
          <button type="button" onClick={onSearch}>Поиск</button>
        </nav>

        <div className="nx-system-right">
          <span className="nx-system-status"><i />{status}</span>
          <button type="button" className="nx-system-icon-button" onClick={onSearch} aria-label="Системный поиск">⌕</button>
          <button type="button" className="nx-system-clock" onClick={() => setCalendarOpen((value) => !value)} aria-expanded={calendarOpen}>
            <strong>{time}</strong><span>{dateLabel}</span>
          </button>
        </div>
      </header>

      {calendarOpen && (
        <div className="nx-system-calendar" role="dialog" aria-label="Системный календарь">
          <div className="nx-calendar-head"><div><small>СЕГОДНЯ</small><strong>{time}</strong><span>{dateLabel}</span></div><button type="button" onClick={() => setCalendarOpen(false)}>×</button></div>
          <div className="nx-calendar-week"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span></div>
          <div className="nx-calendar-grid">
            {Array.from({ length: 35 }, (_, index) => {
              const day = index - ((new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7) + 1;
              const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
              const valid = day >= 1 && day <= daysInMonth;
              return <span key={index} className={valid && day === now.getDate() ? "today" : !valid ? "muted" : ""}>{valid ? day : ""}</span>;
            })}
          </div>
          <div className="nx-calendar-footer">{monthNames[now.getMonth()]} {now.getFullYear()}</div>
        </div>
      )}

      <nav className="nx-mobile-system-nav" aria-label="NEXUM workspace navigation">
        <button type="button" className={activeView === "home" ? "active" : ""} onClick={onHome}><span>⌂</span><b>Домой</b></button>
        <button type="button" onClick={onNewProject}><span>＋</span><b>Проект</b></button>
        <button type="button" onClick={onSearch}><span>⌕</span><b>Поиск</b></button>
        <button type="button" onClick={onSettings} className={activeView === "settings" ? "active" : ""}><span>⚙</span><b>Система</b></button>
      </nav>
    </>
  );
}
