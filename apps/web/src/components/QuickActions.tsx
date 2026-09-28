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
    { label: "Новый проект", hint: "Создать рабочее пространство", kind: "primary", run: onNewProject },
    { label: "Открыть проект", hint: "Выбрать существующий проект", kind: "secondary", run: onOpenProject },
    { label: "Спросить ИИ", hint: "Перейти к задаче в чате", kind: "secondary", run: onAsk },
    { label: "Предпросмотр", hint: "Обновить live preview", kind: "secondary", run: onPreview },
    { label: "Запустить тесты", hint: "Проверить проект", kind: "ghost", run: () => onTask("Запусти тесты в изолированной среде") },
    { label: "Статус Git", hint: "Проверить изменения", kind: "ghost", run: () => onTask("Покажи статус Git") },
    { label: "Открыть Preview", hint: "Открыть в новой вкладке", kind: "ghost", run: onDeploy },
    { label: "GitHub", hint: "Проверить репозиторий", kind: "ghost", run: () => onTask("Покажи информацию о репозитории GitHub") },
  ] as const;

  return (
    <section className="quick-actions" aria-labelledby="quick-actions-title">
      <div className="section-title" id="quick-actions-title">БЫСТРЫЕ ДЕЙСТВИЯ</div>
      <div className="quick-action-grid">
        {actions.map((action) => (
          <button key={action.label} className={`quick-action quick-action-${action.kind}`} type="button" onClick={action.run}>
            <strong>{action.label}</strong><span>{action.hint}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
