import assert from "node:assert/strict";
import { test } from "node:test";
import { JobUsageMeter } from "./usageMeter.js";

const call = (outputTokens?: number, inputTokens?: number) => ({ provider: "openai", model: "m", usage: outputTokens === undefined ? null : { outputTokens, inputTokens } });

test("bills provider-reported output tokens when every budgeted call reported usage", () => {
  const meter = new JobUsageMeter();
  meter.record(call(120, 900));
  meter.record(call(380, 1500));
  assert.deepEqual(meter.decide({ reserved: 5200, calls: 2 }), { basis: "provider_reported", billedTokens: 500, inputTokens: 2400, outputTokens: 500 });
});

test("one call without usage falls back to the budget upper bound", () => {
  const meter = new JobUsageMeter();
  meter.record(call(120, 900));
  meter.record(call(undefined));
  const decision = meter.decide({ reserved: 5200, calls: 2 });
  assert.equal(decision.basis, "token_budget_upper_bound");
  assert.equal(decision.billedTokens, 5200);
  assert.equal(decision.outputTokens, 120, "partial actuals are kept for cost analysis");
});

test("budgeted calls that the meter never saw prevent provider-reported billing", () => {
  const meter = new JobUsageMeter();
  meter.record(call(100, 10));
  assert.equal(meter.decide({ reserved: 4000, calls: 3 }).basis, "token_budget_upper_bound");
});

test("no model calls at all bills the (empty) budget", () => {
  assert.deepEqual(new JobUsageMeter().decide({ reserved: 0, calls: 0 }), { basis: "token_budget_upper_bound", billedTokens: 0, inputTokens: null, outputTokens: null });
  assert.equal(new JobUsageMeter().decide(undefined).billedTokens, 0);
});

test("malformed usage is treated as unreported", () => {
  const meter = new JobUsageMeter();
  meter.record({ provider: "x", model: "m", usage: { outputTokens: Number.NaN } });
  assert.equal(meter.decide({ reserved: 100, calls: 1 }).basis, "token_budget_upper_bound");
});
