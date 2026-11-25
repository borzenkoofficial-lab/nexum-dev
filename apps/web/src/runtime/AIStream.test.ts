import assert from "node:assert/strict";
import test from "node:test";
import { AIStreamProtocolError, consumeAIStream, type AIStreamEvent } from "./AIStream.js";

function responseFromChunks(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

test("parses events split across arbitrary chunks and preserves event order", async () => {
  const frames = [
    'event: message_start\ndata: {"type":"message_start","provider":"mock","model":"test"}\n\n',
    'event: text_delta\ndata: {"type":"text_delta","text":"Привет"}\n\n',
    'event: usage\ndata: {"type":"usage","usage":{"inputTokens":3,"outputTokens":2},"source":"provider_reported"}\n\n',
    'event: message_end\ndata: {"type":"message_end","finishReason":"stop"}\n\n',
  ].join("");
  const chunks = [frames.slice(0, 7), frames.slice(7, 42), frames.slice(42, 87), frames.slice(87, 130), frames.slice(130)];
  const received: AIStreamEvent[] = [];
  await consumeAIStream(responseFromChunks(chunks), (event) => { received.push(event); });
  assert.deepEqual(received.map((event) => event.type), ["message_start", "text_delta", "usage", "message_end"]);
  assert.equal(received[1].type === "text_delta" ? received[1].text : "", "Привет");
});

test("supports UTF-8 code points split across byte chunks", async () => {
  const bytes = new TextEncoder().encode('event: text_delta\ndata: {"type":"text_delta","text":"Привет 👋"}\n\n');
  const chunks = Array.from(bytes, (byte) => Uint8Array.of(byte));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
  });
  const received: AIStreamEvent[] = [];
  await consumeAIStream(new Response(stream), (event) => { received.push(event); });
  assert.deepEqual(received, [{ type: "text_delta", text: "Привет 👋" }]);
});

test("ignores comments and parses CRLF plus multi-line data fields", async () => {
  const frame = ': keep-alive\r\nevent: text_delta\r\ndata: {"type":"text_delta",\r\ndata: "text":"line one\\nline two"}\r\n\r\n';
  const received: AIStreamEvent[] = [];
  await consumeAIStream(responseFromChunks([frame]), (event) => { received.push(event); });
  assert.deepEqual(received, [{ type: "text_delta", text: "line one\nline two" }]);
});

test("flushes a final event without a trailing blank line", async () => {
  const received: AIStreamEvent[] = [];
  await consumeAIStream(responseFromChunks(['event: message_end\ndata: {"type":"message_end","finishReason":"stop"}']), (event) => { received.push(event); });
  assert.deepEqual(received, [{ type: "message_end", finishReason: "stop" }]);
});

test("delivers provider errors as typed events", async () => {
  const received: AIStreamEvent[] = [];
  await consumeAIStream(responseFromChunks(['event: error\ndata: {"type":"error","code":"NETWORK_ERROR","message":"Provider unavailable"}\n\n']), (event) => { received.push(event); });
  assert.equal(received[0].type, "error");
});

test("rejects malformed JSON, unknown events and event/payload mismatches", async () => {
  for (const frame of [
    'event: text_delta\ndata: {not-json}\n\n',
    'event: surprise\ndata: {"type":"surprise"}\n\n',
    'event: text_delta\ndata: {"type":"message_end"}\n\n',
  ]) {
    await assert.rejects(
      () => consumeAIStream(responseFromChunks([frame]), () => undefined),
      AIStreamProtocolError,
    );
  }
});

test("rejects non-success HTTP responses without exposing response bodies", async () => {
  await assert.rejects(
    () => consumeAIStream(responseFromChunks(["secret"], 429), () => undefined),
    /HTTP 429/,
  );
});

test("rejects oversized SSE frames", async () => {
  const large = "x".repeat(2 * 1024 * 1024 + 1);
  const frame = `event: text_delta\ndata: ${JSON.stringify({ type: "text_delta", text: large })}\n\n`;
  await assert.rejects(
    () => consumeAIStream(responseFromChunks([frame]), () => undefined),
    AIStreamProtocolError,
  );
});
