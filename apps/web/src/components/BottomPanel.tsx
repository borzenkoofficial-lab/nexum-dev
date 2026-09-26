interface BottomPanelProps {
  open: boolean;
  onClose: () => void;
}

export function BottomPanel({ open, onClose }: BottomPanelProps) {
  if (!open) return null;
  return (
    <section className="bottom-panel" aria-label="Terminal panel">
      <div className="bottom-panel-header"><span>TERMINAL</span><button type="button" aria-label="Close terminal panel" onClick={onClose}>×</button></div>
      <div className="terminal-empty"><span className="terminal-prompt">$</span><span>Terminal execution is not connected</span><span className="coming-soon">Coming soon</span></div>
    </section>
  );
}
