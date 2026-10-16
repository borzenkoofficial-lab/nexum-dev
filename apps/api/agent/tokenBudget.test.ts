import assert from "node:assert/strict";
import { test } from "node:test";
import { createAdaptiveTokenBudget } from "./tokenBudget.js";

test("Builder lifecycle reserves enough bounded budget for planning, implementation and review", () => {
  const budget = createAdaptiveTokenBudget("Создай сайт ресторана с меню", {
    legacyHardCap: 22_000,
    builderLifecycle: true,
  });

  assert.equal(budget.snapshot().hardCap, 22_000);
  assert.equal(budget.reserve("planner"), 1_200);
  assert.equal(budget.reserve("coder"), 4_000);
  assert.equal(budget.reserve("coder"), 4_000);
  assert.equal(budget.reserve("coder"), 4_000);
  assert.equal(budget.reserve("coder"), 4_000);
  assert.equal(budget.reserve("reviewer"), 1_000);
  assert.equal(budget.snapshot().remaining, 3_800);
});

test("non-Builder tasks retain the existing adaptive tier cap", () => {
  const budget = createAdaptiveTokenBudget("Проанализируй структуру проекта", {
    legacyHardCap: 22_000,
  });

  assert.equal(budget.snapshot().hardCap, 7_000);
});
