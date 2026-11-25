import assert from "node:assert/strict";
import { test } from "node:test";
import type { AIRequest } from "../types.js";
import { OpenAIProvider } from "./openai.js";

const key = "runtime-test-value-that-is-long-enough-1234567890";

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createProvider(fetchImpl: typeof fetch) {
  const provider = new OpenAIProvider("https://api.openai.test/v1", "gpt-6.2-sol", 1000, fetchImpl);
  provider.setRuntimeApiKey(key);
  return provider;
}

test("native Responses adapter serializes canonical messages and normalizes actual model and usage", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const provider = createProvider(async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return response({
      id: "resp_test_123",
      status: "completed",
      model: "gpt-6.2-sol-2026-11-20",
      output: [{
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Готово" }],
      }],
      usage: {
        input_tokens: 120,
        output_tokens: 30,
        total_tokens: 150,
        input_tokens_details: { cached_tokens: 12 },
        output_tokens_details: { reasoning_tokens: 5 },
      },
    });
  });

  const request: AIRequest = {
    version: 1,
    model: "gpt-6.2-sol",
    messages: [
      { role: "system", content: "Ты помощник КВАРД." },
      { role: "user", content: "Проверь проект." },
    ],
    maxTokens: 512,
    temperature: 0.2,
    topP: 0.9,
    metadata: { idempotencyKey: "request-unique-123" },
  };
  const result = await provider.generateRequest(request);
  const body = JSON.parse(String(capturedInit?.body));

  assert.equal(capturedUrl, "https://api.openai.test/v1/responses");
  assert.equal((capturedInit?.headers as Record<string, string>).Authorization, `Bearer ${key}`);
  assert.equal((capturedInit?.headers as Record<string, string>)["Idempotency-Key"], "request-unique-123");
  assert.equal(body.model, "gpt-6.2-sol");
  assert.deepEqual(body.input, [
    { role: "system", content: "Ты помощник КВАРД." },
    { role: "user", content: "Проверь проект." },
  ]);
  assert.equal(body.max_output_tokens, 512);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.top_p, 0.9);
  assert.equal(result.content, "Готово");
  assert.equal(result.provider, "openai");
  assert.equal(result.model, "gpt-6.2-sol-2026-11-20");
  assert.equal(result.requestId, "resp_test_123");
  assert.deepEqual(result.usage, {
    inputTokens: 120,
    outputTokens: 30,
    totalTokens: 150,
    cachedInputTokens: 12,
    reasoningTokens: 5,
  });
  assert.equal(result.usageSource, "provider_reported");
  assert.equal(typeof result.latencyMs, "number");
});

test("native Responses adapter maps images, tool history, function definitions and JSON schema", async () => {
  let capturedBody: Record<string, any> | undefined;
  const provider = createProvider(async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return response({
      id: "resp_tool_1",
      status: "completed",
      model: "gpt-6.2-sol",
      output: [
        {
          type: "function_call",
          call_id: "call_1",
          name: "search_docs",
          arguments: "{\"query\":\"billing\"}",
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Нашёл документы." }],
        },
      ],
      usage: { input_tokens: 50, output_tokens: 12, total_tokens: 62 },
    });
  });

  const request: AIRequest = {
    version: 1,
    model: "gpt-6.2-sol",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Изучи изображения." },
          { type: "image", source: { type: "url", url: "https://example.test/photo.png" } },
          { type: "image", source: { type: "base64", mediaType: "image/png", data: "aGVsbG8=" } },
        ],
      },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_prev", name: "search_docs", arguments: { query: "first" } }],
      },
      { role: "tool", toolCallId: "call_prev", content: "Первый результат" },
    ],
    tools: [{
      name: "search_docs",
      description: "Search the knowledge base",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    }],
    toolChoice: { name: "search_docs" },
    responseFormat: {
      type: "json_schema",
      name: "search_result",
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      strict: true,
    },
  };

  const result = await provider.generateRequest(request);
  assert.deepEqual(capturedBody?.input[0].content, [
    { type: "input_text", text: "Изучи изображения." },
    { type: "input_image", image_url: "https://example.test/photo.png" },
    { type: "input_image", image_url: "data:image/png;base64,aGVsbG8=" },
  ]);
  assert.deepEqual(capturedBody?.input[1], {
    type: "function_call",
    call_id: "call_prev",
    name: "search_docs",
    arguments: "{\"query\":\"first\"}",
  });
  assert.deepEqual(capturedBody?.input[2], {
    type: "function_call_output",
    call_id: "call_prev",
    output: "Первый результат",
  });
  assert.deepEqual(capturedBody?.tools, [{
    type: "function",
    name: "search_docs",
    description: "Search the knowledge base",
    parameters: request.tools?.[0].inputSchema,
  }]);
  assert.deepEqual(capturedBody?.tool_choice, { type: "function", name: "search_docs" });
  assert.deepEqual(capturedBody?.text, {
    format: {
      type: "json_schema",
      name: "search_result",
      schema: (request.responseFormat as { schema: Record<string, unknown> }).schema,
      strict: true,
    },
  });
  assert.deepEqual(result.toolCalls, [{
    id: "call_1",
    name: "search_docs",
    arguments: { query: "billing" },
  }]);
  assert.equal(result.content, "Нашёл документы.");
});

test("native Responses adapter rejects unsupported stop sequences before network calls", async () => {
  let calls = 0;
  const provider = createProvider(async () => {
    calls += 1;
    return response({});
  });
  await assert.rejects(
    () => provider.generateRequest({
      version: 1,
      model: "gpt-6.2-sol",
      messages: [{ role: "user", content: "test" }],
      stopSequences: ["STOP"],
    }),
    /stop sequences are not supported/i,
  );
  assert.equal(calls, 0);
});

test("model discovery returns only provider-reported model IDs and unknown models stay unverified", async () => {
  const provider = createProvider(async () => response({
    data: [
      { id: "gpt-6.2-sol" },
      { id: "o3" },
      { id: "text-embedding-3-small" },
      { id: "gpt-image-2" },
    ],
  }));
  assert.deepEqual(await provider.listModels(), [
    "gpt-6.2-sol",
    "o3",
    "text-embedding-3-small",
    "gpt-image-2",
  ]);
  assert.equal(provider.getCapabilities("gpt-6.2-sol").text, true);
  assert.equal(provider.getCapabilities("text-embedding-3-small").text, "unknown");
  assert.equal(provider.getCapabilities("gpt-image-2").text, "unknown");
  assert.equal(provider.getCapabilities("gpt-6.2-sol").vision, "unknown");
});

test("native Responses adapter rejects malformed provider response and propagates caller cancellation", async () => {
  const malformed = createProvider(async () => response({
    id: "resp_bad",
    status: "completed",
    model: "gpt-6.2-sol",
    output: [{ type: "function_call", call_id: "call_1", name: "bad", arguments: "not-json" }],
  }));
  await assert.rejects(() => malformed.generateRequest({
    version: 1,
    model: "gpt-6.2-sol",
    messages: [{ role: "user", content: "test" }],
  }), /invalid function arguments/i);

  const controller = new AbortController();
  controller.abort();
  const cancelled = createProvider(async () => {
    throw new Error("must not be called");
  });
  await assert.rejects(() => cancelled.generateRequest({
    version: 1,
    model: "gpt-6.2-sol",
    messages: [{ role: "user", content: "test" }],
    signal: controller.signal,
  }));
});


test("provider status verifies the selected model, not merely a reachable models endpoint", async () => {
  const provider = createProvider(async () => response({
    data: [
      { id: "gpt-6.2-sol" },
      { id: "text-embedding-3-small" },
    ],
  }));
  const supported = await provider.getStatus("gpt-6.2-sol");
  const unsupported = await provider.getStatus("text-embedding-3-small");
  assert.equal(supported.available, true);
  assert.equal(unsupported.available, false);
  assert.match(unsupported.error ?? "", /not a verified text generation model/i);
});


test("native Responses adapter rejects non-terminal and failed response states", async () => {
  for (const payload of [
    { id: "resp_pending", status: "in_progress", model: "gpt-6.2-sol", output: [] },
    { id: "resp_failed", status: "failed", model: "gpt-6.2-sol", output: [], error: { message: "provider detail" } },
  ]) {
    const provider = createProvider(async () => response(payload));
    await assert.rejects(() => provider.generateRequest({
      version: 1,
      model: "gpt-6.2-sol",
      messages: [{ role: "user", content: "test" }],
    }), /unsuccessful response/i);
  }
});
