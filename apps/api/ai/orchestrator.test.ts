import assert from "node:assert/strict";
import { test } from "node:test";
import { AIOrchestrator } from "./orchestrator.js";
import { AIGateway } from "./gateway.js";
import type { AIProvider } from "./types.js";

class RecordingProvider implements AIProvider {
  id = "openrouter";
  name = "Recording";
  model = "openrouter/free";
  capabilities = { text: true, code: true, vision: false, toolCalling: false, streaming: false, structuredOutput: true, reasoning: false, contextWindow: 32768 };
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
  const debugRun = await orchestrator.run("debugger", "fix the build error");
  assert.match(planner.model, /nemotron/);
  assert.match(coder.model, /north-mini-code|laguna/);
  assert.match(reviewer.model, /qwen|dots|nemotron/);
  assert.match(debugRun.model, /north-mini-code|laguna/);
  assert.equal(provider.calls.length, 4);
  assert.equal(planner.provider, "openrouter");
  assert.equal(planner.fallback, false);
});

class FailingFirstModelProvider implements AIProvider {
  id = "openrouter";
  name = "Failing first model";
  model = "openrouter/free";
  capabilities = { text: true, code: true, vision: false, toolCalling: false, streaming: false, structuredOutput: true, reasoning: false, contextWindow: 32768 };
  calls: string[] = [];
  async generate(_message: string, model?: string): Promise<string> {
    const selected = model ?? "";
    this.calls.push(selected);
    if (this.calls.length === 1) throw new Error("429 rate limit");
    return JSON.stringify({ done: true, finalResponse: "recovered" });
  }
}

test("orchestrator fails over to the next compatible model after a rate limit", async () => {
  const provider = new FailingFirstModelProvider();
  const gateway = new AIGateway([provider], "openrouter");
  const orchestrator = new AIOrchestrator(gateway);
  const result = await orchestrator.run("planner", "plan a build");
  assert.equal(result.response, JSON.stringify({ done: true, finalResponse: "recovered" }));
  assert.equal(provider.calls.length, 2);
  assert.notEqual(provider.calls[0], provider.calls[1]);
});
