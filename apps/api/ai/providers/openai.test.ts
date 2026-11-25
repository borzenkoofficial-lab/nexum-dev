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


test("OpenAI canonical adapter preserves text roles and normalizes provider usage metadata", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const provider = new OpenAIProvider("https://openai.test/v1", "gpt-test", 1000, async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      id: "chatcmpl-test-123",
      model: "gpt-test-served",
      choices: [{ message: { role: "assistant", content: "canonical answer" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 17, completion_tokens: 9, total_tokens: 26, prompt_tokens_details: { cached_tokens: 3 }, completion_tokens_details: { reasoning_tokens: 2 } },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  provider.setRuntimeApiKey("test-openai-canonical-key-1234567890");
  const response = await provider.generateRequest({
    version: 1, model: "gpt-test",
    messages: [
      { role: "developer", content: "Follow these rules." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Previous answer" },
    ],
    maxTokens: 321, temperature: 0.2, stopSequences: ["END"],
  });
  assert.deepEqual(requestBody?.messages, [
    { role: "developer", content: "Follow these rules." },
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Previous answer" },
  ]);
  assert.equal(requestBody?.max_completion_tokens, 321);
  assert.equal(requestBody?.temperature, 0.2);
  assert.deepEqual(requestBody?.stop, ["END"]);
  assert.equal(response.content, "canonical answer");
  assert.equal(response.provider, "openai");
  assert.equal(response.model, "gpt-test-served");
  assert.equal(response.requestId, "chatcmpl-test-123");
  assert.equal(response.finishReason, "stop");
  assert.deepEqual(response.usage, { inputTokens: 17, outputTokens: 9, totalTokens: 26, cachedInputTokens: 3, reasoningTokens: 2 });
  assert.equal(response.usageSource, "provider_reported");
});

test("OpenAI canonical adapter rejects non-text content instead of silently flattening it", async () => {
  const provider = new OpenAIProvider("https://openai.test/v1", "gpt-test", 1000, async () => { throw new Error("network must not be called"); });
  provider.setRuntimeApiKey("test-openai-canonical-key-1234567890");
  await assert.rejects(() => provider.generateRequest({
    version: 1, model: "gpt-test",
    messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://example.test/image.png" } }] }],
  }), /text-only|unsupported content/i);
});
