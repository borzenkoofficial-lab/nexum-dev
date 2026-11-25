import assert from "node:assert/strict";
import { test } from "node:test";
import { AIGateway } from "../ai/gateway.js";
import { MockProvider } from "../ai/providers/mock.js";
import { AgentLoop } from "./loop.js";
import type { AgentRuntime } from "./types.js";

test("valid model completion is not replaced by an unavailable-tool fallback", async () => {
  let fallbackCalls = 0;
  let plannerCalls = 0;
  const runtime: AgentRuntime = {
    getAvailableTools: () => ["fake"],
    plan: () => {
      fallbackCalls += 1;
      return { tool: "fake", input: "fallback" };
    },
    planWithAI: async (_task, previousResults) => {
      plannerCalls += 1;
      return previousResults.some((item) => item.tool === "fake" && item.result.success)
        ? { tool: "", input: "", done: true, finalResponse: "Проверка завершена." }
        : { tool: "fake", input: "inspect" };
    },
    executeTool: async () => ({ success: true, output: "project inspected" }),
  };

  const result = await new AgentLoop(runtime, new AIGateway([new MockProvider()]), 4)
    .run("Покажи структуру текущего проекта.");

  assert.equal(result.success, true);
  assert.equal(result.finalState, "COMPLETED");
  assert.equal(plannerCalls, 2);
  assert.equal(fallbackCalls, 0);
});
