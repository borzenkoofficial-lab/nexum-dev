export function NewsPage() {
  const releases = [
    {
      eyebrow: "VISUAL SYSTEM",
      title: "NEXUM Visual 3.0",
      date: "28 сентября 2026",
      text: "Новая визуальная система NEXUM: светлое рабочее пространство, спокойная иерархия, единый дизайн проектов и переработанный Agent Panel.",
      items: ["Apple / Lovable-inspired workspace", "Новый Project Home", "Agent Panel справа", "Preview как часть рабочего цикла"],
    },
    {
      eyebrow: "INTELLIGENCE",
      title: "NEXUM Intelligence 1.0",
      date: "Сентябрь 2026",
      text: "Первый слой собственной интеллектуальной архитектуры NEXUM: планирование задачи, агентный цикл, инструменты проекта, проверка результата и автоматический repair flow.",
      items: ["Agent planning", "Tool execution", "Preview verification", "Автоматическое исправление"],
    },
    {
      eyebrow: "AGENT",
      title: "Agent Workspace",
      date: "Сентябрь 2026",
      text: "Агент перестал быть просто чатом. Теперь пользователь видит, что происходит с проектом: этапы, текущую операцию, Preview, ошибки и результат.",
      items: ["Pipeline", "Live activity", "Preview / Browser", "Repair last task"],
    },
    {
      eyebrow: "BUILDER",
      title: "Domain-aware generation",
      date: "Сентябрь 2026",
      text: "NEXUM учится создавать продукт по смыслу запроса, а не подменять любую задачу универсальным лендингом.",
      items: ["Тип продукта", "Страницы", "Компоненты", "Сценарии пользователя"],
    },
  ];

  return (
    <section className="news-page">
      <header className="news-hero">
        <div>
          <div className="eyebrow">NEXUM / NEWSROOM</div>
          <h1>Как развивается NEXUM.</h1>
          <p>Здесь мы фиксируем важные релизы, новые возможности и этапы развития продукта.</p>
        </div>
        <div className="news-hero-badge"><span>●</span> Product updates</div>
      </header>

      <article className="news-feature">
        <div className="news-feature-label">LATEST</div>
        <div className="news-feature-content">
          <div className="news-kicker">VISUAL SYSTEM · 3.0</div>
          <h2>NEXUM Visual 3.0</h2>
          <p>Мы перестраиваем интерфейс вокруг одного принципа: разработка должна ощущаться как спокойное создание продукта, а не работа в сложной IDE.</p>
          <button type="button" onClick={() => window.scrollTo({ top: 430, behavior: "smooth" })}>Смотреть изменения ↓</button>
        </div>
        <div className="news-feature-art" aria-hidden="true">
          <div className="news-art-sidebar" />
          <div className="news-art-chat"><i/><i/><i/></div>
          <div className="news-art-agent"><b>AGENT</b><span>✓ Analyze</span><span>✓ Plan</span><span>◉ Build</span><span>○ Test</span></div>
        </div>
      </article>

      <div className="news-section-heading">
        <div><div className="eyebrow">RELEASE NOTES</div><h2>Что мы сделали</h2></div>
        <span>{releases.length} updates</span>
      </div>

      <div className="news-list">
        {releases.map((release, index) => (
          <article className={index === 0 ? "news-card news-card-primary" : "news-card"} key={release.title}>
            <div className="news-card-top"><span>{release.eyebrow}</span><time>{release.date}</time></div>
            <h3>{release.title}</h3>
            <p>{release.text}</p>
            <div className="news-tags">{release.items.map((item) => <span key={item}>✓ {item}</span>)}</div>
          </article>
        ))}
      </div>

      <footer className="news-footer">
        <strong>NEXUM is being built in public.</strong>
        <span>Следите за следующими релизами прямо внутри NEXUM.</span>
      </footer>
    </section>
  );
}
