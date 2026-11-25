import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import test from "node:test";
import type { AIGateway } from "./gateway.js";
import { createAIStreamHandler } from "./streamRoute.js";
import type { AIRequest, AIStreamEvent } from "./types.js";

const validBody = {
  model: "test-model",
  messages: [{ role: "user", content: "Hello" }],
};

async function withServer(
  gateway: AIGateway,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    if (userId) req.user = {
      id: userId,
      email: "test@example.invalid",
      name: "Test",
      createdAt: new Date(0).toISOString(),
    };
    next();
  });
  app.post("/api/ai/stream", createAIStreamHandler(() => gateway));
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function fakeGateway(
  stream: (request: AIRequest) => AsyncIterable<AIStreamEvent>,
): AIGateway {
  return {
    streamRequest: stream,
  } as unknown as AIGateway;
}

test("rejects unauthenticated requests before resolving a gateway", async () => {
  let gatewayCalls = 0;
  await withServer(fakeGateway(async function* () {}), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ai/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      success: false,
      error: "Authentication required.",
    });
  });
  assert.equal(gatewayCalls, 0);
});

test("validates the canonical request before opening an SSE response", async () => {
  let gatewayCalls = 0;
  const gateway = fakeGateway(async function* () {
    gatewayCalls += 1;
  });
  await withServer(gateway, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ai/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "user-1" },
      body: JSON.stringify({ model: "", messages: [] }),
    });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("content-type")?.includes("text/event-stream"), false);
    const body = await response.json() as { success: boolean; error: { code: string; requestId: string } };
    assert.equal(body.success, false);
    assert.ok(body.error.code);
    assert.ok(body.error.requestId);
  });
  assert.equal(gatewayCalls, 0);
});

test("streams canonical events in order and preserves response headers", async () => {
  const seen: AIRequest[] = [];
  const gateway = fakeGateway(async function* (request) {
    seen.push(request);
    yield { type: "message_start", provider: "mock", model: "test-model", requestId: "provider-id" };
    yield { type: "text_delta", text: "Hello" };
    yield { type: "usage", usage: { inputTokens: 2, outputTokens: 1 }, source: "provider_reported" };
    yield { type: "message_end", finishReason: "stop" };
  });
  await withServer(gateway, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ai/stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-user": "user-42",
        "x-request-id": "request-42",
      },
      body: JSON.stringify({ ...validBody, provider: "mock", metadata: { userId: "forged" } }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/);
    assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    assert.equal(response.headers.get("x-request-id"), "request-42");
    const text = await response.text();
    const events = [...text.matchAll(/^event: ([^\n]+)\ndata: (.+)\n\n/gm)].map((match) => ({
      type: match[1],
      payload: JSON.parse(match[2]) as Record<string, unknown>,
    }));
    assert.deepEqual(events.map((event) => event.type), [
      "message_start", "text_delta", "usage", "message_end",
    ]);
    assert.equal((events[1].payload).text, "Hello");
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].metadata?.userId, "user-42");
  assert.equal(seen[0].metadata?.requestId, "request-42");
  assert.equal(seen[0].signal?.aborted, false);
});

test("converts a provider failure after SSE headers into a safe error event", async () => {
  const gateway = fakeGateway(async function* () {
    throw new Error("provider internal detail");
  });
  await withServer(gateway, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ai/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "user-1" },
      body: JSON.stringify(validBody),
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /^event: error\ndata: /);
    const payload = JSON.parse(text.match(/^event: error\ndata: (.+)\n\n$/)?.[1] ?? "{}");
    assert.equal(payload.type, "error");
    assert.equal(typeof payload.code, "string");
    assert.equal(payload.message.includes("provider internal detail"), false);
  });
});

test("aborts the upstream request when the client disconnects", async () => {
  let observedAbort = false;
  let resolveAbort!: () => void;
  const abortObserved = new Promise<void>((resolve) => { resolveAbort = resolve; });
  const gateway = fakeGateway(async function* (request) {
    yield { type: "message_start", provider: "mock", model: "test-model" };
    await new Promise<void>((resolve) => {
      if (request.signal?.aborted) resolve();
      else request.signal?.addEventListener("abort", resolve, { once: true });
    });
    observedAbort = request.signal?.aborted === true;
    resolveAbort();
  });
  await withServer(gateway, async (baseUrl) => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/ai/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "user-1" },
      body: JSON.stringify(validBody),
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    const reader = response.body?.getReader();
    assert.ok(reader);
    await reader.read();
    controller.abort();
    await assert.rejects(() => reader.cancel());
    await Promise.race([
      abortObserved,
      new Promise((_, reject) => setTimeout(() => reject(new Error("upstream abort timed out")), 1500)),
    ]);
  });
  assert.equal(observedAbort, true);
});
