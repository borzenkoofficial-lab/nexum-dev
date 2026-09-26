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
  const filteredActions = actions.filter((action) => action.label.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, Math.max(filteredActions.length - 1, 0))); }
      if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
      if (event.key === "Enter" && filteredActions[activeIndex]) { event.preventDefault(); filteredActions[activeIndex].run(); onClose(); }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, filteredActions, onClose, open]);

  if (!open) return null;

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command Palette">
        <div className="palette-search"><span aria-hidden="true">⌘K</span><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} placeholder="Search commands..." aria-label="Search commands" /></div>
        <div className="palette-list" role="listbox">
          {filteredActions.length === 0 ? <div className="palette-empty">No commands found</div> : filteredActions.map((action, index) => (
            <button className={`palette-item ${index === activeIndex ? "active" : ""}`} type="button" role="option" aria-selected={index === activeIndex} key={action.label} onMouseEnter={() => setActiveIndex(index)} onClick={() => { action.run(); onClose(); }}>
              <span>{action.label}</span><kbd>{action.hint}</kbd>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
