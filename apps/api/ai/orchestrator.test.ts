import assert from "node:assert/strict";
import { test } from "node:test";
import { AIOrchestrator } from "./orchestrator.js";
import { AIGateway } from "./gateway.js";
import type { AIProvider } from "./types.js";

class RecordingProvider implements AIProvider {
  id = "openrouter";
  name = "Recording";
  model = "openrouter/free";
  calls: Array<{ model?: string; message: string }> = [];
  async generate(message: string, model?: string): Promise<string> {
    this.calls.push({ model, message });
    return JSON.stringify({ done: true, finalResponse: "ok" });
  }
}

test("orchestrator routes roles through the centralized registry", async () => {
  const provider = new RecordingProvider();
  const gateway = new AIGateway([provider], "openrouter");
  const orchestrator = new AIOrchestrator(gateway);
  for (const role of ["planner", "coder", "debugger"] as const) {
    const result = await orchestrator.run(role, "test");
    assert.equal(result.provider, "openrouter");
    assert.ok(result.model);
  }
  assert.equal(provider.calls.length, 3);
});

test("explicit model without provider uses the gateway default provider", async () => {
  const provider = new RecordingProvider();
  const gateway = new AIGateway([provider], "openrouter");
  const orchestrator = new AIOrchestrator(gateway);
  await orchestrator.run("planner", "test", { model: "custom-model" });
  assert.equal(provider.calls[0]?.model, "custom-model");
});
