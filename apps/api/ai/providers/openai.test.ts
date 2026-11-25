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
