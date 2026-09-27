interface QuickActionsProps {
  onNewProject: () => void;
  onOpenProject: () => void;
  onAsk: () => void;
  onTask: (task: string) => void;
  onPreview: () => void;
  onDeploy: () => void;
}

export function QuickActions({ onNewProject, onOpenProject, onAsk, onTask, onPreview, onDeploy }: QuickActionsProps) {
  const actions = [
    { label: "Новый проект", run: onNewProject },
    { label: "Открыть проект", run: onOpenProject },
    { label: "Спросить ИИ", run: onAsk },
    { label: "Запустить тесты", run: () => onTask("Запусти тесты в изолированной среде") },
    { label: "Открыть предпросмотр", run: onPreview },
    { label: "Статус Git", run: () => onTask("Покажи статус Git") },
    { label: "Опубликовать", run: onDeploy },
    { label: "GitHub", run: () => onTask("Покажи информацию о репозитории GitHub") },
  ];

  return (
    <section className="quick-actions" aria-labelledby="quick-actions-title">
      <div className="section-title" id="quick-actions-title">БЫСТРЫЕ ДЕЙСТВИЯ</div>
      <div className="quick-action-grid">
        {actions.map((action) => <button key={action.label} type="button" onClick={action.run}>{action.label}</button>)}
      </div>
    </section>
  );
}
