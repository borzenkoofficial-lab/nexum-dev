import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getRequiredCapabilities,
  normalizeAIResponse,
  validateCanonicalRequest,
} from "./canonical.js";
import type { AIRequest } from "./types.js";

const textRequest: AIRequest = {
  version: 1,
  model: "model-a",
  messages: [{ role: "user", content: "Hello" }],
};

test("accepts a versioned canonical text request", () => {
  assert.doesNotThrow(() => validateCanonicalRequest(textRequest));
});

test("rejects a request without messages or a model", () => {
  assert.throws(() => validateCanonicalRequest({ ...textRequest, messages: [] }));
  assert.throws(() => validateCanonicalRequest({ ...textRequest, model: " " }));
});

test("rejects malformed image payloads", () => {
  const request = {
    ...textRequest,
    messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url: "javascript:alert(1)" } }] }],
  } as unknown as AIRequest;
  assert.throws(() => validateCanonicalRequest(request));
});

test("detects model capabilities required by images, tools, streaming and JSON output", () => {
  const request: AIRequest = {
    ...textRequest,
    messages: [{ role: "user", content: [{ type: "text", text: "Describe this" }, { type: "image", source: { type: "url", url: "https://example.com/image.png" } }] }],
    tools: [{ name: "lookup", description: "Lookup", inputSchema: { type: "object" } }],
    stream: true,
    responseFormat: "json",
  };
  assert.deepEqual(getRequiredCapabilities(request), {
    text: true,
    vision: true,
    toolCalling: true,
    streaming: true,
    structuredOutput: true,
  });
});

test("normalizes provider identity but does not invent missing token usage", () => {
  const normalized = normalizeAIResponse(
    { content: "answer", provider: "", model: "", usage: { inputTokens: 12 } },
    "provider-a",
    "model-a",
  );
  assert.equal(normalized.provider, "provider-a");
  assert.equal(normalized.model, "model-a");
  assert.deepEqual(normalized.usage, { inputTokens: 12 });
  assert.equal(normalized.usageSource, "provider_reported");
  assert.equal(normalized.usage?.outputTokens, undefined);
  assert.equal(normalizeAIResponse({ content: "answer", provider: "x", model: "y" }, "provider-a", "model-a").usageSource, "unavailable");
});

test("normalizes content blocks for text-only consumers", () => {
  const normalized = normalizeAIResponse(
    { content: "", contentBlocks: [{ type: "text", text: "answer" }], provider: "provider-a", model: "model-a" },
    "provider-a",
    "model-a",
  );
  assert.equal(normalized.content, "answer");
});
