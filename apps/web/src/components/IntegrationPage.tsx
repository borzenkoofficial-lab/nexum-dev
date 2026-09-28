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
  { name: "NEXUM Intelligence", eyebrow: "INTELLIGENCE", description: "Слой координации интеллекта NEXUM: понимает задачу, определяет тип продукта, выбирает стратегию и связывает остальные двигатели.", role: "Планирование · маршрутизация · доменная логика", state: "Включено", icon: "N" },
  { name: "Model Gateway", eyebrow: "MODELS", description: "Единая точка доступа к моделям. Распределяет задачи между подключёнными провайдерами и локальными моделями вместо привязки к одному движку.", role: "Providers · routing · model selection", state: "Включено", icon: "M" },
  { name: "NEXUM Core Lab", eyebrow: "CORE", description: "Отдельная лаборатория для собственного AI-слоя: inference, память, источники, teachers и эксперименты с интеллектуальными пайплайнами.", role: "Local AI · memory · teachers · sources", state: "Включено", icon: "C" },
  { name: "Repair Engine", eyebrow: "REPAIR", description: "Контур самовосстановления. Находит проблему, анализирует контекст, вносит минимальное исправление и повторно проверяет результат.", role: "Detect · diagnose · repair · recheck", state: "Включено", icon: "R" },
  { name: "Product Intelligence", eyebrow: "PRODUCT", description: "Понимает, что именно строится. Запрос «доставка», «CRM» или «marketplace» должен вести к разной архитектуре, сущностям, страницам и сценариям.", role: "Product type · architecture · user flows", state: "Включено", icon: "P" },
  { name: "Tools Engine", eyebrow: "TOOLS", description: "Инструментальный слой агента: чтение и поиск файлов, запись изменений, Git и другие безопасные действия внутри рабочего пространства.", role: "Read · search · write · Git", state: "Включено", icon: "T" },
  { name: "Memory & Context", eyebrow: "MEMORY", description: "Сохраняет проектный контекст, историю задач и знания, чтобы следующий запрос продолжал работу, а не начинал проект с чистого листа.", role: "Project context · history · knowledge", state: "Включено", icon: "K" },
  { name: "Verification Engine", eyebrow: "VERIFY", description: "Проверяет не только ответ агента, но и результат: Preview, сборку, runtime-проблемы и критерии готовности.", role: "Build · Preview · runtime · checks", state: "Включено", icon: "V" },
];

const external = [
  ["GitHub", "Код, репозитории, ветки, коммиты и проектный workflow", "Разработка", "G"],
  ["OpenAI", "Внешние модели и API для reasoning, coding и генерации", "AI Provider", "O"],
  ["Ollama", "Локальные модели без обязательной отправки задач во внешний API", "Local AI", "O"],
  ["OrcaRouter", "Маршрутизация внешних моделей через единый API-слой", "AI Provider", "O"],
  ["Supabase", "База данных, авторизация, storage и backend-сервисы", "Backend", "S"],
  ["Telegram", "Боты, сообщения и автоматизация пользовательских сценариев", "Communication", "T"],
];

function Status({ label = "Включено" }: { label?: string }) {
  return <span className="integration-status"><i />{label}</span>;
}

export function IntegrationPage({ connectedConnectors, onToggleConnector }: IntegrationPageProps) {
  return (
    <section className="integrations-page">
      <header className="integrations-hero">
        <div>
          <div className="eyebrow">NEXUM / INTEGRATIONS</div>
          <h1>Всё, что работает<br /><em>внутри NEXUM.</em></h1>
          <p>Единый центр для AI-движков, внутренних систем NEXUM и внешних сервисов. Здесь видно, из каких слоёв собирается рабочий цикл создания продукта.</p>
        </div>
        <div className="integration-hero-state"><span><i /></span><div><b>NEXUM stack</b><small>Все основные двигатели доступны в рабочем пространстве</small></div></div>
      </header>

      <div className="integration-command-strip">
        <span><b>{engines.length}</b> NEXUM engines</span>
        <span><b>{external.length}</b> provider slots</span>
        <span><i /> Agent · Core · Repair · Verify</span>
        <span>Model Gateway · Routing</span>
      </div>

      <section className="integration-section">
        <div className="integration-section-heading">
          <div><div className="eyebrow">NEXUM SYSTEM</div><h2>Интеллектуальный слой</h2><p>Это не отдельные кнопки. Это внутренние двигатели, которые вместе формируют агентный цикл NEXUM.</p></div>
          <span>ENGINE STACK</span>
        </div>
        <div className="engine-grid">
          {engines.map((engine) => (
            <article className="engine-card" key={engine.name}>
              <div className="engine-card-top"><span className="engine-icon">{engine.icon}</span><Status /></div>
              <div className="engine-copy"><span className="engine-eyebrow">{engine.eyebrow}</span><h3>{engine.name}</h3><p>{engine.description}</p></div>
              <div className="engine-role">{engine.role}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="integration-models">
        <div className="models-feature-copy">
          <div className="eyebrow">AI ENGINE / MODEL ROUTING</div>
          <h2>Модели работают как единый слой.</h2>
          <p>NEXUM не должен зависеть от одной модели. Model Gateway определяет, какой двигатель нужен для конкретной задачи: локальный inference, coding, reasoning, планирование или проверка.</p>
          <div className="model-flow"><span>Task</span><i>→</i><span>Intelligence</span><i>→</i><span>Model Gateway</span><i>→</i><span>Best engine</span></div>
        </div>
        <div className="model-status-list">
          {[["Reasoning", "Сложное планирование и анализ", "READY"], ["Coding", "Изменение и генерация кода", "READY"], ["Local AI", "Локальный inference через Ollama", "READY"], ["Fast tasks", "Быстрые классификации и маршрутизация", "READY"]].map(([name,description,state]) => (
            <div className="model-status-row" key={name}><span className="model-status-mark">●</span><div><b>{name}</b><small>{description}</small></div><strong>{state}</strong></div>
          ))}
        </div>
      </section>

      <section className="integration-section external-section">
        <div className="integration-section-heading">
          <div><div className="eyebrow">EXTERNAL SERVICES</div><h2>Внешние интеграции</h2><p>Сервисы, которые можно подключить к рабочему пространству. Статус сохраняется локально в интерфейсе до появления полноценного OAuth/API-хранилища.</p></div>
          <span>PROVIDERS · TOOLS</span>
        </div>
        <div className="external-grid">
          {external.map(([name,description,category,icon]) => {
            const connected = connectedConnectors.includes(name);
            return <article className={"external-card " + (connected ? "is-connected" : "")} key={name}>
              <div className="external-card-top"><span className="external-icon">{icon}</span><Status label={connected ? "Подключено" : "Доступно"} /></div>
              <span className="external-category">{category}</span><h3>{name}</h3><p>{description}</p>
              <button type="button" onClick={() => onToggleConnector(name)}>{connected ? "Подключено · Отключить" : "Подключить"}</button>
            </article>;
          })}
        </div>
      </section>

      <footer className="integration-footer"><div><strong>NEXUM / SYSTEM</strong><span>Builder → Agent → Intelligence → Models → Tools → Preview → Verify → Repair</span></div><Status label="Workspace ready" /></footer>
    </section>
  );
}
