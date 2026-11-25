export type ProjectDomain =
  | "construction" | "automotive" | "delivery" | "ecommerce" | "marketplace"
  | "crm" | "finance" | "healthcare" | "education" | "restaurant" | "real-estate"
  | "portfolio" | "ai" | "generic";

export interface ProjectDomainIntent {
  domain: ProjectDomain;
  productType: string;
  audience: string;
  confidence: number;
}

const RULES: Array<{ domain: ProjectDomain; pattern: RegExp; productType: string; audience: string }> = [
  { domain: "construction", pattern: /строит|строитель|демонтаж|фасад|подряд|отделк|бетон|штукатур|стяжк|монтаж|кровл|стройк|генподряд|бригада|грузчик/i, productType: "строительная компания или строительный сервис", audience: "заказчики, подрядчики и представители бизнеса" },
  { domain: "automotive", pattern: /авто|автомобил|автосервис|сто\b|шиномонтаж|кузов|двигател|ходов|тормоз|масл|запчаст/i, productType: "автосервис или автомобильный бизнес", audience: "владельцы автомобилей" },
  { domain: "delivery", pattern: /доставк|курьер|логист|такси|перевоз|грузоперевоз/i, productType: "сервис доставки или перевозок", audience: "клиенты и исполнители" },
  { domain: "ecommerce", pattern: /магазин|товар|каталог|корзин|checkout|интернет-магазин/i, productType: "интернет-магазин", audience: "покупатели" },
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

export function classifyProjectDomain(task: string): ProjectDomainIntent {
  const source = task.trim();
  const match = RULES.find((rule) => rule.pattern.test(source));
  return match
    ? { domain: match.domain, productType: match.productType, audience: match.audience, confidence: 0.9 }
    : { domain: "generic", productType: "цифровой продукт", audience: "пользователи продукта", confidence: source ? 0.35 : 0 };
}
