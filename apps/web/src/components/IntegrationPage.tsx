type IntegrationPageProps = {
  connectedConnectors: string[];
  onToggleConnector: (name: string) => void;
};

type Engine = {
  name: string;
  eyebrow: string;
  description: string;
  role: string;
  state: string;
  icon: string;
};

const engines: Engine[] = [
  { name: "КВАРД Intelligence", eyebrow: "INTELLIGENCE", description: "Слой координации интеллекта КВАРД: понимает задачу, определяет тип продукта, выбирает стратегию и связывает остальные двигатели.", role: "Планирование · маршрутизация · доменная логика", state: "Архитектурный компонент", icon: "N" },
  { name: "Model Gateway", eyebrow: "MODELS", description: "Единая точка доступа к моделям. Распределяет задачи между подключёнными провайдерами и локальными моделями вместо привязки к одному движку.", role: "Провайдеры · маршрутизация · выбор модели", state: "Включено", icon: "M" },
  { name: "КВАРД Core Lab", eyebrow: "CORE", description: "Отдельная лаборатория для собственного AI-слоя: inference, память, источники, teachers и эксперименты с интеллектуальными пайплайнами.", role: "Локальный AI · память · обучающие контуры · источники", state: "Включено", icon: "C" },
  { name: "Repair Engine", eyebrow: "REPAIR", description: "Контур самовосстановления. Находит проблему, анализирует контекст, вносит минимальное исправление и повторно проверяет результат.", role: "Обнаружение · диагностика · исправление · повторная проверка", state: "Включено", icon: "R" },
  { name: "Product Intelligence", eyebrow: "PRODUCT", description: "Понимает, что именно строится. Запрос «доставка», «CRM» или «marketplace» должен вести к разной архитектуре, сущностям, страницам и сценариям.", role: "Тип продукта · архитектура · сценарии", state: "Включено", icon: "P" },
  { name: "Tools Engine", eyebrow: "TOOLS", description: "Инструментальный слой агента: чтение и поиск файлов, запись изменений, Git и другие безопасные действия внутри рабочего пространства.", role: "Чтение · поиск · запись · Git", state: "Включено", icon: "T" },
  { name: "Memory & Context", eyebrow: "MEMORY", description: "Сохраняет проектный контекст, историю задач и знания, чтобы следующий запрос продолжал работу, а не начинал проект с чистого листа.", role: "Контекст проекта · история · знания", state: "Включено", icon: "K" },
  { name: "Verification Engine", eyebrow: "VERIFY", description: "Проверяет не только ответ агента, но и результат: Preview, сборку, runtime-проблемы и критерии готовности.", role: "Сборка · предпросмотр · runtime · проверки", state: "Включено", icon: "V" },
];

const external = [
  ["GitHub", "Код, репозитории, ветки, коммиты и проектный workflow", "Разработка", "G"],
  ["OpenAI", "Внешние модели и API для reasoning, coding и генерации", "AI Provider", "O"],
  ["Ollama", "Локальные модели без обязательной отправки задач во внешний API", "Local AI", "O"],
  ["OrcaRouter", "Маршрутизация внешних моделей через единый API-слой", "AI Provider", "O"],
  ["Supabase", "База данных, авторизация, storage и backend-сервисы", "Backend", "S"],
  ["Telegram", "Боты, сообщения и автоматизация пользовательских сценариев", "Communication", "T"],
];

function Status({ label = "Компонент" }: { label?: string }) {
  return <span className="integration-status"><i />{label}</span>;
}

export function IntegrationPage({ connectedConnectors, onToggleConnector }: IntegrationPageProps) {
  return (
    <section className="integrations-page">
      <header className="integrations-hero">
        <div>
          <div className="eyebrow">КВАРД / ИНТЕГРАЦИИ</div>
          <h1>Инструменты<br /><em>рабочей среды.</em></h1>
          <p>Каталог внутренних компонентов и внешних сервисов. Здесь собраны основные направления, из которых формируется рабочий цикл разработки.</p>
        </div>
        <div className="integration-hero-state"><span><i /></span><div><b>Архитектура КВАРД</b><small>Внутренние компоненты и точки внешнего подключения</small></div></div>
      </header>

      <div className="integration-command-strip">
        <span><b>{engines.length}</b> внутренних компонентов</span>
        <span><b>{external.length}</b> внешних сервисов</span>
        <span><i /> Agent · Core · Repair · Verify</span>
        <span>Model Gateway · Routing</span>
      </div>

      <section className="integration-section">
        <div className="integration-section-heading">
          <div><div className="eyebrow">КВАРД SYSTEM</div><h2>Интеллектуальный слой</h2><p>Это концептуальные компоненты архитектуры: они описывают этапы, необходимые для полного цикла разработки.</p></div>
          <span>ENGINE STACK</span>
        </div>
        <div className="engine-grid">
          {engines.map((engine) => (
            <article className="engine-card" key={engine.name}>
              <div className="engine-card-top"><span className="engine-icon">{engine.icon}</span><Status label="Архитектурный слой" /></div>
              <div className="engine-copy"><span className="engine-eyebrow">{engine.eyebrow}</span><h3>{engine.name}</h3><p>{engine.description}</p></div>
              <div className="engine-role">{engine.role}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="integration-models">
        <div className="models-feature-copy">
          <div className="eyebrow">AI ENGINE / MODEL ROUTING</div>
          <h2>Единый слой моделей</h2>
          <p>Архитектура предусматривает маршрутизацию задач между внешними провайдерами и локальными моделями. Фактический выбор зависит от настроенных подключений и доступных моделей.</p>
          <div className="model-flow"><span>Task</span><i>→</i><span>Intelligence</span><i>→</i><span>Model Gateway</span><i>→</i><span>Best engine</span></div>
        </div>
        <div className="model-status-list">
          {[["Reasoning", "Сложное планирование и анализ", "Сценарий"], ["Coding", "Изменение и генерация кода", "Сценарий"], ["Local AI", "Локальный inference через Ollama", "Сценарий"], ["Fast tasks", "Быстрые классификации и маршрутизация", "Сценарий"]].map(([name,description,state]) => (
            <div className="model-status-row" key={name}><span className="model-status-mark">●</span><div><b>{name}</b><small>{description}</small></div><strong>{state}</strong></div>
          ))}
        </div>
      </section>

      <section className="integration-section external-section">
        <div className="integration-section-heading">
          <div><div className="eyebrow">EXTERNAL SERVICES</div><h2>Внешние сервисы</h2><p>Направления интеграции с внешними платформами. Реальное подключение станет доступно после реализации серверной OAuth/API-инфраструктуры.</p></div>
          <span>PROVIDERS · TOOLS</span>
        </div>
        <div className="external-grid">
          {external.map(([name,description,category,icon]) => {
            const connected = connectedConnectors.includes(name);
            return <article className={"external-card " + (connected ? "is-connected" : "")} key={name}>
              <div className="external-card-top"><span className="external-icon">{icon}</span><Status label={connected ? "Подключено" : "Не подключено"} /></div>
              <span className="external-category">{category}</span><h3>{name}</h3><p>{description}</p>
              <button type="button" onClick={() => onToggleConnector(name)}>{connected ? "Управление подключением" : "Подробнее о подключении"}</button>
            </article>;
          })}
        </div>
      </section>

      <footer className="integration-footer"><div><strong>КВАРД / SYSTEM</strong><span>Builder → Agent → Intelligence → Models → Tools → Preview → Verify → Repair</span></div><Status label="Каталог компонентов" /></footer>
    </section>
  );
}
