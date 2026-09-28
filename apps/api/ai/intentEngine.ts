export type IntentMode = "create" | "modify" | "debug" | "review" | "explain";

export type IntentDomain =
  | "construction"
  | "automotive"
  | "delivery"
  | "ecommerce"
  | "marketplace"
  | "crm"
  | "finance"
  | "healthcare"
  | "education"
  | "restaurant"
  | "real-estate"
  | "portfolio"
  | "ai"
  | "generic";

export interface NexumIntent {
  mode: IntentMode;
  domain: IntentDomain;
  productType: string;
  audience: string;
  goals: string[];
  features: string[];
  visualDirection: string[];
  language: string;
  constraints: string[];
  confidence: number;
  sourceText: string;
}

const DOMAIN_RULES: Array<{ domain: IntentDomain; pattern: RegExp; productType: string; audience: string }> = [
  { domain: "construction", pattern: /строит|строитель|демонтаж|фасад|подряд|отделк|бетон|штукатур|стяжк|монтаж|кровл|стройк|генподряд|бригада|грузчик/i, productType: "строительная компания или строительный сервис", audience: "заказчики, подрядчики и представители бизнеса" },
  { domain: "automotive", pattern: /авто|автомобил|автосервис|сто\b|шиномонтаж|кузов|двигател|ходов|тормоз|масл|запчаст/i, productType: "автосервис или автомобильный бизнес", audience: "владельцы автомобилей" },
  { domain: "delivery", pattern: /доставк|курьер|логист|такси|перевоз|грузоперевоз/i, productType: "сервис доставки или перевозок", audience: "клиенты и исполнители" },
  { domain: "ecommerce", pattern: /магазин|товар|каталог|корзин|checkout|интернет-магазин|маркетплейс товаров/i, productType: "интернет-магазин", audience: "покупатели" },
  { domain: "marketplace", pattern: /marketplace|маркетплейс|площадк|исполнител.*заказ|заказ.*исполнител/i, productType: "маркетплейс", audience: "клиенты и исполнители" },
  { domain: "crm", pattern: /\bcrm\b|клиент.*баз|лид.*сделк|воронк|менеджер.*клиент/i, productType: "CRM-система", audience: "команды продаж и операционные сотрудники" },
  { domain: "finance", pattern: /банк|финанс|бухгалтер|платеж|инвестиц|кредит/i, productType: "финансовый сервис", audience: "клиенты финансового сервиса" },
  { domain: "healthcare", pattern: /медицин|клиник|врач|стоматолог|здоров|диагностик/i, productType: "медицинский сервис", audience: "пациенты и медицинские специалисты" },
  { domain: "education", pattern: /образован|школ|курс|обучен|университет|репетитор/i, productType: "образовательный сервис", audience: "ученики, студенты и преподаватели" },
  { domain: "restaurant", pattern: /ресторан|кафе|доставк.*ед|меню|бар\b|пицц|суши/i, productType: "ресторанный сервис", audience: "гости и клиенты" },
  { domain: "real-estate", pattern: /недвижим|квартир|дом.*прод|аренд.*жиль|риелтор|агентств.*недвиж/i, productType: "сервис недвижимости", audience: "покупатели, арендаторы и собственники" },
  { domain: "portfolio", pattern: /портфолио|личный сайт|визитк|фриланс|резюме/i, productType: "персональный сайт или портфолио", audience: "клиенты и работодатели" },
  { domain: "ai", pattern: /искусственн.*интеллект|\bai\b|нейросет|ии[- ]?агент|генератив/i, productType: "AI-продукт", audience: "пользователи AI-сервиса" },
];

const CREATE = /создай|сделай|разработай|построй|с нуля|create|build|make/i;
const MODIFY = /добавь|измени|поменяй|обнови|переделай|реализуй|modify|update|change|implement/i;
const DEBUG = /ошиб|error|debug|не работает|слом|исправь|failed|crash|exception|runtime|white screen|белый экран/i;
const REVIEW = /проверь|провер|ревью|review|audit|аудит|найди проблемы/i;

function extractList(text: string, patterns: Array<[RegExp, string]>): string[] {
  return patterns.filter(([pattern]) => pattern.test(text)).map(([, value]) => value);
}

export function extractIntent(task: string): NexumIntent {
  const sourceText = task.trim();
  const text = sourceText.toLowerCase();
  const domainRule = DOMAIN_RULES.find((rule) => rule.pattern.test(sourceText));
  const mode: IntentMode =
    DEBUG.test(sourceText) ? "debug"
      : REVIEW.test(sourceText) ? "review"
        : MODIFY.test(sourceText) ? "modify"
          : CREATE.test(sourceText) ? "create"
            : "explain";

  const productType = domainRule?.productType
    ?? (/сайт|website|landing|лендинг/i.test(sourceText) ? "веб-сайт" : /приложен|app|web app/i.test(sourceText) ? "веб-приложение" : "цифровой продукт");
  const audience = domainRule?.audience ?? "пользователи продукта";
  const goals = extractList(sourceText, [
    [/привлеч|заявк|лид|продаж|клиент/i, "привлечение клиентов и заявок"],
    [/каталог|товар|услуг/i, "представление товаров или услуг"],
    [/запис|бронир|заказ/i, "получение и обработка заказов"],
    [/личн.*кабин|профил|авторизац/i, "личный кабинет и идентификация пользователей"],
  ]);
  const features = extractList(sourceText, [
    [/чат|сообщен/i, "чат"],
    [/карта|map|геолокац/i, "карта или геолокация"],
    [/оплат|платеж/i, "оплата"],
    [/форм|заявк/i, "форма заявки"],
    [/поиск|фильтр/i, "поиск и фильтрация"],
    [/админ|администратор/i, "административная панель"],
    [/crm|воронк/i, "CRM-функциональность"],
    [/api|интеграц/i, "API или интеграции"],
  ]);
  const visualDirection = extractList(sourceText, [
    [/светл|white|light|бел/i, "светлая визуальная система"],
    [/темн|dark|графит|черн/i, "тёмная визуальная система"],
    [/минимал|строг|серьез|делов/i, "минималистичный деловой стиль"],
    [/премиум|дорог|luxury/i, "премиальная визуальная подача"],
    [/современн|modern/i, "современная визуальная система"],
  ]);

  const constraints = extractList(sourceText, [
    [/адаптив|мобильн|responsive/i, "адаптивность"],
    [/без.*бэкенд|без.*backend|frontend/i, "без backend, если это явно указано"],
    [/production|продакш/i, "production readiness"],
    [/быстр|производитель/i, "производительность"],
  ]);

  const signalCount = (domainRule ? 1 : 0) + goals.length + features.length + visualDirection.length;
  const confidence = Math.min(1, 0.35 + signalCount * 0.1 + (domainRule ? 0.2 : 0));

  return {
    mode,
    domain: domainRule?.domain ?? "generic",
    productType,
    audience,
    goals,
    features,
    visualDirection,
    language: /англий|english/i.test(sourceText) ? "en" : "ru",
    constraints,
    confidence: Number(confidence.toFixed(2)),
    sourceText: text,
  };
}

export function intentSummary(intent: NexumIntent): string {
  return [
    `domain=${intent.domain}`,
    `mode=${intent.mode}`,
    `productType=${intent.productType}`,
    `audience=${intent.audience}`,
    intent.goals.length ? `goals=${intent.goals.join(", ")}` : "",
    intent.features.length ? `features=${intent.features.join(", ")}` : "",
    intent.visualDirection.length ? `visual=${intent.visualDirection.join(", ")}` : "",
    `language=${intent.language}`,
  ].filter(Boolean).join(" | ");
}
