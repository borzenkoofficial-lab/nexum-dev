const releases = [
  { eyebrow:"VISUAL SYSTEM", title:"NEXUM Visual 3.0", date:"28 сентября 2026", text:"Светлое рабочее пространство, спокойная иерархия, единый дизайн проектов и переработанный Agent Panel.", items:["Apple / Lovable-inspired workspace","Новый Project Home","Agent Panel справа","Preview как часть рабочего цикла"] },
  { eyebrow:"INTELLIGENCE", title:"NEXUM Intelligence 1.0", date:"Сентябрь 2026", text:"Первый слой интеллектуальной архитектуры NEXUM: планирование, инструменты проекта, проверка результата и repair flow.", items:["Agent planning","Tool execution","Preview verification","Автоматическое исправление"] },
  { eyebrow:"AGENT", title:"Agent Workspace", date:"Сентябрь 2026", text:"Агент перестал быть просто чатом. Пользователь видит этапы, текущую операцию, Preview, ошибки и результат.", items:["Pipeline","Live activity","Preview / Browser","Repair last task"] },
  { eyebrow:"BUILDER", title:"Domain-aware generation", date:"Сентябрь 2026", text:"NEXUM учится создавать продукт по смыслу запроса, а не подменять любую задачу универсальным лендингом.", items:["Тип продукта","Страницы","Компоненты","Сценарии пользователя"] },
];

function BrowserMockup({ className="", title="NEXUM Preview" }: { className?: string; title?: string }) {
  return <div className={`news-mock-browser ${className}`}>
    <div className="news-mock-top"><span/><span/><span/><b>{title}</b></div>
    <div className="news-mock-content"><aside><i/><i/><i/><i/></aside><main><div className="mock-line wide"/><div className="mock-line"/><div className="mock-cards"><i/><i/><i/></div><div className="mock-chart"/></main></div>
  </div>;
}

function PhoneMockup() {
  return <div className="news-phone"><div className="news-phone-speaker"/><div className="news-phone-screen"><div className="phone-status">9:41</div><div className="phone-title">Your project</div><div className="phone-card"/><div className="phone-card short"/><div className="phone-nav"><i/><i/><i/></div></div></div>;
}

function AgentMockup() {
  return <div className="news-agent-mock"><div className="agent-mock-head"><b>AGENT</b><span>● Live</span></div>{["Analyze task","Plan architecture","Build interface","Run Preview","Verify result"].map((item,i)=><div className="agent-mock-step" key={item}><b>{i<3?"✓":i===3?"◉":"○"}</b><span>{item}</span><small>{i<3?"Done":i===3?"Working":"Waiting"}</small></div>)}<div className="agent-mock-progress"><i/></div></div>;
}

export function NewsPage() {
  return <section className="news-page news-page-editorial">
    <header className="news-hero news-hero-editorial">
      <div><div className="eyebrow">NEXUM / NEWSROOM</div><h1>Как развивается NEXUM.</h1><p>Не просто release notes. Это визуальный журнал продукта — от первых экранов до рабочего AI builder.</p></div>
      <div className="news-hero-badge"><span>●</span> Built in public</div>
    </header>

    <article className="news-feature news-feature-editorial">
      <div className="news-feature-content"><div className="news-kicker">VISUAL SYSTEM · 3.0</div><h2>NEXUM Visual 3.0</h2><p>Мы перестраиваем интерфейс вокруг одного принципа: разработка должна ощущаться как спокойное создание продукта, а не работа в сложной IDE.</p><button type="button" onClick={() => window.scrollTo({top:520,behavior:"smooth"})}>Смотреть изменения ↓</button></div>
      <div className="news-feature-art news-feature-art-rich"><BrowserMockup title="NEXUM / Project Home"/><div className="news-floating-agent"><AgentMockup/></div></div>
    </article>

    <section className="news-showcase">
      <div className="news-section-heading"><div><div className="eyebrow">PRODUCT MOCKUPS</div><h2>NEXUM в работе</h2></div><span>UI / Preview / Agent</span></div>
      <div className="news-mockup-grid">
        <article className="news-visual-card news-visual-wide"><div className="news-visual-copy"><span>01 · WORKSPACE</span><h3>Рабочее пространство проекта</h3><p>Чат, Preview и Agent собраны в одном спокойном интерфейсе.</p></div><BrowserMockup title="Delivery App / Preview"/></article>
        <article className="news-visual-card news-visual-phone"><div className="news-visual-copy"><span>02 · RESPONSIVE</span><h3>Продукт сразу выглядит как настоящий сервис.</h3><p>Мобильный сценарий — часть генерации, а не отдельная задача.</p></div><PhoneMockup/></article>
        <article className="news-visual-card news-visual-agent"><div className="news-visual-copy"><span>03 · AGENT</span><h3>Агент показывает работу.</h3><p>Этапы, действия, Preview и проверка результата видны пользователю.</p></div><AgentMockup/></article>
        <article className="news-visual-card news-visual-photo"><div className="news-photo-scene"><div className="photo-window"/><div className="photo-device"><BrowserMockup title="NEXUM"/></div><div className="photo-caption">CREATE · BUILD · VERIFY</div></div></article>
      </div>
    </section>

    <div className="news-section-heading news-release-heading"><div><div className="eyebrow">RELEASE NOTES</div><h2>Что мы сделали</h2></div><span>{releases.length} updates</span></div>
    <div className="news-list">{releases.map((release,index)=><article className={index===0?"news-card news-card-primary":"news-card"} key={release.title}><div className="news-card-top"><span>{release.eyebrow}</span><time>{release.date}</time></div><h3>{release.title}</h3><p>{release.text}</p><div className="news-tags">{release.items.map(item=><span key={item}>✓ {item}</span>)}</div></article>)}</div>
    <footer className="news-footer"><strong>NEXUM is being built in public.</strong><span>Следите за следующими релизами прямо внутри NEXUM.</span></footer>
  </section>;
}
