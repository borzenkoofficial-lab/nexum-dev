import assert from "node:assert/strict";
import test from "node:test";
import { OrcaRouterProvider } from "./orcarouter.js";

test("exposes OrcaRouter free DeepSeek model", () => {
  const provider = new OrcaRouterProvider();
  assert.equal(provider.id, "orcarouter");
  assert.equal(provider.model, "deepseek/deepseek-v4-flash-free");
  assert.equal(provider.hasApiKey(), Boolean(process.env.ORCAROUTER_API_KEY?.trim()));
});

test("accepts a runtime OrcaRouter key", () => {
  const provider = new OrcaRouterProvider();
  provider.setRuntimeApiKey("sk-orca-test-key-1234567890");
  assert.equal(provider.hasApiKey(), true);
});


test("forwards model and generation limits to OrcaRouter", async () => {
  let body = "";
  const provider = new OrcaRouterProvider("https://orcarouter.test/v1", "deepseek/test-free", 1000, async (_input, init) => {
    body = String(init?.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  });
  provider.setRuntimeApiKey("test-only-key-1234567890");
  assert.equal(await provider.generate("Привет", undefined, { maxTokens: 321, temperature: 0.2 }), "ok");
  assert.match(body, /"model":"deepseek\/test-free"/);
  assert.match(body, /"max_tokens":321/);
  assert.match(body, /"temperature":0.2/);
});

test("maps OrcaRouter rate-limit and auth errors distinctly", async () => {
  for (const [status, expected] of [
    [401, "OrcaRouter authentication failed (401)"],
    [403, "OrcaRouter access forbidden (403)"],
    [429, "OrcaRouter rate limit exceeded (429)"],
    [503, "OrcaRouter service error (503)"],
  ] as const) {
    const provider = new OrcaRouterProvider("https://orcarouter.test/v1", "deepseek/test-free", 1000, async () =>
      new Response(JSON.stringify({}), { status }),
    );
    provider.setRuntimeApiKey("test-only-key-1234567890");
    await assert.rejects(() => provider.generate("test"), new RegExp(expected.replace(/[()]/g, "\\$&")));
  }
});

test("reports provider outage as unavailable instead of falling back to local defaults", async () => {
  const provider = new OrcaRouterProvider("https://orcarouter.test/v1", "deepseek/test-free", 1000, async () =>
    new Response(JSON.stringify({ error: "down" }), { status: 503 }),
  );
  provider.setRuntimeApiKey("test-only-key-1234567890");
  const status = await provider.getStatus();
  assert.equal(status.available, false);
  assert.match(status.error ?? "", /service error|unavailable/i);
});


test("OrcaRouter supports catalog-gated canonical SSE streaming", async () => {
  const calls: string[] = [];
  const streamBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode([
        ': provider keep-alive',
        '',
        'data: {"id":"gen-stream","model":"deepseek/test-free","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
        '',
        'data: {"id":"gen-stream","model":"deepseek/test-free","choices":[{"index":0,"delta":{"content":"streamed"},"finish_reason":null}]}',
        '',
        'data: {"id":"gen-stream","model":"deepseek/test-free","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
        '',
        'data: {"id":"gen-stream","model":"deepseek/test-free","choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}',
        '',
        'data: [DONE]',
        '',
        '',
      ].join("\n")));
      controller.close();
    },
  });
  const provider = new OrcaRouterProvider("https://orcarouter.test/v1", "deepseek/test-free", 1000, async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [{
      id: "deepseek/test-free",
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      supported_parameters: ["tools", "tool_choice"],
    }] }), { status: 200, headers: { "content-type": "application/json" } });
    assert.equal(JSON.parse(String(init?.body)).stream, true);
    assert.deepEqual(JSON.parse(String(init?.body)).stream_options, { include_usage: true });
    return new Response(streamBody, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
  provider.setRuntimeApiKey("test-only-orcarouter-key-123456");
  assert.equal(provider.getCapabilities("deepseek/test-free").streaming, false);
  await provider.listModels();
  assert.equal(provider.getCapabilities("deepseek/test-free").streaming, true);
  const events = [];
  for await (const event of provider.streamRequest({
    version: 1, model: "deepseek/test-free", stream: true,
    messages: [{ role: "user", content: "Hello" }],
  })) events.push(event);
  assert.deepEqual(calls, ["https://orcarouter.test/v1/models", "https://orcarouter.test/v1/chat/completions"]);
  assert.deepEqual(events, [
    { type: "message_start", provider: "orcarouter", model: "deepseek/test-free", requestId: "gen-stream" },
    { type: "text_delta", text: "streamed" },
    { type: "usage", usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 }, source: "provider_reported" },
    { type: "message_end", finishReason: "stop" },
  ]);
});
