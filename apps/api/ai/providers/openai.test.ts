import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIProvider } from "./openai.js";

test("exposes GPT defaults and runtime key support", () => {
  const provider = new OpenAIProvider(
    "https://example.test/v1",
    "gpt-5",
    1000,
    async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
  );
  assert.equal(provider.id, "openai");
  assert.equal(provider.model, "gpt-5");
  assert.equal(provider.hasApiKey(), false);
  provider.setRuntimeApiKey("runtime-test-value-that-is-long-enough-1234567890");
  assert.equal(provider.hasApiKey(), true);
});

test("rejects invalid model identifiers", () => {
  assert.throws(() => new OpenAIProvider("https://example.test/v1", "gpt/invalid"));
});
