import { useEffect, useState } from "react";

interface PaletteAction {
  label: string;
  hint: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
}

export function CommandPalette({ open, onClose, actions }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredActions = actions.filter((action) => !normalizedQuery || `${action.label} ${action.hint}`.toLowerCase().includes(normalizedQuery));

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex((index) => Math.min(index, Math.max(filteredActions.length - 1, 0)));
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, Math.max(filteredActions.length - 1, 0))); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); return; }
      if (event.key === "Home") { event.preventDefault(); setActiveIndex(0); return; }
      if (event.key === "End") { event.preventDefault(); setActiveIndex(Math.max(filteredActions.length - 1, 0)); return; }
      if (event.key === "Enter" && filteredActions[activeIndex]) { event.preventDefault(); filteredActions[activeIndex].run(); onClose(); }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, filteredActions, onClose, open]);

  if (!open) return null;

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Палитра команд">\n        <div className="palette-window-bar"><span className="palette-traffic traffic-close" /><span className="palette-traffic traffic-min" /><span className="palette-traffic traffic-max" /><span className="palette-window-title">Command Center</span></div>
        <div className="palette-search"><span aria-hidden="true">⌘K</span><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} placeholder="Поиск команд…" aria-label="Поиск команд" /></div>
        <div className="palette-list" role="listbox">
          {filteredActions.length === 0 ? <div className="palette-empty">Команды не найдены</div> : filteredActions.map((action, index) => (
            <button className={`palette-item ${index === activeIndex ? "active" : ""}`} type="button" role="option" aria-selected={index === activeIndex} key={action.label} onMouseEnter={() => setActiveIndex(index)} onClick={() => { action.run(); onClose(); }}>
              <span>{action.label}</span><kbd>{action.hint}</kbd>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
