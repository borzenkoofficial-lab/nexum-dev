interface QuickActionsProps {
  onNewProject: () => void;
  onOpenProject: () => void;
  onAsk: () => void;
  onTask: (task: string) => void;
  onPlaceholder: (label: string) => void;
}

export function QuickActions({ onNewProject, onOpenProject, onAsk, onTask, onPlaceholder }: QuickActionsProps) {
  const actions = [
    { label: "New Project", run: onNewProject },
    { label: "Open Project", run: onOpenProject },
    { label: "Ask AI", run: onAsk },
    { label: "Run Tests", run: () => onTask("Запусти тесты в изолированной среде") },
    { label: "Start Preview", run: () => onPlaceholder("Start Preview") },
    { label: "Git Status", run: () => onTask("Покажи статус Git") },
    { label: "Deploy", run: () => onPlaceholder("Deploy") },
    { label: "GitHub", run: () => onTask("Покажи информацию о репозитории GitHub") },
  ];

  return (
    <section className="quick-actions" aria-labelledby="quick-actions-title">
      <div className="section-title" id="quick-actions-title">QUICK ACTIONS</div>
      <div className="quick-action-grid">
        {actions.map((action) => <button key={action.label} type="button" onClick={action.run}>{action.label}</button>)}
      </div>
    </section>
  );
}
