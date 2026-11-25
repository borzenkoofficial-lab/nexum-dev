import assert from "node:assert/strict";
import { test } from "node:test";
import { OllamaProvider } from "./ollama.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("generates through Ollama chat API with a selectable model", async () => {
  let requestedUrl = "";
  let requestedBody = "";
  const provider = new OllamaProvider(
    "http://ollama.test",
    "qwen3-coder",
    1000,
    async (input, init) => {
      requestedUrl = String(input);
      requestedBody = String(init?.body);
      return jsonResponse(200, { message: { content: "Hello from Ollama" } });
    },
  );

  const result = await provider.generate("Привет", "llama3.2");
  assert.equal(result, "Hello from Ollama");
  assert.equal(requestedUrl, "http://ollama.test/api/chat");
  assert.match(requestedBody, /"model":"llama3.2"/);
});

test("reports Ollama as unavailable without leaking configuration", async () => {
  const provider = new OllamaProvider(
    "http://ollama.test",
    "qwen3-coder",
    1000,
    async () => {
      throw new Error("connection refused");
    },
  );

  const status = await provider.getStatus();
  assert.equal(status.available, false);
  assert.equal(status.error, "Ollama is unavailable");
  assert.equal(status.error?.includes("ollama.test"), false);
});

test("maps Ollama HTTP errors", async () => {
  const provider = new OllamaProvider(
    "http://ollama.test",
    "qwen3-coder",
    1000,
    async () => jsonResponse(503, { error: "unavailable" }),
  );

  await assert.rejects(() => provider.generate("test"), /Ollama request failed \(503\)/);
});

test("maps aborted requests to timeout", async () => {
  const provider = new OllamaProvider(
    "http://ollama.test",
    "qwen3-coder",
    5,
    async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
  );

  await assert.rejects(() => provider.generate("test"), /Ollama request timed out/);
});


test("streams Ollama NDJSON text and final provider usage", async () => {
  const calls: string[] = [];
  const streamBody = new ReadableStream<Uint8Array>({
    start(controller) {
      const frames = [
        '{"model":"qwen3:4b","message":{"role":"assistant","content":"Hello"},"done":false}',
        '{"model":"qwen3:4b","message":{"role":"assistant","content":" world"},"done":false}',
        '{"model":"qwen3:4b","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":7,"eval_count":3}',
      ];
      const bytes = new TextEncoder().encode(frames.join("\n") + "\n");
      controller.enqueue(bytes.slice(0, 17));
      controller.enqueue(bytes.slice(17, 81));
      controller.enqueue(bytes.slice(81));
      controller.close();
    },
  });
  const provider = new OllamaProvider("http://ollama.test", "qwen3:4b", 1000, async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/api/tags")) return jsonResponse(200, { models: [{ name: "qwen3:4b" }] });
    const body = JSON.parse(String(init?.body)) as Record<string, any>;
    assert.equal(body.stream, true);
    assert.equal(body.model, "qwen3:4b");
    return new Response(streamBody, { status: 200, headers: { "content-type": "application/x-ndjson" } });
  });
  assert.equal(provider.getCapabilities("qwen3:4b").streaming, false);
  await provider.listModels();
  assert.equal(provider.getCapabilities("qwen3:4b").streaming, true);
  const events = [];
  for await (const event of provider.streamRequest({
    version: 1,
    model: "qwen3:4b",
    stream: true,
    messages: [{ role: "user", content: "Hello" }],
    maxTokens: 128,
    temperature: 0.2,
  })) events.push(event);
  assert.deepEqual(calls, ["http://ollama.test/api/tags", "http://ollama.test/api/chat"]);
  assert.deepEqual(events, [
    { type: "message_start", provider: "ollama", model: "qwen3:4b" },
    { type: "text_delta", text: "Hello" },
    { type: "text_delta", text: " world" },
    { type: "usage", usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 }, source: "provider_reported" },
    { type: "message_end", finishReason: "stop" },
  ]);
});

test("Ollama stream rejects unsupported inputs before network and truncated NDJSON", async () => {
  let chatCalls = 0;
  const truncated = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"model":"qwen3:4b","message":{"content":"partial"},"done":false}\n'));
      controller.close();
    },
  });
  const provider = new OllamaProvider("http://ollama.test", "qwen3:4b", 1000, async (input) => {
    if (String(input).endsWith("/api/tags")) return jsonResponse(200, { models: [{ name: "qwen3:4b" }] });
    chatCalls += 1;
    return new Response(truncated, { status: 200, headers: { "content-type": "application/x-ndjson" } });
  });
  await provider.listModels();
  await assert.rejects(async () => {
    for await (const _event of provider.streamRequest({
      version: 1, model: "qwen3:4b", stream: true,
      messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://example.test/image.png" } }] }],
    })) { /* consume */ }
  }, /image input/);
  assert.equal(chatCalls, 0);
  await assert.rejects(async () => {
    for await (const _event of provider.streamRequest({
      version: 1, model: "qwen3:4b", stream: true,
      messages: [{ role: "user", content: "Hello" }],
    })) { /* consume */ }
  }, /final done frame/);
  assert.equal(chatCalls, 1);
});
