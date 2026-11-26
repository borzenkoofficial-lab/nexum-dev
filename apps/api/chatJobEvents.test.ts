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
  const jobEvents = response.chunks.filter((chunk) => chunk.includes("event: job"));
  assert.equal(jobEvents.length, 1);
  assert.match(response.chunks[0], /retry: 1500/);
  assert.match(jobEvents[0], /"reply":"finished"/);
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
  const jobEvents = response.chunks.filter((chunk) => chunk.includes("event: job"));
  assert.equal(jobEvents.length, 3);
  assert.match(jobEvents[1], /"status":"running"/);
  assert.match(jobEvents[1], /"reply":"partial"/);
  assert.match(jobEvents[2], /"status":"completed"/);
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

test("ChatJob SSE waits for response drain when the client is backpressured", async () => {
  class BackpressuredResponse extends FakeResponse {
    blocked = true;
    override write(chunk: string) {
      this.chunks.push(chunk);
      if (this.blocked) {
        this.blocked = false;
        setTimeout(() => this.emit("drain"), 5);
        return false;
      }
      return true;
    }
  }
  const response = new BackpressuredResponse();
  const handler = createChatJobEventsHandler({
    getUserId: () => "user-1",
    getJob: async () => job("completed", 42),
  });
  await handler(request(), response as never);
  assert.equal(response.writableEnded, true);
  assert.equal(response.chunks.length, 2);
});

test("ChatJob SSE rejects malformed route parameters", async () => {
  const response = new FakeResponse();
  const handler = createChatJobEventsHandler({
    getUserId: () => "user-1",
    getJob: async () => { throw new Error("Should not look up invalid ID"); },
  });
  const malformedRequest = { params: { id: undefined } } as unknown as Parameters<ReturnType<typeof createChatJobEventsHandler>>[0];
  await handler(malformedRequest, response as never);
  assert.equal(response.statusCode, 400);
  assert.equal(response.writableEnded, true);
});


test("ChatJob SSE reconnect starts with the latest persisted snapshot", async () => {
  const response = new FakeResponse();
  const handler = createChatJobEventsHandler({
    getUserId: () => "user-1",
    getJob: async () => job("running", 99, "latest persisted progress"),
  });
  await handler(request(), response as never);
  const initial = response.chunks.find((chunk) => chunk.includes("event: job"));
  assert.match(initial ?? "", /"updatedAt":99/);
  assert.match(initial ?? "", /"reply":"latest persisted progress"/);
  assert.equal(response.writableEnded, false);
  response.emit("close");
});
