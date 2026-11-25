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


test("AnyModel supports catalog-gated canonical SSE streaming", async () => {
  const calls: string[] = [];
  const streamBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode([
        ': provider keep-alive',
        '',
        'data: {"id":"gen-stream","model":"gpt-test","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
        '',
        'data: {"id":"gen-stream","model":"gpt-test","choices":[{"index":0,"delta":{"content":"streamed"},"finish_reason":null}]}',
        '',
        'data: {"id":"gen-stream","model":"gpt-test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
        '',
        'data: {"id":"gen-stream","model":"gpt-test","choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}',
        '',
        'data: [DONE]',
        '',
        '',
      ].join("\n")));
      controller.close();
    },
  });
  const provider = new AnyModelProvider("https://anymodel.test/v1", "gpt-test", 1000, async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [{
      id: "gpt-test",
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      supported_parameters: ["tools", "tool_choice"],
    }] }), { status: 200, headers: { "content-type": "application/json" } });
    assert.equal(JSON.parse(String(init?.body)).stream, true);
    assert.deepEqual(JSON.parse(String(init?.body)).stream_options, { include_usage: true });
    return new Response(streamBody, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
  provider.setRuntimeApiKey("anymodel-test-key-123456");
  assert.equal(provider.getCapabilities("gpt-test").streaming, false);
  await provider.listModels();
  assert.equal(provider.getCapabilities("gpt-test").streaming, true);
  const events = [];
  for await (const event of provider.streamRequest({
    version: 1, model: "gpt-test", stream: true,
    messages: [{ role: "user", content: "Hello" }],
  })) events.push(event);
  assert.deepEqual(calls, ["https://anymodel.test/v1/models", "https://anymodel.test/v1/chat/completions"]);
  assert.deepEqual(events, [
    { type: "message_start", provider: "anymodel", model: "gpt-test", requestId: "gen-stream" },
    { type: "text_delta", text: "streamed" },
    { type: "usage", usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 }, source: "provider_reported" },
    { type: "message_end", finishReason: "stop" },
  ]);
});
