import assert from "node:assert/strict";
import { test } from "node:test";
import { MockProvider } from "./mock.js";

test("Builder mock keeps its stage keyed to the final canonical user task", async () => {
  const previous = process.env.NEXUM_E2E_MOCK_AI;
  process.env.NEXUM_E2E_MOCK_AI = "true";
  try {
    const provider = new MockProvider();
    const task = "Create a unique Builder workspace for stage-key regression";
    const first = await provider.generate([
      "You are the NEXUM.DEV autonomous project builder.",
      `User task: ${task}`,
      "Previous tool results:",
      "No tools have run yet.",
    ].join("\n"));
    assert.deepEqual(JSON.parse(first), { tool: "readFile", input: "index.html" });

    const second = await provider.generate([
      "You are the NEXUM.DEV autonomous project builder.",
      "Earlier context: User task: stale unrelated task",
      `User task: ${task}`,
      "Previous tool results:",
      "readFile: existing starter inspected",
    ].join("\n"));
    assert.deepEqual(JSON.parse(second), {
      tool: "scaffoldProject",
      input: "Сделай React/Vite сайт автосервиса с диагностикой и ремонтом автомобилей",
    });
  } finally {
    if (previous === undefined) delete process.env.NEXUM_E2E_MOCK_AI;
    else process.env.NEXUM_E2E_MOCK_AI = previous;
  }
});
