import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenRouterProvider } from "./openrouter.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("requires OPENROUTER_API_KEY without exposing it", async () => {
  const provider = new OpenRouterProvider("https://openrouter.test");
  const result = await provider.getStatus();

  assert.equal(result.available, false);
  assert.equal(result.error, "OPENROUTER_API_KEY is not configured. Add an API key in NEXUM Settings.");
  assert.equal(JSON.stringify(result).includes("sk-"), false);
});

test("generates with the configured OpenRouter model", async () => {
  let requestedUrl = "";
  let requestedBody = "";
  const provider = new OpenRouterProvider("https://openrouter.test", "openrouter/free", 1000, async (input, init) => {
    requestedUrl = String(input);
    requestedBody = String(init?.body);
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-only-key");
    return jsonResponse(200, { choices: [{ message: { content: "Hello from OpenRouter" } }] });
  });
  provider.setRuntimeApiKey("test-only-key");
  const result = await provider.generate("Привет", "openrouter/free");

  assert.equal(result, "Hello from OpenRouter");
  assert.equal(requestedUrl, "https://openrouter.test/chat/completions");
  assert.match(requestedBody, /"model":"openrouter\/free"/);
});

test("maps OpenRouter HTTP errors without returning the key", async () => {
  for (const [status, expected] of [
    [401, "OpenRouter authentication failed (401)"],
    [403, "OpenRouter access forbidden (403)"],
    [429, "OpenRouter rate limit exceeded (429)"],
    [503, "OpenRouter service error (503)"],
  ] as const) {
    const provider = new OpenRouterProvider("https://openrouter.test", "openrouter/free", 1000, async () => jsonResponse(status, {}));
    provider.setRuntimeApiKey("test-only-key");
    const result = await provider.getStatus();
    assert.equal(result.available, false);
    assert.equal(result.error, expected);
    assert.equal(JSON.stringify(result).includes("test-only-key"), false);
  }
});

test("maps OpenRouter timeout without the key", async () => {
  const provider = new OpenRouterProvider("https://openrouter.test", "openrouter/free", 5, async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
  provider.setRuntimeApiKey("test-only-key");
  const result = await provider.getStatus();

  assert.equal(result.available, false);
  assert.equal(result.error, "OpenRouter request timed out");
});


test("does not apply hidden keyword routing or hardcoded model lists", async () => {
  const requestedModels: string[] = [];
  const provider = new OpenRouterProvider("https://openrouter.test", "openrouter/free", 1000, async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { model?: string };
    requestedModels.push(body.model ?? "");
    return jsonResponse(200, { choices: [{ message: { content: body.model ?? "" } }] });
  });
  provider.setRuntimeApiKey("test-only-key");
  await provider.generate("fix this TypeScript React build error");
  await provider.generate("plan the architecture for a multi-step autonomous agent");
  assert.deepEqual(requestedModels, ["openrouter/free", "openrouter/free"]);
});


test("does not silently switch an explicitly selected model", async () => {
  let requestedModels: string[] = [];
  const provider = new OpenRouterProvider("https://openrouter.test", "openrouter/free", 1000, async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { model?: string };
    requestedModels.push(body.model ?? "");
    return jsonResponse(200, { choices: [{ message: { content: body.model ?? "" } }] });
  });
  provider.setRuntimeApiKey("test-only-key");

  const result = await provider.generate("write code", "qwen/example-explicit-model");

  assert.equal(result, "qwen/example-explicit-model");
  assert.deepEqual(requestedModels, ["qwen/example-explicit-model"]);
});


test("OpenRouter streams canonical text, tool calls and final usage from SSE", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const frames = [
    ': OPENROUTER PROCESSING\n\n',
    'data: {"id":"gen-1","model":"openai/gpt-test","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
    'data: {"id":"gen-1","model":"openai/gpt-test","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
    'data: {"id":"gen-1","model":"openai/gpt-test","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"lookup","arguments":"{\\"q\\":\\"x\\"}"}}]},"finish_reason":null}]}\n\n',
    'data: {"id":"gen-1","model":"openai/gpt-test","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
    'data: {"id":"gen-1","model":"openai/gpt-test","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":5,"total_tokens":17,"prompt_tokens_details":{"cached_tokens":2},"completion_tokens_details":{"reasoning_tokens":1}}}\n\n',
    'data: [DONE]\n\n',
  ];
  const bytes = new TextEncoder().encode(frames.join(""));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 29));
      controller.enqueue(bytes.slice(29, 143));
      controller.enqueue(bytes.slice(143, 301));
      controller.enqueue(bytes.slice(301));
      controller.close();
    },
  });
  const provider = new OpenRouterProvider("https://openrouter.test/api/v1", "openai/gpt-test", 1000, async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/models?")) {
      return jsonResponse(200, { data: [{
        id: "openai/gpt-test",
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        supported_parameters: ["tools", "tool_choice"],
        context_length: 128000,
      }] });
    }
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", "X-Generation-Id": "generation-header-id" } });
  });
  provider.setRuntimeApiKey("test-only-key");
  await provider.listModels();
  assert.equal(provider.getCapabilities("openai/gpt-test").streaming, true);
  const events = [];
  for await (const event of provider.streamRequest({
    version: 1,
    model: "openai/gpt-test",
    stream: true,
    messages: [{ role: "user", content: "Hello" }],
    tools: [{ name: "lookup", inputSchema: { type: "object" } }],
  })) events.push(event);

  const streamCall = calls.find((call) => call.url.endsWith("/chat/completions"));
  assert.ok(streamCall);
  assert.equal((JSON.parse(String(streamCall.init?.body)) as Record<string, unknown>).stream, true);
  assert.equal((streamCall.init?.headers as Record<string, string>).Accept, "text/event-stream");
  assert.deepEqual(events, [
    { type: "message_start", provider: "openrouter", model: "openai/gpt-test", requestId: "gen-1" },
    { type: "text_delta", text: "Hello" },
    { type: "tool_call_start", index: 0, id: "call-1", name: "lookup" },
    { type: "tool_call_delta", index: 0, argumentsDelta: '{"q":"x"}' },
    { type: "usage", usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17, cachedInputTokens: 2, reasoningTokens: 1 }, source: "provider_reported" },
    { type: "message_end", finishReason: "tool_calls" },
  ]);
});

test("OpenRouter streaming requires catalog-verified model and rejects missing DONE sentinel", async () => {
  let streamCalls = 0;
  const truncated = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"id":"gen-2","model":"openai/gpt-test","choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":"stop"}]}\n\n'));
      controller.close();
    },
  });
  const provider = new OpenRouterProvider("https://openrouter.test/api/v1", "openrouter/free", 1000, async (input) => {
    if (String(input).includes("/models?")) return jsonResponse(200, { data: [{ id: "openai/gpt-test", architecture: { input_modalities: ["text"], output_modalities: ["text"] } }] });
    streamCalls += 1;
    return new Response(truncated, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
  provider.setRuntimeApiKey("test-only-key");
  await assert.rejects(async () => {
    for await (const _event of provider.streamRequest({ version: 1, model: "openai/gpt-test", stream: true, messages: [{ role: "user", content: "Hello" }] })) { /* consume */ }
  }, /catalog/);
  assert.equal(streamCalls, 0);
  await provider.listModels();
  await assert.rejects(async () => {
    for await (const _event of provider.streamRequest({ version: 1, model: "openai/gpt-test", stream: true, messages: [{ role: "user", content: "Hello" }] })) { /* consume */ }
  }, /\[DONE\]/);
  assert.equal(streamCalls, 1);
});
