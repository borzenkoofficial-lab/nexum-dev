import type { GatewayUsageEvent } from "../ai/gateway.js";

export interface MeteringDecision {
  basis: "provider_reported" | "token_budget_upper_bound";
  billedTokens: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** Accumulates provider-reported usage of every model call made for one Builder job. */
export class JobUsageMeter {
  calls = 0;
  reportedCalls = 0;
  inputTokens = 0;
  outputTokens = 0;

  readonly record = (event: GatewayUsageEvent): void => {
    this.calls += 1;
    const usage = event.usage;
    if (!usage || !Number.isFinite(usage.outputTokens) || (usage.outputTokens ?? -1) < 0) return;
    this.reportedCalls += 1;
    this.outputTokens += Math.floor(usage.outputTokens!);
    if (Number.isFinite(usage.inputTokens) && (usage.inputTokens ?? -1) >= 0) this.inputTokens += Math.floor(usage.inputTokens!);
  };

  /**
   * Bills actual output tokens only when every budgeted model call was observed
   * and every observed call carried provider-reported usage. Anything less falls
   * back to the token-budget upper bound, so a missed call can never under-bill.
   */
  decide(budget: { reserved: number; calls: number } | undefined): MeteringDecision {
    const upperBound = budget?.reserved ?? 0;
    const complete = this.calls > 0 && this.reportedCalls === this.calls && this.calls >= (budget?.calls ?? 0);
    if (!complete) {
      return { basis: "token_budget_upper_bound", billedTokens: upperBound, inputTokens: this.reportedCalls ? this.inputTokens : null, outputTokens: this.reportedCalls ? this.outputTokens : null };
    }
    return { basis: "provider_reported", billedTokens: this.outputTokens, inputTokens: this.inputTokens, outputTokens: this.outputTokens };
  }
}
