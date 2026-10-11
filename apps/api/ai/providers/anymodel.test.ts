import test from "node:test";
import assert from "node:assert/strict";
import { AnyModelProvider } from "./anymodel.js";

test("AnyModel sends an OpenAI-compatible chat completion request", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = new AnyModelProvider(
    "https://anymodel.test/v1",
    "gpt-6-astra",
    5_000,
    async (url, init) => {
      calls.push({ url: typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url, init: init ?? {} });
      return new Response(JSON.stringify({
        choices: [{ message: { content: "ok" } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  );
  provider.setRuntimeApiKey("anymodel-test-key");
  const result = await provider.generate("Build a page", "gpt-6-astra", { maxTokens: 123 });

  assert.equal(result, "ok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://anymodel.test/v1/chat/completions");
  assert.equal(calls[0]?.init.headers && (calls[0].init.headers as Record<string, string>).Authorization, "Bearer anymodel-test-key");
  const body = JSON.parse(String(calls[0]?.init.body));
  assert.equal(body.model, "gpt-6-astra");
  assert.equal(body.max_tokens, 123);
});

test("AnyModel status is unavailable without a key", async () => {
  const provider = new AnyModelProvider("https://anymodel.test/v1", "gpt-6-astra", 5_000, async () => {
    throw new Error("should not call network");
  });
  const status = await provider.getStatus();
  assert.equal(status.available, false);
  assert.match(status.error ?? "", /ANYMODEL_API_KEY/);
});
