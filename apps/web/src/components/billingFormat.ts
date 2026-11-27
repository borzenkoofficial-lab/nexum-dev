/** Shape of GET /api/billing/builder → usage (apps/api/billing/builderBilling.ts). */
export interface BuilderUsageSummary {
  plan: { id: string; name: string; priceMinor: number; currency: string; tasksPerPeriod: number; tokensPerPeriod: number; maxParallelTasks: number };
  periodStart: number;
  periodEnd: number;
  tasksUsed: number;
  tokensUsed: number;
  activeTasks: number;
  pricingIsPlaceholder: boolean;
}

export type UsageTone = "success" | "warning" | "danger";

export interface UsageMeter {
  label: string;
  used: string;
  limit: string;
  /** 0..100, rounded down so a meter never shows 100% before the limit is hit. */
  percent: number;
  tone: UsageTone;
}

const numberFormat = new Intl.NumberFormat("ru-RU");

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value / 1_000_000)} млн`;
  if (value >= 10_000) return `${numberFormat.format(Math.round(value / 1_000))} тыс.`;
  return numberFormat.format(value);
}

export function formatPlanPrice(priceMinor: number, currency: string): string {
  if (priceMinor <= 0) return "Бесплатно";
  const amount = new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 0 }).format(priceMinor / 100);
  return `${amount} / мес`;
}

export function usageTone(percent: number): UsageTone {
  if (percent >= 90) return "danger";
  if (percent >= 70) return "warning";
  return "success";
}

function meter(label: string, used: number, limit: number, format: (value: number) => string): UsageMeter {
  const safeLimit = Math.max(0, limit);
  const percent = safeLimit === 0 ? 100 : Math.min(100, Math.floor((Math.max(0, used) / safeLimit) * 100));
  return { label, used: format(used), limit: format(safeLimit), percent, tone: usageTone(percent) };
}

export function buildUsageMeters(summary: BuilderUsageSummary): UsageMeter[] {
  return [
    meter("Задачи AI-агента", summary.tasksUsed, summary.plan.tasksPerPeriod, (value) => numberFormat.format(value)),
    meter("Токены моделей", summary.tokensUsed, summary.plan.tokensPerPeriod, formatTokens),
  ];
}

/** "до 1 декабря" — the moment the period resets, in the viewer's locale/time zone. */
export function formatPeriodReset(periodEnd: number): string {
  return `Обновится ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(periodEnd))}`;
}

export function isUsageSummary(value: unknown): value is BuilderUsageSummary {
  const item = value as BuilderUsageSummary | null;
  return Boolean(item && item.plan && typeof item.plan.name === "string" && Number.isFinite(item.tasksUsed) && Number.isFinite(item.tokensUsed) && Number.isFinite(item.periodEnd));
}
