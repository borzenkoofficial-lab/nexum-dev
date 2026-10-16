import assert from "node:assert/strict";
import { test } from "node:test";
import { MockProvider } from "./mock.js";

test("E2E Product Planner preserves the requested automotive domain", async () => {
  const previous = process.env.NEXUM_E2E_MOCK_AI;
  process.env.NEXUM_E2E_MOCK_AI = "true";
  try {
    const provider = new MockProvider();
    const response = await provider.generate([
      "NEXUM.DEV AI role: planner",
      "You are the NEXUM product planner.",
      "Turn the user's request into a concrete implementation plan for a coding agent.",
      "User request: Создай сайт автосервиса с диагностикой и ремонтом автомобилей",
    ].join("\n"));
    const plan = JSON.parse(response) as { productType: string; goal: string; components: string[]; acceptanceCriteria: string[] };
    assert.match(plan.productType, /автосервис/i);
    assert.match(plan.goal, /диагностик|ремонт автомобилей/i);
    assert.match(plan.components.join(" "), /автосервис|диагностик|ремонт/i);
    assert.match(plan.acceptanceCriteria.join(" "), /автомобил|автосервис/i);
  } finally {
    if (previous === undefined) delete process.env.NEXUM_E2E_MOCK_AI;
    else process.env.NEXUM_E2E_MOCK_AI = previous;
  }
});
