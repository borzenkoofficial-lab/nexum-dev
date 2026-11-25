import assert from "node:assert/strict";
import { test } from "node:test";
import { generateWithLegacyProvider } from "./legacyProviderAdapter.js";
import type { AIProvider, AIRequest } from "./types.js";

class LegacyStub implements AIProvider {
  id = "legacy";
  name = "Legacy fixture";
  model = "legacy-model";
  capabilities = {
    text: true, code: true, vision: false, toolCalling: false,
    streaming: false, structuredOutput: false, reasoning: false, contextWindow: 8192,
  };
  calls: Array<{ message: string; model?: string; options?: unknown }> = [];
  async generate(message: string, model?: string, options?: unknown): Promise<string> {
    this.calls.push({ message, model, options });
    return "legacy answer";
  }
}

const request = (overrides: Partial<AIRequest> = {}): AIRequest => ({
  version: 1,
  model: "legacy-model",
  messages: [{ role: "user", content: "Hello" }],
  ...overrides,
});

test("legacy bridge preserves message order and role boundaries", async () => {
  const provider = new LegacyStub();
  const response = await generateWithLegacyProvider(provider, request({
    messages: [
      { role: "system", content: "Follow policy" },
      { role: "user", content: "First" },
      { role: "assistant", content: "Earlier answer" },
      { role: "user", content: "Second" },
    ],
  }));
  assert.match(provider.calls[0].message, /^\[SYSTEM\]\nFollow policy/);
  assert.ok(provider.calls[0].message.indexOf("[USER]\nFirst") < provider.calls[0].message.indexOf("[ASSISTANT]\nEarlier answer"));
  assert.ok(provider.calls[0].message.indexOf("[ASSISTANT]\nEarlier answer") < provider.calls[0].message.indexOf("[USER]\nSecond"));
  assert.equal(response.content, "legacy answer");
  assert.equal(response.provider, "legacy");
  assert.equal(response.model, "legacy-model");
  assert.equal(response.usageSource, "unavailable");
});

test("legacy bridge forwards supported generation options and abort signal", async () => {
  const provider = new LegacyStub();
  const controller = new AbortController();
  await generateWithLegacyProvider(provider, request({
    maxTokens: 321,
    temperature: 0.4,
    signal: controller.signal,
  }));
  assert.deepEqual(provider.calls[0].options, {
    maxTokens: 321,
    temperature: 0.4,
    signal: controller.signal,
  });
});

test("legacy bridge rejects unsupported request features before calling the provider", async () => {
  const cases: Array<Partial<AIRequest>> = [
    { messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://example.com/image.png" } }] }] },
    { tools: [{ name: "lookup", inputSchema: { type: "object" } }] },
    { stream: true },
    { responseFormat: "json" },
    { messages: [{ role: "developer", content: "Developer instructions" }] },
    { messages: [{ role: "tool", toolCallId: "call-1", content: "tool output" }] },
    { topP: 0.8 },
    { stopSequences: ["STOP"] },
  ];
  for (const input of cases) {
    const provider = new LegacyStub();
    await assert.rejects(() => generateWithLegacyProvider(provider, request(input)), (error: any) => error?.code === "MODEL_ERROR" && error?.status === 400);
    assert.equal(provider.calls.length, 0);
  }
});

test("legacy bridge does not call provider when request signal is already aborted", async () => {
  const provider = new LegacyStub();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => generateWithLegacyProvider(provider, request({ signal: controller.signal })));
  assert.equal(provider.calls.length, 0);
});
