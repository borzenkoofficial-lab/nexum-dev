/**
 * KVARD Builder plans.
 *
 * PLACEHOLDER PRICING: the prices and limits below are provisional values chosen
 * to make metering and enforcement real before the owner sets final tariffs.
 * Change them here (and only here); nothing else hard-codes a price.
 */
export interface BuilderPlan {
  id: string;
  name: string;
  /** Monthly price in minor currency units (kopecks for RUB). */
  priceMinor: number;
  currency: "RUB";
  /** Builder tasks (ChatJobs) that may start per billing period. */
  tasksPerPeriod: number;
  /** Model tokens per billing period, metered as described in builderBilling.ts. */
  tokensPerPeriod: number;
  /** Builder tasks that may run at the same time for one account. */
  maxParallelTasks: number;
  /** Shown to the user only; never sold. */
  internal?: boolean;
}

export const BUILDER_PLANS: Record<string, BuilderPlan> = {
  free: { id: "free", name: "Free", priceMinor: 0, currency: "RUB", tasksPerPeriod: 15, tokensPerPeriod: 300_000, maxParallelTasks: 1 },
  start: { id: "start", name: "Start", priceMinor: 990_00, currency: "RUB", tasksPerPeriod: 150, tokensPerPeriod: 3_000_000, maxParallelTasks: 2 },
  pro: { id: "pro", name: "Pro", priceMinor: 2_990_00, currency: "RUB", tasksPerPeriod: 600, tokensPerPeriod: 12_000_000, maxParallelTasks: 3 },
  team: { id: "team", name: "Team", priceMinor: 9_990_00, currency: "RUB", tasksPerPeriod: 3_000, tokensPerPeriod: 60_000_000, maxParallelTasks: 6 },
  // Development / CI only: never selectable in production (see resolveDefaultPlanId).
  dev: { id: "dev", name: "Development", priceMinor: 0, currency: "RUB", tasksPerPeriod: 100_000, tokensPerPeriod: 10_000_000_000, maxParallelTasks: 50, internal: true },
};

/**
 * Tokens reserved for one Builder task at start. It equals the AgentLoop hard
 * cap for Builder tasks (tokenBudget.ts, builderLifecycle), so a reservation is
 * always enough to cover the most a single task can consume.
 */
export const BUILDER_TASK_TOKEN_RESERVATION = 30_000;

export function resolveDefaultPlanId(env: NodeJS.ProcessEnv = process.env): string {
  const isProduction = env.NODE_ENV === "production";
  const configured = env.KVARD_BUILDER_DEFAULT_PLAN?.trim();
  const fallback = isProduction ? "free" : "dev";
  const planId = configured || fallback;
  const plan = BUILDER_PLANS[planId];
  if (!plan) throw new Error(`Unknown KVARD_BUILDER_DEFAULT_PLAN: ${planId}`);
  if (isProduction && plan.internal) throw new Error(`Plan ${planId} is internal and cannot be the production default.`);
  return planId;
}

export function getBuilderPlan(planId: string): BuilderPlan {
  const plan = BUILDER_PLANS[planId];
  if (!plan) throw new Error(`Unknown Builder plan: ${planId}`);
  return plan;
}
