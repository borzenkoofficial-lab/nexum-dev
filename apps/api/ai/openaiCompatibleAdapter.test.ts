import assert from "node:assert/strict";
import { test } from "node:test";
import type { AIRequest } from "./types.js";
import {
  normalizeOpenAICompatibleResponse,
  serializeOpenAICompatibleRequest,
} from "./openaiCompatibleAdapter.js";

test("serializes canonical messages, images, tool history and structured output to Chat Completions", () => {
  const request: AIRequest = {
    version: 1,
    model: "provider/model",
    messages: [
      { role: "system", content: "system" },
      { role: "developer", content: "developer" },
      {
        role: "user",
        content: [
          { type: "text", text: "Look at this" },
          { type: "image", source: { type: "base64", mediaType: "image/png", data: "aGVsbG8=" } },
        ],
      },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_1", name: "search", arguments: { query: "x" } }],
      },
      { role: "tool", toolCallId: "call_1", content: "result" },
    ],
    maxTokens: 400,
    temperature: 0.2,
    topP: 0.8,
    stopSequences: ["STOP"],
    tools: [{
      name: "search",
      description: "Search",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
    }],
    toolChoice: { name: "search" },
    responseFormat: {
      type: "json_schema",
      name: "result",
      schema: { type: "object", properties: { ok: { type: "boolean" } } },
      strict: true,
    },
  };
  const body = serializeOpenAICompatibleRequest(request);
  assert.deepEqual(body.messages, [
    { role: "system", content: "system" },
    { role: "developer", content: "developer" },
    {
      role: "user",
      content: [
        { type: "text", text: "Look at this" },
        { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
      ],
    },
    {
      role: "assistant",
      content: "",
      tool_calls: [{
        id: "call_1",
        type: "function",
        function: { name: "search", arguments: "{\"query\":\"x\"}" },
      }],
    },
    { role: "tool", tool_call_id: "call_1", content: "result" },
  ]);
  assert.equal(body.max_tokens, 400);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.top_p, 0.8);
  assert.deepEqual(body.stop, ["STOP"]);
  assert.deepEqual(body.tool_choice, { type: "function", function: { name: "search" } });
  assert.deepEqual(body.response_format, {
    type: "json_schema",
    json_schema: {
      name: "result",
      schema: (request.responseFormat as { schema: Record<string, unknown> }).schema,
      strict: true,
    },
  });
});

test("normalizes OpenAI-compatible text, image, tools, actual model and provider-reported usage", () => {
  const result = normalizeOpenAICompatibleResponse({
    id: "chatcmpl_1",
    model: "provider/model-revision",
    choices: [{
      finish_reason: "tool_calls",
      message: {
        content: [{ type: "text", text: "hello" }],
        images: [{ type: "image_url", image_url: { url: "https://images.test/result.png" } }],
        tool_calls: [{
          id: "call_2",
          type: "function",
          function: { name: "search", arguments: "{\"query\":\"billing\"}" },
        }],
      },
    }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      prompt_tokens_details: { cached_tokens: 10 },
      completion_tokens_details: { reasoning_tokens: 5 },
    },
  }, "openrouter", "provider/model", 25);
  assert.equal(result.content, "hello");
  assert.equal(result.provider, "openrouter");
  assert.equal(result.model, "provider/model-revision");
  assert.equal(result.requestId, "chatcmpl_1");
  assert.equal(result.finishReason, "tool_calls");
  assert.deepEqual(result.toolCalls, [{
    id: "call_2",
    name: "search",
    arguments: { query: "billing" },
  }]);
  assert.equal(result.contentBlocks?.length, 2);
  assert.deepEqual(result.usage, {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    cachedInputTokens: 10,
    reasoningTokens: 5,
  });
  assert.equal(result.usageSource, "provider_reported");
});

test("does not mark incomplete usage as authoritative and rejects malformed tool arguments", () => {
  const partial = normalizeOpenAICompatibleResponse({
    choices: [{ message: { content: "partial" } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }, "openrouter", "model", 1);
  assert.equal(partial.usageSource, "unavailable");

  assert.throws(() => normalizeOpenAICompatibleResponse({
    choices: [{
      message: {
        content: "",
        tool_calls: [{ id: "call", function: { name: "tool", arguments: "not-json" } }],
      },
    }],
  }, "openrouter", "model", 1), /invalid function arguments/i);
});

test("rejects streaming and image tool outputs before a provider request", () => {
  assert.throws(() => serializeOpenAICompatibleRequest({
    version: 1,
    model: "model",
    messages: [{ role: "user", content: "test" }],
    stream: true,
  }), /does not support streaming/i);
  assert.throws(() => serializeOpenAICompatibleRequest({
    version: 1,
    model: "model",
    messages: [{
      role: "tool",
      toolCallId: "call",
      content: [{ type: "image", source: { type: "url", url: "https://example.test/image.png" } }],
    }],
  }), /tool output cannot contain images/i);
});
