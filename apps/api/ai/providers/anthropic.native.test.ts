import assert from "node:assert/strict";
import { test } from "node:test";
import type { AIRequest } from "../types.js";
import { AnthropicProvider } from "./anthropic.js";

const key = "anthropic-test-key-that-is-long-enough-123456";

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createProvider(fetchImpl: typeof fetch) {
  const provider = new AnthropicProvider("https://api.anthropic.test/v1", "claude-sonnet-5", 1000, fetchImpl);
  provider.setRuntimeApiKey(key);
  return provider;
}

test("native Messages adapter serializes system and conversation turns and normalizes response usage", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const provider = createProvider(async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return response({
      id: "msg_test_123",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5-20261120",
      content: [{ type: "text", text: "Готово" }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 20,
        output_tokens: 10,
        cache_creation_input_tokens: 3,
        cache_read_input_tokens: 5,
        output_tokens_details: { thinking_tokens: 2 },
      },
    });
  });

  const request: AIRequest = {
    version: 1,
    model: "claude-sonnet-5",
    messages: [
      { role: "system", content: "Системные правила." },
      { role: "developer", content: "Работай аккуратно." },
      { role: "user", content: "Проверь проект." },
      { role: "assistant", content: "Начинаю." },
      { role: "user", content: "Продолжай." },
    ],
    maxTokens: 512,
    temperature: 0.2,
    topP: 0.9,
    stopSequences: ["<END>"],
  };
  const result = await provider.generateRequest(request);
  const body = JSON.parse(String(capturedInit?.body));

  assert.equal(capturedUrl, "https://api.anthropic.test/v1/messages");
  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${key}`);
  assert.equal(headers["anthropic-version"], "2026-10-21");
  assert.equal(body.model, "claude-sonnet-5");
  assert.deepEqual(body.system, [
    { type: "text", text: "Системные правила." },
    { type: "text", text: "Работай аккуратно." },
  ]);
  assert.deepEqual(body.messages, [
    { role: "user", content: "Проверь проект." },
    { role: "assistant", content: "Начинаю." },
    { role: "user", content: "Продолжай." },
  ]);
  assert.equal(body.max_tokens, 512);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.top_p, 0.9);
  assert.deepEqual(body.stop_sequences, ["<END>"]);
  assert.equal(result.content, "Готово");
  assert.equal(result.provider, "anthropic");
  assert.equal(result.model, "claude-sonnet-5-20261120");
  assert.equal(result.requestId, "msg_test_123");
  assert.equal(result.finishReason, "end_turn");
  assert.deepEqual(result.usage, {
    inputTokens: 20,
    outputTokens: 10,
    totalTokens: 38,
    cachedInputTokens: 5,
    cacheCreationInputTokens: 3,
    reasoningTokens: 2,
  });
  assert.equal(result.usageSource, "provider_reported");
});

test("native Messages adapter maps base64 images, tool history and JSON Schema", async () => {
  let body: Record<string, any> | undefined;
  const provider = createProvider(async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return response({
      id: "msg_tool_1",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      content: [
        { type: "tool_use", id: "toolu_1", name: "search_docs", input: { query: "billing" } },
        { type: "text", text: "Нашёл документы." },
      ],
      stop_reason: "tool_use",
      usage: {
        input_tokens: 40,
        output_tokens: 12,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });
  });

  const request: AIRequest = {
    version: 1,
    model: "claude-sonnet-5",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Изучи изображение." },
          { type: "image", source: { type: "base64", mediaType: "image/png", data: "aGVsbG8=" } },
        ],
      },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "toolu_prev", name: "search_docs", arguments: { query: "first" } }],
      },
      { role: "tool", toolCallId: "toolu_prev", content: "Первый результат" },
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
  assert.deepEqual(body?.messages[0].content, [
    { type: "text", text: "Изучи изображение." },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } },
  ]);
  assert.deepEqual(body?.messages[1].content, [{
    type: "tool_use",
    id: "toolu_prev",
    name: "search_docs",
    input: { query: "first" },
  }]);
  assert.deepEqual(body?.messages[2].content, [{
    type: "tool_result",
    tool_use_id: "toolu_prev",
    content: "Первый результат",
  }]);
  assert.deepEqual(body?.tools, [{
    name: "search_docs",
    description: "Search the knowledge base",
    input_schema: request.tools?.[0].inputSchema,
  }]);
  assert.deepEqual(body?.tool_choice, { type: "tool", name: "search_docs" });
  assert.deepEqual(body?.output_config, {
    format: {
      type: "json_schema",
      schema: (request.responseFormat as { schema: Record<string, unknown> }).schema,
    },
  });
  assert.deepEqual(result.toolCalls, [{
    id: "toolu_1",
    name: "search_docs",
    arguments: { query: "billing" },
  }]);
  assert.equal(result.content, "Нашёл документы.");
});

test("native Messages adapter rejects URL images and JSON mode without a schema", async () => {
  let calls = 0;
  const provider = createProvider(async () => {
    calls += 1;
    return response({});
  });
  await assert.rejects(() => provider.generateRequest({
    version: 1,
    model: "claude-sonnet-5",
    messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://example.test/image.png" } }] }],
  }), /URL images are not supported/i);
  await assert.rejects(() => provider.generateRequest({
    version: 1,
    model: "claude-sonnet-5",
    messages: [{ role: "user", content: "JSON please" }],
    responseFormat: "json",
  }), /JSON Schema is required/i);
  assert.equal(calls, 0);
});

test("native Messages adapter rejects system messages after conversation has started", async () => {
  const provider = createProvider(async () => response({}));
  await assert.rejects(() => provider.generateRequest({
    version: 1,
    model: "claude-sonnet-5",
    messages: [
      { role: "user", content: "Hello" },
      { role: "system", content: "Late system instruction" },
    ],
  }), /system and developer messages must precede conversation messages/i);
});

test("model discovery and provider status verify the selected Claude model", async () => {
  const provider = createProvider(async (input) => {
    if (String(input).includes("/models?limit=1000")) {
      return response({ data: [{ id: "claude-sonnet-5" }, { id: "claude-opus-5" }] });
    }
    return response({});
  });
  assert.deepEqual(await provider.listModels(), ["claude-sonnet-5", "claude-opus-5"]);
  assert.equal(provider.getCapabilities("claude-sonnet-5").text, true);
  assert.equal(provider.getCapabilities("claude-sonnet-5").vision, "unknown");
  assert.equal((await provider.getStatus("claude-sonnet-5")).available, true);
  assert.equal((await provider.getStatus("claude-haiku-5")).available, false);
});

test("partial Anthropic usage is not marked authoritative for billing", async () => {
  const provider = createProvider(async () => response({
    id: "msg_partial",
    type: "message",
    model: "claude-sonnet-5",
    content: [{ type: "text", text: "partial" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 5 },
  }));
  const result = await provider.generateRequest({
    version: 1,
    model: "claude-sonnet-5",
    messages: [{ role: "user", content: "Hello" }],
  });
  assert.equal(result.usageSource, "unavailable");
});

test("native Messages adapter propagates caller cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  const provider = createProvider(async () => {
    throw new Error("must not be called");
  });
  await assert.rejects(() => provider.generateRequest({
    version: 1,
    model: "claude-sonnet-5",
    messages: [{ role: "user", content: "Hello" }],
    signal: controller.signal,
  }));
});
