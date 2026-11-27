import { query, withDatabaseTransaction } from "../db.js";
import { BUILDER_TASK_TOKEN_RESERVATION, getBuilderPlan, resolveDefaultPlanId, type BuilderPlan } from "./builderPlans.js";

/**
 * Builder metering and quota enforcement.
 *
 * Lifecycle of one Builder task (ChatJob):
 *   reserve  — before the job is created: atomically checks the plan's task,
 *              token and parallel limits and books BUILDER_TASK_TOKEN_RESERVATION.
 *   settle   — when the job reaches a terminal state after it actually ran:
 *              books the metered tokens (never more than reserved) exactly once.
 *   release  — when the job never ran (e.g. project lock rejected it): the
 *              reservation is returned and does not count against the plan.
 *
 * Metering basis: output tokens reported by the provider for every model call
 * of the job (`provider_reported`, see billing/usageMeter.ts). When any call
 * lacks provider usage, or a budgeted call was not observed, the job is billed
 * at the AgentLoop token-budget upper bound (`token_budget_upper_bound`), which
 * never under-bills. Provider input/output actuals are stored separately.
 *
 * Every transition is idempotent: settle/release only act on a `reserved` row,
 * so retries, duplicate terminal events or races can never double-charge.
 */

export type BuilderQuotaCode = "TASK_LIMIT" | "TOKEN_LIMIT" | "PARALLEL_LIMIT";

export class BuilderQuotaError extends Error {
  readonly status = 402;
  constructor(readonly code: BuilderQuotaCode, message: string) {
    super(message);
    this.name = "BuilderQuotaError";
  }
}

export type LedgerStatus = "reserved" | "settled" | "released";
export type MeteringBasis = "token_budget_upper_bound" | "provider_reported";

export interface LedgerEntry {
  jobId: string;
  userId: string;
  planId: string;
  periodStart: number;
  status: LedgerStatus;
  reservedTokens: number;
  billedTokens: number;
  meteringBasis: MeteringBasis | null;
  /** Provider-reported actuals, when known (cost analysis; not what is billed). */
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: number;
  settledAt: number | null;
}

export interface BuilderUsageSummary {
  plan: Pick<BuilderPlan, "id" | "name" | "priceMinor" | "currency" | "tasksPerPeriod" | "tokensPerPeriod" | "maxParallelTasks">;
  periodStart: number;
  periodEnd: number;
  tasksUsed: number;
  tokensUsed: number;
  activeTasks: number;
  pricingIsPlaceholder: true;
}

/** Reservations still open after this long belong to a crashed run and are settled at full reservation. */
export const STALE_RESERVATION_MS = 2 * 60 * 60 * 1000;

export function billingPeriod(now = Date.now()): { start: number; end: number } {
  const date = new Date(now);
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  return { start, end };
}

interface Aggregate { tasks: number; tokens: number; active: number }

function enforce(plan: BuilderPlan, used: Aggregate): void {
  if (used.active >= plan.maxParallelTasks) {
    throw new BuilderQuotaError("PARALLEL_LIMIT", `На тарифе ${plan.name} одновременно может выполняться задач: ${plan.maxParallelTasks}. Дождитесь завершения текущей задачи.`);
  }
  if (used.tasks >= plan.tasksPerPeriod) {
    throw new BuilderQuotaError("TASK_LIMIT", `Лимит задач тарифа ${plan.name} на этот месяц исчерпан (${plan.tasksPerPeriod}).`);
  }
  if (used.tokens + BUILDER_TASK_TOKEN_RESERVATION > plan.tokensPerPeriod) {
    throw new BuilderQuotaError("TOKEN_LIMIT", `Лимит токенов тарифа ${plan.name} на этот месяц исчерпан.`);
  }
}

function clampBilled(reserved: number, metered: number): number {
  if (!Number.isFinite(metered) || metered < 0) return reserved;
  return Math.min(reserved, Math.floor(metered));
}

export interface UsageActuals { inputTokens: number | null; outputTokens: number | null }

function cleanActual(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

export interface BuilderBillingStore {
  reserve(userId: string, jobId: string, now?: number): Promise<LedgerEntry>;
  settle(jobId: string, meteredTokens: number, basis: MeteringBasis, now?: number, actual?: UsageActuals): Promise<LedgerEntry | null>;
  release(jobId: string, now?: number): Promise<LedgerEntry | null>;
  summary(userId: string, now?: number): Promise<BuilderUsageSummary>;
}

function toSummary(plan: BuilderPlan, period: { start: number; end: number }, used: Aggregate): BuilderUsageSummary {
  return {
    plan: { id: plan.id, name: plan.name, priceMinor: plan.priceMinor, currency: plan.currency, tasksPerPeriod: plan.tasksPerPeriod, tokensPerPeriod: plan.tokensPerPeriod, maxParallelTasks: plan.maxParallelTasks },
    periodStart: period.start,
    periodEnd: period.end,
    tasksUsed: used.tasks,
    tokensUsed: used.tokens,
    activeTasks: used.active,
    pricingIsPlaceholder: true,
  };
}

/** Single-process store used when PostgreSQL is not configured (local development and unit tests). */
export class MemoryBuilderBillingStore implements BuilderBillingStore {
  private readonly accounts = new Map<string, string>();
  private readonly ledger = new Map<string, LedgerEntry>();
  constructor(private readonly defaultPlanId = resolveDefaultPlanId()) {}

  setPlan(userId: string, planId: string): void {
    getBuilderPlan(planId);
    this.accounts.set(userId, planId);
  }

  private planFor(userId: string): BuilderPlan {
    return getBuilderPlan(this.accounts.get(userId) ?? this.defaultPlanId);
  }

  private aggregate(userId: string, periodStart: number, now: number): Aggregate {
    const used: Aggregate = { tasks: 0, tokens: 0, active: 0 };
    for (const entry of this.ledger.values()) {
      if (entry.userId !== userId || entry.periodStart !== periodStart) continue;
      if (entry.status === "reserved" && now - entry.createdAt > STALE_RESERVATION_MS) {
        Object.assign(entry, { status: "settled", billedTokens: entry.reservedTokens, meteringBasis: "token_budget_upper_bound", settledAt: now });
      }
      if (entry.status === "released") continue;
      used.tasks += 1;
      if (entry.status === "reserved") { used.active += 1; used.tokens += entry.reservedTokens; } else used.tokens += entry.billedTokens;
    }
    return used;
  }

  async reserve(userId: string, jobId: string, now = Date.now()): Promise<LedgerEntry> {
    const existing = this.ledger.get(jobId);
    if (existing) {
      if (existing.userId !== userId) throw new Error("Billing reservation belongs to another user.");
      return { ...existing };
    }
    const plan = this.planFor(userId);
    const period = billingPeriod(now);
    // No await between the check and the insert: atomic within this process.
    enforce(plan, this.aggregate(userId, period.start, now));
    const entry: LedgerEntry = { jobId, userId, planId: plan.id, periodStart: period.start, status: "reserved", reservedTokens: BUILDER_TASK_TOKEN_RESERVATION, billedTokens: 0, meteringBasis: null, inputTokens: null, outputTokens: null, createdAt: now, settledAt: null };
    this.ledger.set(jobId, entry);
    return { ...entry };
  }

  async settle(jobId: string, meteredTokens: number, basis: MeteringBasis, now = Date.now(), actual?: UsageActuals): Promise<LedgerEntry | null> {
    const entry = this.ledger.get(jobId);
    if (!entry || entry.status !== "reserved") return null;
    Object.assign(entry, { status: "settled", billedTokens: clampBilled(entry.reservedTokens, meteredTokens), meteringBasis: basis, inputTokens: cleanActual(actual?.inputTokens), outputTokens: cleanActual(actual?.outputTokens), settledAt: now });
    return { ...entry };
  }

  async release(jobId: string, now = Date.now()): Promise<LedgerEntry | null> {
    const entry = this.ledger.get(jobId);
    if (!entry || entry.status !== "reserved") return null;
    Object.assign(entry, { status: "released", billedTokens: 0, settledAt: now });
    return { ...entry };
  }

  async summary(userId: string, now = Date.now()): Promise<BuilderUsageSummary> {
    const period = billingPeriod(now);
    return toSummary(this.planFor(userId), period, this.aggregate(userId, period.start, now));
  }
}

type LedgerRow = {
  job_id: string; user_id: string; plan_id: string; period_start: Date; status: LedgerStatus;
  reserved_tokens: number; billed_tokens: number; metering_basis: MeteringBasis | null; created_at: Date; settled_at: Date | null;
  input_tokens: number | string | null; output_tokens: number | string | null;
};

function fromRow(row: LedgerRow): LedgerEntry {
  return {
    jobId: row.job_id, userId: row.user_id, planId: row.plan_id, periodStart: new Date(row.period_start).getTime(), status: row.status,
    reservedTokens: Number(row.reserved_tokens), billedTokens: Number(row.billed_tokens), meteringBasis: row.metering_basis,
    inputTokens: row.input_tokens === null || row.input_tokens === undefined ? null : Number(row.input_tokens),
    outputTokens: row.output_tokens === null || row.output_tokens === undefined ? null : Number(row.output_tokens),
    createdAt: new Date(row.created_at).getTime(), settledAt: row.settled_at ? new Date(row.settled_at).getTime() : null,
  };
}

const AGGREGATE_SQL = `SELECT
  COUNT(*) FILTER (WHERE status IN ('reserved','settled'))::int AS tasks,
  COUNT(*) FILTER (WHERE status = 'reserved')::int AS active,
  COALESCE(SUM(CASE WHEN status = 'reserved' THEN reserved_tokens WHEN status = 'settled' THEN billed_tokens ELSE 0 END), 0)::bigint AS tokens
  FROM builder_usage_ledger WHERE user_id = $1 AND period_start = $2`;

const SETTLE_STALE_SQL = `UPDATE builder_usage_ledger
  SET status = 'settled', billed_tokens = reserved_tokens, metering_basis = 'token_budget_upper_bound', settled_at = NOW()
  WHERE user_id = $1 AND status = 'reserved' AND created_at < NOW() - ($2::bigint * INTERVAL '1 millisecond')`;

/** PostgreSQL store: the account row lock serializes concurrent reservations of one user. */
export class PostgresBuilderBillingStore implements BuilderBillingStore {
  constructor(private readonly defaultPlanId = resolveDefaultPlanId()) {}

  async reserve(userId: string, jobId: string, now = Date.now()): Promise<LedgerEntry> {
    const period = billingPeriod(now);
    return withDatabaseTransaction(async (client) => {
      await client.query("INSERT INTO builder_billing_accounts (user_id, plan_id) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING", [userId, this.defaultPlanId]);
      const account = await client.query<{ plan_id: string }>("SELECT plan_id FROM builder_billing_accounts WHERE user_id = $1 FOR UPDATE", [userId]);
      const existing = await client.query<LedgerRow>("SELECT * FROM builder_usage_ledger WHERE job_id = $1", [jobId]);
      if (existing.rows[0]) {
        if (existing.rows[0].user_id !== userId) throw new Error("Billing reservation belongs to another user.");
        return fromRow(existing.rows[0]);
      }
      const plan = getBuilderPlan(account.rows[0]?.plan_id ?? this.defaultPlanId);
      await client.query(SETTLE_STALE_SQL, [userId, STALE_RESERVATION_MS]);
      const used = await client.query<{ tasks: number; active: number; tokens: string }>(AGGREGATE_SQL, [userId, new Date(period.start)]);
      const row = used.rows[0];
      enforce(plan, { tasks: Number(row?.tasks ?? 0), active: Number(row?.active ?? 0), tokens: Number(row?.tokens ?? 0) });
      const inserted = await client.query<LedgerRow>(
        `INSERT INTO builder_usage_ledger (job_id, user_id, plan_id, period_start, status, reserved_tokens)
         VALUES ($1, $2, $3, $4, 'reserved', $5) RETURNING *`,
        [jobId, userId, plan.id, new Date(period.start), BUILDER_TASK_TOKEN_RESERVATION],
      );
      return fromRow(inserted.rows[0]!);
    });
  }

  async settle(jobId: string, meteredTokens: number, basis: MeteringBasis, _now?: number, actual?: UsageActuals): Promise<LedgerEntry | null> {
    const metered = Number.isFinite(meteredTokens) && meteredTokens >= 0 ? Math.floor(meteredTokens) : null;
    const result = await query<LedgerRow>(
      `UPDATE builder_usage_ledger
       SET status = 'settled', billed_tokens = LEAST(reserved_tokens, COALESCE($2::bigint, reserved_tokens)), metering_basis = $3,
           input_tokens = $4, output_tokens = $5, settled_at = NOW()
       WHERE job_id = $1 AND status = 'reserved' RETURNING *`,
      [jobId, metered, basis, cleanActual(actual?.inputTokens), cleanActual(actual?.outputTokens)],
    );
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }

  async release(jobId: string): Promise<LedgerEntry | null> {
    const result = await query<LedgerRow>(
      "UPDATE builder_usage_ledger SET status = 'released', billed_tokens = 0, settled_at = NOW() WHERE job_id = $1 AND status = 'reserved' RETURNING *",
      [jobId],
    );
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }

  async summary(userId: string, now = Date.now()): Promise<BuilderUsageSummary> {
    const period = billingPeriod(now);
    const account = await query<{ plan_id: string }>("SELECT plan_id FROM builder_billing_accounts WHERE user_id = $1", [userId]);
    const plan = getBuilderPlan(account.rows[0]?.plan_id ?? this.defaultPlanId);
    const used = await query<{ tasks: number; active: number; tokens: string }>(AGGREGATE_SQL, [userId, new Date(period.start)]);
    const row = used.rows[0];
    return toSummary(plan, period, { tasks: Number(row?.tasks ?? 0), active: Number(row?.active ?? 0), tokens: Number(row?.tokens ?? 0) });
  }
}

let defaultStore: BuilderBillingStore | null = null;

export function getBuilderBillingStore(): BuilderBillingStore {
  if (!defaultStore) {
    defaultStore = process.env.NEXUM_DATABASE_URL?.trim() ? new PostgresBuilderBillingStore() : new MemoryBuilderBillingStore();
  }
  return defaultStore;
}
