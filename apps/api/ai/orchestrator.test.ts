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

test("orchestrator assigns specialized free models by role", async () => {
  const provider = new RecordingProvider();
  const gateway = new AIGateway([provider], "openrouter");
  const orchestrator = new AIOrchestrator(gateway);
  const planner = await orchestrator.run("planner", "plan a multi-step build");
  const coder = await orchestrator.run("coder", "implement the UI");
  const reviewer = await orchestrator.run("reviewer", "review the generated code");
  const debugger = await orchestrator.run("debugger", "fix the build error");
  assert.match(planner.model, /nemotron/);
  assert.match(coder.model, /north-mini-code|laguna/);
  assert.match(reviewer.model, /qwen|dots|nemotron/);
  assert.match(debugger.model, /north-mini-code|laguna/);
  assert.equal(provider.calls.length, 4);
});
