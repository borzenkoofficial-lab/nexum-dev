import assert from "node:assert/strict";
import { test } from "node:test";
import { createAdaptiveTokenBudget, restoreAdaptiveTokenBudget } from "./tokenBudget.js";

test("Builder lifecycle reserves enough bounded budget for planning, implementation and review", () => {
  const budget = createAdaptiveTokenBudget("Создай сайт ресторана с меню", {
    legacyHardCap: 30_000,
    builderLifecycle: true,
  });

  assert.equal(budget.snapshot().hardCap, 30_000);
  assert.equal(budget.reserve("planner"), 1_200);
  assert.equal(budget.reserve("coder"), 4_000);
  assert.equal(budget.reserve("coder"), 4_000);
  assert.equal(budget.reserve("coder"), 4_000);
  assert.equal(budget.reserve("coder"), 4_000);
  assert.equal(budget.reserve("reviewer"), 1_000);
  assert.equal(budget.snapshot().remaining, 11_800);
});

test("non-Builder tasks retain the existing adaptive tier cap", () => {
  const budget = createAdaptiveTokenBudget("Проанализируй структуру проекта", {
    legacyHardCap: 22_000,
  });

  assert.equal(budget.snapshot().hardCap, 7_000);
});


test("adaptive token budget restores reserved usage without granting new capacity", () => {
  const original = createAdaptiveTokenBudget("Создай сайт ресторана", { legacyHardCap: 30_000, builderLifecycle: true });
  original.reserve("planner");
  original.reserve("coder", 2_000);
  const restored = restoreAdaptiveTokenBudget("Создай сайт ресторана", original.snapshot(), { legacyHardCap: 30_000, builderLifecycle: true });
  assert.deepEqual(restored.snapshot(), original.snapshot());
  // A restored budget keeps the per-role cap: asking for more than the coder cap grants only the cap.
  assert.equal(restored.reserve("coder", 5_000), 4_000);
  assert.equal(restored.snapshot().reserved, original.snapshot().reserved + 4_000);
});

test("adaptive token budget restore rejects incompatible or malformed snapshots", () => {
  const snapshot = createAdaptiveTokenBudget("Analyze project").snapshot();
  assert.throws(() => restoreAdaptiveTokenBudget("Create a CRM app", snapshot), /incompatible/);
  assert.throws(() => restoreAdaptiveTokenBudget("Analyze project", { ...snapshot, remaining: 100 }), /incompatible/);
  assert.throws(() => restoreAdaptiveTokenBudget("Analyze project", { ...snapshot, reserved: -1 }), /incompatible/);
});
