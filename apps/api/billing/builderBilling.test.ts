import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  BuilderQuotaError,
  MemoryBuilderBillingStore,
  PostgresBuilderBillingStore,
  STALE_RESERVATION_MS,
  billingPeriod,
  type BuilderBillingStore,
} from "./builderBilling.js";
import { BUILDER_PLANS, BUILDER_TASK_TOKEN_RESERVATION, resolveDefaultPlanId } from "./builderPlans.js";

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);

test("billing period is the UTC calendar month", () => {
  assert.deepEqual(billingPeriod(NOW), { start: Date.UTC(2026, 10, 1), end: Date.UTC(2026, 11, 1) });
  assert.deepEqual(billingPeriod(Date.UTC(2026, 11, 31, 23, 59)), { start: Date.UTC(2026, 11, 1), end: Date.UTC(2027, 0, 1) });
});

test("default plan is free in production and internal plans are refused there", () => {
  assert.equal(resolveDefaultPlanId({ NODE_ENV: "production" }), "free");
  assert.equal(resolveDefaultPlanId({ NODE_ENV: "test" }), "dev");
  assert.throws(() => resolveDefaultPlanId({ NODE_ENV: "production", KVARD_BUILDER_DEFAULT_PLAN: "dev" }), /internal/);
  assert.throws(() => resolveDefaultPlanId({ KVARD_BUILDER_DEFAULT_PLAN: "missing" }), /Unknown/);
});

test("the per-task reservation covers the AgentLoop Builder hard cap", () => {
  assert.equal(BUILDER_TASK_TOKEN_RESERVATION, 30_000);
});

test("reserve is idempotent per job and never belongs to another user", async () => {
  const store = new MemoryBuilderBillingStore("free");
  const first = await store.reserve("user-a", "job-1", NOW);
  const again = await store.reserve("user-a", "job-1", NOW);
  assert.deepEqual(again, first);
  await assert.rejects(store.reserve("user-b", "job-1", NOW), /another user/);
  assert.equal((await store.summary("user-a", NOW)).tasksUsed, 1);
});

test("parallel limit blocks a second running task until the first settles", async () => {
  const store = new MemoryBuilderBillingStore("free");
  await store.reserve("user", "job-1", NOW);
  await assert.rejects(store.reserve("user", "job-2", NOW), (error: unknown) => error instanceof BuilderQuotaError && error.code === "PARALLEL_LIMIT");
  await store.settle("job-1", 1_000, "token_budget_upper_bound", NOW);
  await store.reserve("user", "job-2", NOW);
});

test("settle books metered tokens once, clamped to the reservation", async () => {
  const store = new MemoryBuilderBillingStore("free");
  await store.reserve("user", "job-1", NOW);
  const settled = await store.settle("job-1", BUILDER_TASK_TOKEN_RESERVATION * 10, "token_budget_upper_bound", NOW);
  assert.equal(settled?.billedTokens, BUILDER_TASK_TOKEN_RESERVATION);
  assert.equal(await store.settle("job-1", 1, "token_budget_upper_bound", NOW), null, "second settle must not re-bill");
  assert.equal(await store.release("job-1", NOW), null, "a settled job cannot be refunded by release");
  assert.equal((await store.summary("user", NOW)).tokensUsed, BUILDER_TASK_TOKEN_RESERVATION);
});

test("release returns a reservation for a job that never ran", async () => {
  const store = new MemoryBuilderBillingStore("free");
  await store.reserve("user", "job-1", NOW);
  assert.equal((await store.release("job-1", NOW))?.status, "released");
  const summary = await store.summary("user", NOW);
  assert.equal(summary.tasksUsed, 0);
  assert.equal(summary.tokensUsed, 0);
  assert.equal(summary.activeTasks, 0);
  assert.equal(summary.pricingIsPlaceholder, true);
});

test("task limit is enforced per period and resets next month", async () => {
  const store = new MemoryBuilderBillingStore("free");
  const limit = BUILDER_PLANS.free!.tasksPerPeriod;
  for (let index = 0; index < limit; index += 1) {
    await store.reserve("user", `job-${index}`, NOW);
    await store.settle(`job-${index}`, 100, "token_budget_upper_bound", NOW);
  }
  await assert.rejects(store.reserve("user", "job-over", NOW), (error: unknown) => error instanceof BuilderQuotaError && error.code === "TASK_LIMIT");
  await store.reserve("user", "job-next-month", Date.UTC(2026, 11, 2));
});

test("token limit refuses a task whose reservation would exceed the period allowance", async () => {
  const store = new MemoryBuilderBillingStore("free");
  const fullTasks = Math.floor(BUILDER_PLANS.free!.tokensPerPeriod / BUILDER_TASK_TOKEN_RESERVATION);
  for (let index = 0; index < fullTasks; index += 1) {
    await store.reserve("user", `job-${index}`, NOW);
    await store.settle(`job-${index}`, BUILDER_TASK_TOKEN_RESERVATION, "token_budget_upper_bound", NOW);
  }
  await assert.rejects(store.reserve("user", "job-over", NOW), (error: unknown) => error instanceof BuilderQuotaError && error.code === "TOKEN_LIMIT");
});

test("a reservation abandoned by a crashed run is settled at full reservation once stale", async () => {
  const store = new MemoryBuilderBillingStore("free");
  await store.reserve("user", "job-crashed", NOW);
  const later = NOW + STALE_RESERVATION_MS + 1;
  await store.reserve("user", "job-after", later);
  const summary = await store.summary("user", later);
  assert.equal(summary.tasksUsed, 2);
  assert.equal(summary.activeTasks, 1);
  assert.equal(summary.tokensUsed, BUILDER_TASK_TOKEN_RESERVATION * 2);
});

const databaseUrl = process.env.KVARD_TEST_DATABASE_URL;

test("PostgreSQL store: concurrent reservations of one user respect the parallel limit", { skip: !databaseUrl && "set KVARD_TEST_DATABASE_URL to run against PostgreSQL" }, async () => {
  const previous = process.env.NEXUM_DATABASE_URL;
  const previousSsl = process.env.NEXUM_DB_SSL;
  process.env.NEXUM_DATABASE_URL = databaseUrl;
  process.env.NEXUM_DB_SSL = "false";
  const { closeDatabase } = await import("../db.js");
  try {
    const store: BuilderBillingStore = new PostgresBuilderBillingStore("free");
    const userId = `billing-test-${randomUUID()}`;
    const jobs = Array.from({ length: 5 }, () => randomUUID());
    const results = await Promise.allSettled(jobs.map((jobId) => store.reserve(userId, jobId)));
    const accepted = results.filter((result) => result.status === "fulfilled");
    assert.equal(accepted.length, BUILDER_PLANS.free!.maxParallelTasks, "row lock must serialize concurrent reservations");
    for (const result of results) {
      if (result.status === "rejected") assert.ok(result.reason instanceof BuilderQuotaError && result.reason.code === "PARALLEL_LIMIT");
    }
    const acceptedJob = jobs[results.findIndex((result) => result.status === "fulfilled")]!;
    const settledRow = await store.settle(acceptedJob, 1234, "provider_reported", undefined, { inputTokens: 9000, outputTokens: 1234 });
    assert.equal(settledRow?.billedTokens, 1234);
    assert.equal(settledRow?.meteringBasis, "provider_reported");
    assert.deepEqual([settledRow?.inputTokens, settledRow?.outputTokens], [9000, 1234], "provider actuals are stored separately from billed tokens");
    assert.equal(await store.settle(acceptedJob, 99, "token_budget_upper_bound"), null);
    const summary = await store.summary(userId);
    assert.equal(summary.tasksUsed, 1);
    assert.equal(summary.tokensUsed, 1234);
    assert.equal(summary.activeTasks, 0);
  } finally {
    await closeDatabase();
    if (previous === undefined) delete process.env.NEXUM_DATABASE_URL; else process.env.NEXUM_DATABASE_URL = previous;
    if (previousSsl === undefined) delete process.env.NEXUM_DB_SSL; else process.env.NEXUM_DB_SSL = previousSsl;
  }
});
