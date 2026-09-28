const stories = [
  { eyebrow:"FOUNDATION", version:"01", title:"NEXUM. С нуля.", date:"25 сентября 2026", lead:"Первый экран появился как рабочая точка будущего продукта.", body:"NEXUM начинался не как набор красивых экранов. Сначала нужно было создать основу: проект, рабочее пространство и место, где идея превращается в продукт.", tags:["Project Home","Workspace","Foundation"], view:"home" },
  { eyebrow:"BUILDER", version:"02", title:"От чата к Builder.", date:"25–27 сентября 2026", lead:"Чат становится главным способом создавать продукт.", body:"Появляется сценарий Describe → Build → Preview → Iterate. Пользователь описывает задачу, а NEXUM начинает превращать её в структуру продукта.", tags:["Chat Builder","Preview","Iterate"], view:"builder" },
  { eyebrow:"AGENT", version:"03", title:"Агент начинает работать.", date:"27 сентября 2026", lead:"NEXUM получает видимый цикл разработки.", body:"Агент больше не должен быть просто окном с ответом. Он планирует, выполняет действия, показывает прогресс и возвращается к задаче после проверки.", tags:["Plan","Tools","Live activity"], view:"agent" },
  { eyebrow:"CONTEXT", version:"04", title:"Проект становится контекстом.", date:"27 сентября 2026", lead:"NEXUM учится работать внутри конкретного проекта.", body:"Файлы, состояние проекта, история задач и инструменты становятся частью одного рабочего контекста. Это фундамент для последовательной разработки.", tags:["Files","Context","Project state"], view:"files" },
  { eyebrow:"VERIFY", version:"05", title:"Агент учится доказывать результат.", date:"27 сентября 2026", lead:"Создать недостаточно — нужно проверить.", body:"В рабочий цикл добавляются Preview, проверка результата, поиск ошибок и повторная итерация. NEXUM начинает двигаться к замкнутому агентному циклу.", tags:["Preview","Verify","Repair"], view:"verify" },
  { eyebrow:"INTELLIGENCE", version:"06", title:"NEXUM Intelligence.", date:"Сентябрь 2026", lead:"Архитектура постепенно превращается в интеллектуальный слой.", body:"Планирование, выбор инструментов, доменная логика и проверка результата объединяются вокруг одной задачи: понять, какой продукт действительно просит пользователь.", tags:["Planning","Domain aware","Agent"], view:"intelligence" },
  { eyebrow:"VISUAL", version:"07", title:"NEXUM Visual 3.0.", date:"28 сентября 2026", lead:"Интерфейс перестраивается вокруг продукта, а не вокруг IDE.", body:"Светлое рабочее пространство, спокойная типографика, Preview и Agent справа. Интерфейс становится частью самого продукта NEXUM.", tags:["Light UI","Agent Panel","Product UX"], view:"visual" },
];

function BrowserMockup({ title="NEXUM / Preview", variant="workspace", className="" }: { title?: string; variant?: string; className?: string }) {
  const labels: Record<string,string[]> = {
    home:["Projects","New project","Recent","Settings"], builder:["Chat","Preview","Agent","Files"], agent:["Agent","Live","Tasks","History"],
    files:["Files","src","components","App.tsx"], verify:["Preview","Console","Errors","Checks"], intelligence:["Models","Planning","Tools","Memory"],
    visual:["Projects","Chat","Preview","Agent"], workspace:["Workspace","Projects","Preview","Agent"],
  };
  const active = labels[variant] ?? labels.workspace;
  const heading = variant === "builder" ? "Create your product" : variant === "verify" ? "Verification" : variant === "agent" ? "Agent Workspace" : variant === "files" ? "Project files" : "Project Home";
  return <div className={`news-mock-browser ${className}`}>
    <div className="news-mock-top"><span/><span/><span/><b>{title}</b></div>
    <div className="news-product-screen">
      <aside>{active.map((item,i)=><div className={i===0?"mock-nav active":"mock-nav"} key={item}><i/>{item}</div>)}</aside>
      <main>
        <div className="mock-product-header"><div><small>NEXUM PROJECT</small><strong>{heading}</strong></div><span className="mock-live">● Live</span></div>
        {variant === "agent" || variant === "verify" ? <div className="mock-check-list">{["Analyze task","Plan architecture","Build interface","Run Preview","Verify result"].map((x,i)=><div key={x}><b>{i < 3 ? "✓" : i === 3 ? "◉" : "○"}</b><span>{x}</span><small>{i < 3 ? "Done" : i === 3 ? "Working" : "Waiting"}</small></div>)}</div> :
        <><div className="mock-line wide"/><div className="mock-line"/><div className="mock-product-cards"><i/><i/><i/></div><div className="mock-product-canvas"><span/><span/><span/></div></>}
      </main>
    </div>
  </div>;
}

function PhoneMockup({ title="NEXUM" }: { title?: string }) {
  return <div className="news-phone"><div className="news-phone-speaker"/><div className="news-phone-screen"><div className="phone-status">9:41</div><div className="phone-title">{title}</div><div className="phone-card"/><div className="phone-card short"/><div className="phone-nav"><i/><i/><i/></div></div></div>;
}

function AgentMockup() {
  return <div className="news-agent-mock"><div className="agent-mock-head"><b>AGENT</b><span>● Live</span></div>{["Analyze task","Plan architecture","Build interface","Run Preview","Verify result"].map((item,i)=><div className="agent-mock-step" key={item}><b>{i<3?"✓":i===3?"◉":"○"}</b><span>{item}</span><small>{i<3?"Done":i===3?"Working":"Waiting"}</small></div>)}<div className="agent-mock-progress"><i/></div></div>;
}

export function NewsPage() {
  return <section className="news-page news-page-editorial">
    <header className="news-hero news-hero-editorial">
      <div><div className="eyebrow">NEXUM / PRODUCT JOURNAL</div><h1>Мы показываем не только релизы. Мы показываем, как строится NEXUM.</h1><p>Каждая глава — часть продукта. Здесь история разработки превращается в визуальный журнал: реальные идеи, интерфейсы, агентный цикл и то, как NEXUM меняется от версии к версии.</p></div>
      <div className="news-hero-badge"><span>●</span> Built in public</div>
    </header>

    <article className="news-feature news-feature-editorial">
      <div className="news-feature-content"><div className="news-kicker">NOW · VISUAL 3.0</div><h2>NEXUM — это уже продукт, а не просто эксперимент.</h2><p>Рабочее пространство, Builder, Preview, Files и Agent собираются в одну систему. Поэтому журнал тоже должен выглядеть как часть продукта.</p><button type="button" onClick={() => window.scrollTo({top:520,behavior:"smooth"})}>Читать журнал ↓</button></div>
      <div className="news-feature-art news-feature-art-rich"><BrowserMockup title="NEXUM / Project Home" variant="visual"/><div className="news-floating-agent"><AgentMockup/></div></div>
    </article>

    <section className="news-showcase">
      <div className="news-section-heading"><div><div className="eyebrow">PRODUCT MOCKUPS</div><h2>NEXUM в работе</h2></div><span>PRODUCT · UI · AGENT</span></div>
      <div className="news-mockup-grid">
        <article className="news-visual-card news-visual-wide"><div className="news-visual-copy"><span>01 · WORKSPACE</span><h3>Главный экран продукта.</h3><p>Projects, Builder, Preview и Agent живут в одном рабочем пространстве.</p></div><BrowserMockup title="NEXUM / Workspace" variant="workspace"/></article>
        <article className="news-visual-card news-visual-phone"><div className="news-visual-copy"><span>02 · PRODUCT</span><h3>Наш продукт в мобильном формате.</h3><p>Каждый важный сценарий получает собственную визуальную форму.</p></div><PhoneMockup title="NEXUM"/></article>
        <article className="news-visual-card news-visual-agent"><div className="news-visual-copy"><span>03 · AGENT</span><h3>Агент — отдельный продуктовый слой.</h3><p>Пользователь видит не магию, а последовательность работы.</p></div><AgentMockup/></article>
        <article className="news-visual-card news-visual-photo"><div className="news-photo-scene"><div className="photo-window"/><div className="photo-device"><BrowserMockup title="NEXUM / Create · Build · Verify" variant="builder"/></div><div className="photo-caption">NEXUM · CREATE · BUILD · VERIFY</div></div></article>
      </div>
    </section>

    <section className="news-journal">
      <div className="news-section-heading news-release-heading"><div><div className="eyebrow">THE JOURNAL</div><h2>От первой строки к продукту</h2></div><span>{stories.length} chapters</span></div>
      <div className="news-journal-list">{stories.map((story,index)=><article className={index===stories.length-1?"news-journal-story current":"news-journal-story"} key={story.version}>
        <div className="journal-meta"><b>{story.version}</b><span>{story.eyebrow}</span><time>{story.date}</time></div>
        <div className="journal-copy"><h3>{story.title}</h3><p className="journal-lead">{story.lead}</p><p className="journal-body">{story.body}</p><div className="news-tags">{story.tags.map(tag=><span key={tag}>✓ {tag}</span>)}</div></div>
        <div className="journal-art"><BrowserMockup title={`NEXUM / ${story.eyebrow}`} variant={story.view}/></div>
      </article>)}</div>
    </section>

    <footer className="news-footer"><strong>NEXUM is being built in public.</strong><span>Следующая глава появится здесь вместе со следующим изменением продукта.</span></footer>
  </section>;
}
