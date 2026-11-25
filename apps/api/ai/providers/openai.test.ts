import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIProvider } from "./openai.js";

test("exposes OpenAI defaults and runtime key support", () => {
  const provider = new OpenAIProvider(
    "https://example.test/v1",
    "gpt-5",
    1000,
    async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
  );
  assert.equal(provider.id, "openai");
  assert.equal(provider.model, "gpt-5");
  assert.equal(provider.protocol, "openai-responses");
  assert.equal(provider.legacyProtocol, "openai-chat-completions");
  assert.equal(provider.hasApiKey(), false);
  provider.setRuntimeApiKey("runtime-test-value-that-is-long-enough-1234567890");
  assert.equal(provider.hasApiKey(), true);
});

test("rejects invalid model identifiers", () => {
  assert.throws(() => new OpenAIProvider("https://example.test/v1", "gpt/invalid"));
});

test("legacy string facade remains on Chat Completions for existing callers", async () => {
  let capturedUrl = "";
  let body: Record<string, unknown> | undefined;
  const provider = new OpenAIProvider("https://openai.test/v1", "gpt-test", 1000, async (input, init) => {
    capturedUrl = String(input);
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      choices: [{ message: { content: "legacy answer" } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  provider.setRuntimeApiKey("test-openai-canonical-key-1234567890");
  const result = await provider.generate("Hello", "gpt-test", { maxTokens: 321, temperature: 0.2 });
  assert.equal(capturedUrl, "https://openai.test/v1/chat/completions");
  assert.deepEqual(body?.messages, [{ role: "user", content: "Hello" }]);
  assert.equal(body?.max_tokens, 321);
  assert.equal(body?.temperature, 0.2);
  assert.equal(result, "legacy answer");
});


test("OpenAI Responses adapter preserves canonical roles and provider usage metadata", async () => {
  let requestUrl = "";
  let requestBody: Record<string, unknown> | undefined;
  const provider = new OpenAIProvider("https://openai.test/v1", "gpt-test", 1000, async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      id: "resp-test-123", status: "completed", model: "gpt-test-served",
      output: [{ type: "message", content: [{ type: "output_text", text: "canonical answer" }] }],
      usage: { input_tokens: 17, output_tokens: 9, total_tokens: 26, input_tokens_details: { cached_tokens: 3 }, output_tokens_details: { reasoning_tokens: 2 } },
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
    maxTokens: 321, temperature: 0.2,
  });
  assert.equal(requestUrl, "https://openai.test/v1/responses");
  assert.deepEqual(requestBody?.input, [
    { role: "developer", content: "Follow these rules." },
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Previous answer" },
  ]);
  assert.equal(requestBody?.max_output_tokens, 321);
  assert.equal(requestBody?.temperature, 0.2);
  assert.equal(response.content, "canonical answer");
  assert.equal(response.provider, "openai");
  assert.equal(response.model, "gpt-test-served");
  assert.equal(response.requestId, "resp-test-123");
  assert.equal(response.finishReason, "completed");
  assert.deepEqual(response.usage, { inputTokens: 17, outputTokens: 9, totalTokens: 26, cachedInputTokens: 3, reasoningTokens: 2 });
  assert.equal(response.usageSource, "provider_reported");
});

test("OpenAI Responses adapter maps image content without flattening it into text", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const provider = new OpenAIProvider("https://openai.test/v1", "gpt-test", 1000, async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      id: "resp-image-123", status: "completed", model: "gpt-test",
      output: [{ type: "message", content: [{ type: "output_text", text: "image described" }] }],
      usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  provider.setRuntimeApiKey("test-openai-canonical-key-1234567890");
  await provider.generateRequest({
    version: 1, model: "gpt-test",
    messages: [{ role: "user", content: [
      { type: "text", text: "Describe this" },
      { type: "image", source: { type: "url", url: "https://example.test/image.png" } },
    ] }],
  });
  const input = requestBody?.input as Array<{ content: Array<Record<string, unknown>> }>;
  assert.deepEqual(input[0]?.content, [
    { type: "input_text", text: "Describe this" },
    { type: "input_image", image_url: "https://example.test/image.png" },
  ]);
});
