const chapters = [
  {eyebrow:"FOUNDATION",version:"01",title:"КВАРД. С нуля.",date:"25 сентября 2026",lead:"Первый рабочий контур будущего продукта.",body:"Проект начинается с базовой среды: workspace, проекты, навигация и первый путь от идеи к результату.",tags:["Project Home","Workspace","Foundation"],variant:"home"},
  {eyebrow:"BUILDER",version:"02",title:"От чата к Builder.",date:"25–27 сентября 2026",lead:"Чат становится интерфейсом создания.",body:"Появляется главный сценарий КВАРД: описать продукт, построить его, открыть Preview и продолжить итерацию.",tags:["Chat Builder","Preview","Iterate"],variant:"builder"},
  {eyebrow:"AGENT",version:"03",title:"Агент начинает работать.",date:"27 сентября 2026",lead:"КВАРД получает исполняемый цикл разработки.",body:"Агент планирует задачу, использует инструменты, изменяет проект и показывает пользователю, что происходит.",tags:["Plan","Tools","Live activity"],variant:"agent"},
  {eyebrow:"CONTEXT",version:"04",title:"Проект становится контекстом.",date:"27 сентября 2026",lead:"Файлы и состояние проекта становятся частью мышления агента.",body:"Workspace, файлы, история задач и состояние приложения соединяются в единый контекст, чтобы следующие действия опирались на уже сделанную работу.",tags:["Files","Context","Project state"],variant:"files"},
  {eyebrow:"VERIFY",version:"05",title:"Создать недостаточно.",date:"27 сентября 2026",lead:"КВАРД начинает проверять собственный результат.",body:"В цикл добавляются Preview, проверка, обнаружение проблем и повторный запуск. Цель — не красивый ответ в чате, а работающий результат.",tags:["Preview","Verify","Runtime"],variant:"verify"},
  {eyebrow:"REPAIR",version:"06",title:"Появляется Repair Engine.",date:"27–28 сентября 2026",lead:"Ошибка становится частью нормального рабочего цикла.",body:"КВАРД должен увидеть проблему, понять контекст, внести минимальное исправление и снова проверить Preview вместо остановки на первой ошибке.",tags:["Detect","Repair","Recheck"],variant:"repair"},
  {eyebrow:"INTELLIGENCE",version:"07",title:"КВАРД Intelligence.",date:"Сентябрь 2026",lead:"Мы начинаем разделять интеллект на отдельные уровни.",body:"Планирование, выбор инструментов, доменная логика, контекст и проверка результата постепенно превращаются в самостоятельные части архитектуры.",tags:["Planning","Routing","Domain aware"],variant:"intelligence"},
  {eyebrow:"CORE",version:"08",title:"КВАРД Core Lab.",date:"Сентябрь 2026",lead:"Параллельно мы строим отдельный интеллектуальный слой.",body:"КВАРД Core развивается отдельно от интерфейса КВАРД. Это лаборатория для экспериментов с моделями, локальным inference, памятью, источниками, teachers и собственными AI-пайплайнами.",tags:["Core","Local AI","Memory","Teachers"],variant:"core"},
  {eyebrow:"MODELS",version:"09",title:"AI Engine & Model Routing.",date:"Сентябрь 2026",lead:"Модель не должна быть единственной точкой системы.",body:"Архитектура рассматривает разные модели и провайдеры как взаимозаменяемые двигатели. Локальные модели могут использоваться для части задач, внешние — для более сложного reasoning или coding.",tags:["Model Gateway","Ollama","Routing"],variant:"models"},
  {eyebrow:"TOOLS",version:"10",title:"Tools Engine.",date:"Сентябрь 2026",lead:"Агент получает руки.",body:"Самая важная часть автономного агента — не только модель. Ей нужны безопасные инструменты: читать файлы, искать код, писать изменения, смотреть Git и взаимодействовать с проектом.",tags:["Read","Write","Search","Git"],variant:"tools"},
  {eyebrow:"MEMORY",version:"11",title:"Memory & Project Context.",date:"Сентябрь 2026",lead:"КВАРД должен помнить, над чем работает.",body:"Мы развиваем слой контекста, который связывает текущую задачу с проектом, предыдущими действиями и накопленными знаниями, не превращая каждый запрос в чистый лист.",tags:["Memory","Context","History"],variant:"memory"},
  {eyebrow:"PRODUCT INTELLIGENCE",version:"12",title:"Понимать продукт, а не только prompt.",date:"Сентябрь 2026",lead:"Одна из главных задач — перестать создавать один и тот же шаблон.",body:"Запрос «создай доставку», «создай CRM» или «создай marketplace» должен приводить к разной архитектуре, страницам, сущностям и пользовательским сценариям.",tags:["Product type","Architecture","User flows"],variant:"product"},
  {eyebrow:"VISUAL",version:"13",title:"КВАРД Visual 3.0.",date:"28 сентября 2026",lead:"Интерфейс перестраивается вокруг продукта.",body:"Светлое рабочее пространство, спокойная типографика, Preview и Agent справа. Мы убираем ощущение сложной IDE и строим собственную продуктовую среду.",tags:["Light UI","Agent Panel","Product UX"],variant:"visual"},
  {eyebrow:"NOW",version:"14",title:"КВАРД сегодня.",date:"28 сентября 2026",lead:"Builder, Agent, Preview и Core развиваются одновременно.",body:"Текущий КВАРД — это не финальная версия. Это система, в которой интерфейс, агентный runtime, модели и собственный Core продолжают развиваться вместе.",tags:["КВАРД","КВАРД Core","Agent","Builder"],variant:"now"}
];

export function NewsPage() {
  return (
    <section className="news-page" aria-label="Журнал КВАРД">
      <header className="news-hero">
        <div>
          <h1>Журнал КВАРД</h1>
          <p>Хронология разработки и ключевые изменения продукта.</p>
        </div>
      </header>

      <div className="news-journal-list">
        {chapters.map((chapter) => (
          <article className="news-journal-story" key={chapter.version}>
            <div className="journal-meta">
              <b>{chapter.version}</b>
              <time>{chapter.date}</time>
              <span>{chapter.eyebrow}</span>
            </div>
            <div className="journal-copy">
              <h2>{chapter.title}</h2>
              <p className="journal-lead">{chapter.lead}</p>
              <p className="journal-body">{chapter.body}</p>
              <div className="news-tags">
                {chapter.tags.map((tag) => <span key={tag}>{tag}</span>)}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
