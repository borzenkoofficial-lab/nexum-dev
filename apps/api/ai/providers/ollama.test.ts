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
