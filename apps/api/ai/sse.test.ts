import assert from "node:assert/strict";
import test from "node:test";
import { encodeAIStreamEvent } from "./sse.js";

test("encodes canonical text deltas as named SSE frames", () => {
  assert.equal(
    encodeAIStreamEvent({ type: "text_delta", text: "Hello\n\nevent: forged" }),
    'event: text_delta\ndata: {"type":"text_delta","text":"Hello\\n\\nevent: forged"}\n\n',
  );
});

test("encodes tool-call and usage events without changing their payload", () => {
  const tool = { type: "tool_call_delta" as const, index: 2, argumentsDelta: '{"path":"src/App.tsx"}' };
  const usage = { type: "usage" as const, usage: { inputTokens: 12, outputTokens: 4 }, source: "provider_reported" as const };
  assert.equal(encodeAIStreamEvent(tool), `event: tool_call_delta\ndata: ${JSON.stringify(tool)}\n\n`);
  assert.equal(encodeAIStreamEvent(usage), `event: usage\ndata: ${JSON.stringify(usage)}\n\n`);
});

test("encodes terminal and provider error events", () => {
  const end = { type: "message_end" as const, finishReason: "stop" };
  const error = { type: "error" as const, code: "NETWORK_ERROR", message: "Provider unavailable" };
  assert.equal(encodeAIStreamEvent(end), `event: message_end\ndata: ${JSON.stringify(end)}\n\n`);
  assert.equal(encodeAIStreamEvent(error), `event: error\ndata: ${JSON.stringify(error)}\n\n`);
});
