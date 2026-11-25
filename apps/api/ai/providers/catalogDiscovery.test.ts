import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { OrcaRouterProvider } from "./orcarouter.js";
import { AnyModelProvider } from "./anymodel.js";

const key = "test-provider-key-that-is-long-enough-123456";
const response = (models: unknown[]) => new Response(JSON.stringify({ data: models }), {
  status: 200, headers: { "content-type": "application/json" },
});

test("OpenAI catalog contains only model IDs returned by the authenticated provider API", async () => {
  const provider = new OpenAIProvider("https://openai.test/v1", "gpt-configured", 1000, async () => response([{ id: "gpt-remote-only" }]));
  provider.setRuntimeApiKey(key);
  assert.deepEqual(await provider.listModels(), ["gpt-remote-only"]);
});

test("Anthropic catalog contains only model IDs returned by the authenticated provider API", async () => {
  const provider = new AnthropicProvider("https://anthropic.test/v1", "claude-configured", 1000, async () => response([{ id: "claude-remote-only", lifecycle: "active", capabilities: {} }]));
  provider.setRuntimeApiKey(key);
  assert.deepEqual(await provider.listModels(), ["claude-remote-only"]);
});

test("Anthropic does not advertise static defaults when no credential is configured", async () => {
  const provider = new AnthropicProvider("https://anthropic.test/v1", "claude-configured", 1000, async () => { throw new Error("network must not be called"); });
  await assert.rejects(() => provider.listModels(), /API_KEY|configured/i);
});

test("OrcaRouter catalog does not mix configured fallback IDs with provider discovery", async () => {
  const provider = new OrcaRouterProvider("https://orca.test/v1", "orca-configured", 1000, async () => response([{ id: "orca-remote-only" }]));
  provider.setRuntimeApiKey(key);
  assert.deepEqual(await provider.listModels(), ["orca-remote-only"]);
});

test("AnyModel catalog does not mix configured fallback IDs with provider discovery", async () => {
  const provider = new AnyModelProvider("https://anymodel.test/v1", "anymodel-configured", 1000, async () => response([{ id: "anymodel-remote-only" }]));
  provider.setRuntimeApiKey(key);
  assert.deepEqual(await provider.listModels(), ["anymodel-remote-only"]);
});

test("provider catalog errors propagate instead of being converted to plausible model lists", async () => {
  const provider = new OrcaRouterProvider("https://orca.test/v1", "orca-configured", 1000, async () => new Response("{}", { status: 503 }));
  provider.setRuntimeApiKey(key);
  await assert.rejects(() => provider.listModels(), /service error|unavailable/i);
});
