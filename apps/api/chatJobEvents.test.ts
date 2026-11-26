import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { ChatJob } from "./chatJobStore.js";
import { createChatJobEventsHandler } from "./chatJobEvents.js";

class FakeResponse extends EventEmitter {
  statusCode = 200;
  headers = new Map<string, string>();
  chunks: string[] = [];
  writableEnded = false;
  flushHeadersCalled = false;
  status(code: number) { this.statusCode = code; return this; }
  setHeader(name: string, value: string) { this.headers.set(name.toLowerCase(), value); return this; }
  flushHeaders() { this.flushHeadersCalled = true; }
  write(chunk: string) { this.chunks.push(chunk); return true; }
  json(body: unknown) { this.chunks.push(JSON.stringify(body)); this.end(); return this; }
  end() { this.writableEnded = true; this.emit("close"); return this; }
}

function job(status: ChatJob["status"], updatedAt: number, reply?: string): ChatJob {
  return { id: "job-1", userId: "user-1", status, createdAt: 1, updatedAt, reply };
}

function request(id = "job-1") {
  return { params: { id }, user: { id: "user-1" } } as unknown as Parameters<ReturnType<typeof createChatJobEventsHandler>>[0];
}

test("ChatJob SSE returns 404 before opening the stream for jobs owned by another user or missing jobs", async () => {
  const response = new FakeResponse();
  const handler = createChatJobEventsHandler({
    getUserId: () => "user-1",
    getJob: async () => null,
  });
  await handler(request(), response as never);
  assert.equal(response.statusCode, 404);
  assert.equal(response.writableEnded, true);
  assert.equal(response.headers.has("content-type"), false);
});

test("ChatJob SSE emits an initial snapshot and terminal job then closes", async () => {
  const response = new FakeResponse();
  const handler = createChatJobEventsHandler({
    getUserId: () => "user-1",
    getJob: async () => job("completed", 42, "finished"),
  });
  await handler(request(), response as never);
  assert.equal(response.statusCode, 200);
  assert.equal(response.flushHeadersCalled, true);
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  assert.equal(response.chunks.length, 1);
  assert.match(response.chunks[0], /event: job/);
  assert.match(response.chunks[0], /"reply":"finished"/);
  assert.equal(response.writableEnded, true);
});

test("ChatJob SSE sends updates as they change and stops at terminal state", async () => {
  const response = new FakeResponse();
  const sequence = [job("queued", 10), job("running", 11, "partial"), job("completed", 12, "done")];
  let reads = 0;
  const handler = createChatJobEventsHandler({
    getUserId: () => "user-1",
    getJob: async () => sequence[Math.min(reads++, sequence.length - 1)],
    pollIntervalMs: 1,
    heartbeatIntervalMs: 1000,
  });
  await handler(request(), response as never);
  assert.equal(response.chunks.length, 3);
  assert.match(response.chunks[1], /"status":"running"/);
  assert.match(response.chunks[1], /"reply":"partial"/);
  assert.match(response.chunks[2], /"status":"completed"/);
  assert.equal(response.writableEnded, true);
});

test("ChatJob SSE exits when client disconnects", async () => {
  const response = new FakeResponse();
  const handler = createChatJobEventsHandler({
    getUserId: () => "user-1",
    getJob: async () => job("running", Date.now()),
    pollIntervalMs: 1,
  });
  const running = handler(request(), response as never);
  await new Promise((resolve) => setTimeout(resolve, 5));
  response.emit("close");
  await running;
  assert.equal(response.writableEnded, true);
});
