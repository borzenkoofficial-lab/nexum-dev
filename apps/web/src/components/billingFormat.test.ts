import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUsageMeters, formatPlanPrice, formatTokens, isUsageSummary, usageTone, type BuilderUsageSummary } from "./billingFormat.ts";

const summary: BuilderUsageSummary = {
  plan: { id: "free", name: "Free", priceMinor: 0, currency: "RUB", tasksPerPeriod: 15, tokensPerPeriod: 300_000, maxParallelTasks: 1 },
  periodStart: Date.UTC(2026, 10, 1),
  periodEnd: Date.UTC(2026, 11, 1),
  tasksUsed: 14,
  tokensUsed: 120_000,
  activeTasks: 0,
  pricingIsPlaceholder: true,
};

test("meters report usage against plan limits with honest rounding", () => {
  const [tasks, tokens] = buildUsageMeters(summary);
  assert.equal(tasks!.percent, 93);
  assert.equal(tasks!.tone, "danger");
  assert.equal(tokens!.percent, 40);
  assert.equal(tokens!.tone, "success");
  const almost = buildUsageMeters({ ...summary, tasksUsed: 2999, plan: { ...summary.plan, tasksPerPeriod: 3000 } })[0]!;
  assert.equal(almost.percent, 99, "a meter must not show 100% before the limit is reached");
  const over = buildUsageMeters({ ...summary, tasksUsed: 20 })[0]!;
  assert.equal(over.percent, 100);
});

test("tones switch at 70% and 90%", () => {
  assert.equal(usageTone(69), "success");
  assert.equal(usageTone(70), "warning");
  assert.equal(usageTone(90), "danger");
});

test("token and price formatting", () => {
  assert.equal(formatTokens(950), "950");
  assert.equal(formatTokens(300_000), "300 тыс.");
  assert.equal(formatTokens(12_000_000), "12 млн");
  assert.equal(formatPlanPrice(0, "RUB"), "Бесплатно");
  assert.match(formatPlanPrice(990_00, "RUB"), /990.*₽.*\/ мес/);
});

test("summary guard rejects malformed API payloads", () => {
  assert.equal(isUsageSummary(summary), true);
  assert.equal(isUsageSummary(null), false);
  assert.equal(isUsageSummary({ plan: {} }), false);
});
