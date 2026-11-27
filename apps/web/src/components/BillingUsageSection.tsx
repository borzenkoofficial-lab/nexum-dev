import { useCallback, useEffect, useState } from "react";
import { nexumRuntime } from "../runtime/Runtime";
import { KvardStatusBadge } from "./ui/index.ts";
import { buildUsageMeters, formatPeriodReset, formatPlanPrice, isUsageSummary, type BuilderUsageSummary } from "./billingFormat.ts";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; usage: BuilderUsageSummary };

/** Plan, monthly usage and limits of the Builder for the signed-in user (GET /api/billing/builder). */
export function BillingUsageSection() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await nexumRuntime.network.fetch("/api/billing/builder", { signal: controller.signal, operation: "billing-usage" });
        const body = await response.json().catch(() => null) as { usage?: unknown; error?: string } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !isUsageSummary(body?.usage)) {
          setState({ status: "error", message: body?.error ?? `Не удалось загрузить тариф (HTTP ${response.status}).` });
          return;
        }
        setState({ status: "ready", usage: body.usage });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: error instanceof Error ? error.message : "Не удалось загрузить тариф." });
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  return (
    <section id="settings-billing" className="settings-section" aria-labelledby="settings-billing-title" aria-busy={state.status === "loading"}>
      <div className="settings-section-head">
        <div><h2 id="settings-billing-title">Тариф и лимиты</h2><p>Задачи AI-агента и токены моделей в текущем месяце.</p></div>
      </div>
      {state.status === "loading" && (
        <div className="settings-card settings-card-wide kv-billing-card kv-billing-card--loading" aria-label="Загрузка тарифа">
          <span className="kv-billing-skeleton" /><span className="kv-billing-skeleton kv-billing-skeleton--short" />
        </div>
      )}
      {state.status === "error" && (
        <div className="settings-card settings-card-wide kv-billing-card" role="alert">
          <strong>Тариф недоступен</strong>
          <small>{state.message}</small>
          <div><button type="button" onClick={retry}>Повторить</button></div>
        </div>
      )}
      {state.status === "ready" && <BillingUsageCard usage={state.usage} />}
    </section>
  );
}

function BillingUsageCard({ usage }: { usage: BuilderUsageSummary }) {
  const meters = buildUsageMeters(usage);
  return (
    <div className="settings-card settings-card-wide kv-billing-card">
      <div className="kv-billing-head">
        <div>
          <strong>{usage.plan.name}</strong>
          <span>{formatPlanPrice(usage.plan.priceMinor, usage.plan.currency)}</span>
        </div>
        {usage.activeTasks > 0
          ? <KvardStatusBadge tone="info" label={`Выполняется: ${usage.activeTasks} из ${usage.plan.maxParallelTasks}`} />
          : <KvardStatusBadge tone="neutral" label={`Параллельно: до ${usage.plan.maxParallelTasks}`} />}
      </div>
      <div className="kv-billing-meters">
        {meters.map((item) => (
          <div key={item.label} className="kv-billing-meter" data-tone={item.tone}>
            <div className="kv-billing-meter-row"><span>{item.label}</span><span className="kv-billing-meter-value">{item.used} из {item.limit}</span></div>
            <div className="kv-billing-track" role="progressbar" aria-label={item.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.percent} aria-valuetext={`${item.used} из ${item.limit}`}>
              <span style={{ width: `${item.percent}%` }} />
            </div>
          </div>
        ))}
      </div>
      <small>{formatPeriodReset(usage.periodEnd)}. Токены учитываются по верхней границе бюджета задачи.</small>
      {usage.pricingIsPlaceholder && <small className="kv-billing-note">Цены и лимиты предварительные и могут измениться. Оплата пока не подключена.</small>}
    </div>
  );
}
