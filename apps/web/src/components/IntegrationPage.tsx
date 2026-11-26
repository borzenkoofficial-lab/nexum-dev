import { KvardPageHeader } from "./ui/index.ts";

type IntegrationPageProps = {
  connectedConnectors: string[];
  onToggleConnector: (name: string) => void;
};

type Connector = {
  name: string;
  description: string;
  category: string;
};

const providers: Connector[] = [
  { name: "OpenAI", category: "AI-провайдер", description: "Доступ к моделям OpenAI для анализа, планирования и генерации кода." },
  { name: "Ollama", category: "Локальные модели", description: "Запуск локальных моделей в собственной инфраструктуре." },
  { name: "OrcaRouter", category: "AI-провайдер", description: "Маршрутизация запросов к внешним моделям через единый API." },
];

const services: Connector[] = [
  { name: "GitHub", category: "Разработка", description: "Репозитории, ветки, коммиты и управление изменениями проекта." },
  { name: "Supabase", category: "Backend", description: "База данных, авторизация и хранение данных приложения." },
  { name: "Telegram", category: "Коммуникации", description: "Боты и уведомления для рабочих сценариев." },
];

function Status({ connected }: { connected: boolean }) {
  return (
    <span className={"integration-status " + (connected ? "connected" : "neutral")}>
      <i />{connected ? "Подключено" : "Не подключено"}
    </span>
  );
}

export function IntegrationPage({ connectedConnectors, onToggleConnector }: IntegrationPageProps) {
  const groups = [
    { title: "Провайдеры моделей", description: "Сервисы, через которые агент получает доступ к языковым моделям.", items: providers },
    { title: "Инструменты и сервисы", description: "Внешние системы для разработки, хранения данных и коммуникаций.", items: services },
  ];

  return (
    <section className="integrations-page">
      <KvardPageHeader
        className="integrations-hero"
        title="Интеграции"
        titleId="kv-integrations-page-title"
        description="Провайдеры моделей и внешние сервисы, которые могут использовать проекты и агенты."
        descriptionId="kv-integrations-page-description"
      />

      {groups.map((group) => (
        <section className="integration-section" key={group.title}>
          <div className="integration-section-heading">
            <div><h2>{group.title}</h2><p>{group.description}</p></div>
          </div>
          <div className="external-grid">
            {group.items.map((connector) => {
              const connected = connectedConnectors.includes(connector.name);
              return (
                <article className={"external-card " + (connected ? "is-connected" : "")} key={connector.name}>
                  <div className="external-card-top">
                    <span className="external-category">{connector.category}</span>
                    <Status connected={connected} />
                  </div>
                  <h3>{connector.name}</h3>
                  <p>{connector.description}</p>
                  <button type="button" onClick={() => onToggleConnector(connector.name)}>
                    {connected ? "Настроить" : "Подробнее"}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      ))}
      <p className="integration-note">Подключение станет доступно после настройки серверной интеграции. Состояние каждого сервиса отображается по фактическим данным.</p>
    </section>
  );
}
