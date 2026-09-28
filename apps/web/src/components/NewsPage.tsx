const releases = [
  {
    id: "origin",
    eyebrow: "ORIGIN",
    title: "NEXUM. С нуля.",
    date: "25 сентября 2026",
    version: "FOUNDATION",
    text: "В этот день появился сам репозиторий NEXUM.DEV. Не готовый продукт, а чистая точка старта: идея AI-конструктора, который должен превращать человеческое описание в работающий цифровой продукт.",
    body: "Первый коммит был буквально началом истории. Дальше задача изменилась: вместо простого интерфейса нужно было построить полноценную систему — проекты, рабочее пространство, агент, инструменты, Preview, данные и безопасный цикл разработки.",
    tags: ["Initial commit", "NEXUM.DEV", "Foundation"],
  },
  {
    id: "first-workspace",
    eyebrow: "WORKSPACE",
    title: "Появляется рабочее пространство.",
    date: "25–27 сентября 2026",
    version: "0.x",
    text: "NEXUM получает основу будущего редактора: проекты, навигацию, проектный workspace, toolbar, файловое дерево и API для работы с файлами.",
    body: "Идея становится интерфейсом. Пользователь должен иметь одно место, где можно создать проект, открыть его, увидеть структуру файлов и перейти от разговора с агентом к реальному результату.",
    tags: ["Projects", "Workspace", "File tree"],
  },
  {
    id: "builder",
    eyebrow: "BUILDER",
    title: "От чата к Builder.",
    date: "27 сентября 2026",
    version: "BUILDER 1.0",
    text: "В NEXUM появляется детерминированный Builder fallback и проверка генерации. Это важный шаг: приложение не должно полностью ломаться, если внешняя AI-модель временно недоступна.",
    body: "Параллельно появились тесты для fallback-генерации и правила, которые не позволяют любой запрос превращать в один и тот же универсальный шаблон.",
    tags: ["Builder", "Fallback", "Generation"],
  },
  {
    id: "agent-history",
    eyebrow: "AGENT",
    title: "Агент начинает помнить работу.",
    date: "27 сентября 2026",
    version: "AGENT 1.0",
    text: "Появляется история агентных задач, диагностика jobs и журнал действий. NEXUM начинает сохранять не только результат, но и сам процесс работы.",
    body: "Это основа будущего автономного цикла. Агенту важно понимать контекст проекта, видеть собственные действия и иметь возможность проверить, что произошло после изменения файлов.",
    tags: ["Job history", "Diagnostics", "Action journal"],
  },
  {
    id: "project-context",
    eyebrow: "INTELLIGENCE",
    title: "Проект становится контекстом.",
    date: "27 сентября 2026",
    version: "CONTEXT",
    text: "NEXUM получает менеджер контекста проекта и постоянный контекст для планировщика. Запрос больше не существует отдельно от проекта.",
    body: "Название, тип, описание и состояние проекта начинают участвовать в принятии решений агента. Это переход от «чат-бота с кодом» к системе, которая работает внутри конкретного продукта.",
    tags: ["Project context", "Planner", "Persistent context"],
  },
  {
    id: "completion",
    eyebrow: "VERIFICATION",
    title: "Агент учится доказывать результат.",
    date: "27 сентября 2026",
    version: "VERIFY",
    text: "Вводится runtime completion gate и сохранение domain verification. NEXUM начинает разделять «файлы изменены» и «задача действительно завершена».",
    body: "После генерации система должна проверять состояние runtime, результат и соответствие задаче. Позже эта логика станет основой Preview → ошибка → диагностика → исправление → повторная проверка.",
    tags: ["Completion gate", "Domain verification", "Runtime"],
  },
  {
    id: "language",
    eyebrow: "LOCALIZATION",
    title: "NEXUM начинает говорить по-русски.",
    date: "27 сентября 2026",
    version: "RU",
    text: "Основной workspace, настройки и протокол планирования переводятся на русский язык.",
    body: "Это не только перевод кнопок. Агент получает языковой протокол планирования, чтобы русский запрос пользователя сохранялся как часть нормального рабочего процесса.",
    tags: ["Russian UI", "Agent protocol", "i18n"],
  },
  {
    id: "database",
    eyebrow: "INFRASTRUCTURE",
    title: "Проект получает постоянное состояние.",
    date: "27 сентября 2026",
    version: "DATA",
    text: "Добавляются миграции, проектные метаданные и поддержка PostgreSQL. NEXUM выходит за пределы временного состояния браузера.",
    body: "Проекты получают описание и тип, backend начинает хранить их состояние, а инфраструктура готовится к реальным данным и длительным сессиям.",
    tags: ["PostgreSQL", "Migrations", "Project metadata"],
  },
  {
    id: "repair",
    eyebrow: "AUTONOMY",
    title: "Появляется цикл самопроверки.",
    date: "27–28 сентября 2026",
    version: "REPAIR FLOW",
    text: "NEXUM получает проверки после записи, обновление verification state и repair flow. Агент может не просто создать результат, а вернуться к нему после обнаружения проблемы.",
    body: "Главная идея цикла: построить → запустить → проверить → найти проблему → исправить → снова проверить. Это один из ключевых переходов NEXUM к автономной разработке.",
    tags: ["Self-check", "Repair", "Verification"],
  },
  {
    id: "agent-workspace",
    eyebrow: "AGENT",
    title: "Agent Workspace.",
    date: "Сентябрь 2026",
    version: "WORKSPACE 2.0",
    text: "Агент перестаёт быть просто сообщениями в чате. Справа появляется отдельное рабочее пространство с этапами, текущей активностью, Preview, ошибками и результатом.",
    body: "Теперь пользователь видит процесс разработки: анализ, планирование, архитектуру, создание файлов, UI, запуск, проверку и исправления.",
    tags: ["Pipeline", "Live activity", "Preview", "Repair last task"],
  },
  {
    id: "visual-system",
    eyebrow: "DESIGN",
    title: "NEXUM Visual 2.0.",
    date: "28 сентября 2026",
    version: "VISUAL 2.0",
    text: "Интерфейс проходит полную визуальную нормализацию: светлые поверхности, спокойная типографика, единая система отступов и понятная иерархия.",
    body: "Мы сознательно ушли от перегруженного IDE-вида, тёмных панелей и декоративного AI-стиля. Workspace должен ощущаться как продукт, а не как техническая консоль.",
    tags: ["Design system", "Light UI", "Hierarchy"],
  },
  {
    id: "newsroom",
    eyebrow: "PRODUCT",
    title: "NEXUM начинает рассказывать о себе.",
    date: "28 сентября 2026",
    version: "NEWSROOM",
    text: "Внутри продукта появляется Newsroom — место, где история NEXUM фиксируется публично, релиз за релизом.",
    body: "Это не маркетинговый список функций. Это журнал развития: от первого коммита до архитектуры агента, проверки результата, Preview и новой визуальной системы.",
    tags: ["Newsroom", "Release history", "Built in public"],
  },
  {
    id: "visual-3",
    eyebrow: "LATEST",
    title: "NEXUM Visual 3.0.",
    date: "28 сентября 2026",
    version: "3.0",
    text: "Текущая версия собирает предыдущие решения в одну систему: Projects → Project → Describe → Agent → Preview → Files → Iterate.",
    body: "Главный принцип Visual 3.0 — сделать разработку спокойной и понятной. Chat остаётся поверхностью создания, Preview и Files — рабочими инструментами, а Agent — прозрачным исполнителем цикла.",
    tags: ["Visual 3.0", "Preview", "Agent", "Files"],
  },
  {
    id: "now",
    eyebrow: "NOW",
    title: "NEXUM сегодня.",
    date: "28 сентября 2026",
    version: "CURRENT",
    text: "Сейчас NEXUM — уже не набор экранов. В проекте есть workspace, AI-провайдер, агентный pipeline, Preview, файловые инструменты, диагностика, repair flow, постоянный проектный контекст и тесты.",
    body: "Следующая глава — не просто добавлять функции. Задача NEXUM — довести автономный цикл до состояния, в котором пользователь описывает продукт, а система сама проходит путь от идеи до проверяемого рабочего результата.",
    tags: ["Ollama", "Agent", "Preview", "Autonomous build"],
  },
];

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

export function NewsPage() {
  return (
    <section className="news-page">
      <header className="news-hero news-hero-history">
        <div>
          <div className="eyebrow">NEXUM / NEWSROOM</div>
          <h1>История NEXUM — от первого коммита до Visual 3.0.</h1>
          <p>
            Это не просто release notes. Здесь собран путь проекта: архитектура,
            агент, проверка результата, дизайн, Preview и решения, которые постепенно
            превратили NEXUM в AI development workspace.
          </p>
        </div>
        <div className="news-hero-meta">
          <span><b>{releases.length}</b> этапов</span>
          <span><b>25–28</b> сентября 2026</span>
          <span><i /> built in public</span>
        </div>
      </header>

      <article className="news-origin">
        <div className="news-origin-index">00</div>
        <div>
          <div className="news-kicker">THE STORY</div>
          <h2>Сначала был один коммит.</h2>
          <p>
            25 сентября 2026 года репозиторий NEXUM.DEV был создан практически с чистого листа.
            За несколько дней проект прошёл путь от первоначальной основы до рабочего пространства
            с агентом, Preview, файловыми инструментами, проверкой результата и отдельной визуальной системой.
          </p>
        </div>
        <div className="news-origin-line"><span>25.09</span><b>→</b><span>28.09</span></div>
      </article>

      <div className="news-section-heading">
        <div>
          <div className="eyebrow">RELEASE JOURNAL</div>
          <h2>Каждая глава.</h2>
        </div>
        <span>{releases.length} milestones</span>
      </div>

      <div className="news-timeline">
        {releases.map((release, index) => (
          <article className={index === releases.length - 1 ? "news-story news-story-current" : "news-story"} key={release.id}>
            <div className="news-story-rail">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <i />
            </div>
            <div className="news-story-main">
              <div className="news-card-top">
                <span>{release.eyebrow}</span>
                <time>{release.date}</time>
              </div>
              <div className="news-story-version">{release.version}</div>
              <h3>{release.title}</h3>
              <p className="news-story-lead">{release.text}</p>
              <p className="news-story-body">{release.body}</p>
              <div className="news-tags">
                {release.tags.map((tag) => <span key={tag}>✓ {tag}</span>)}
              </div>
            </div>
            <div className="news-story-mark" aria-hidden="true">
              <strong>{index === releases.length - 1 ? "NOW" : release.version}</strong>
              <Arrow />
            </div>
          </article>
        ))}
      </div>

      <footer className="news-footer news-footer-history">
        <div>
          <strong>NEXUM is being built in public.</strong>
          <span>От первого коммита до следующего поколения AI development.</span>
        </div>
        <span>Последнее обновление: 28 сентября 2026</span>
      </footer>
    </section>
  );
}
