import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenRouterProvider } from "./openrouter.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("requires OPENROUTER_API_KEY without exposing it", async () => {
  const provider = new OpenRouterProvider("https://openrouter.test");
  const result = await provider.getStatus();

  assert.equal(result.available, false);
  assert.equal(result.error, "OPENROUTER_API_KEY is not configured. Add it to the deployment environment.");
  assert.equal(JSON.stringify(result).includes("sk-"), false);
});

test("generates with the configured OpenRouter model", async () => {
  let requestedUrl = "";
  let requestedBody = "";
  const provider = new OpenRouterProvider("https://openrouter.test", "openrouter/free", 1000, async (input, init) => {
    requestedUrl = String(input);
    requestedBody = String(init?.body);
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-only-key");
    return jsonResponse(200, { choices: [{ message: { content: "Hello from OpenRouter" } }] });
  });
  provider.setRuntimeApiKey("test-only-key");
  const result = await provider.generate("Привет", "openrouter/free");

  assert.equal(result, "Hello from OpenRouter");
  assert.equal(requestedUrl, "https://openrouter.test/chat/completions");
  assert.match(requestedBody, /"model":"openrouter\/free"/);
});

test("maps OpenRouter HTTP errors without returning the key", async () => {
  for (const [status, expected] of [
    [401, "OpenRouter authentication failed (401)"],
    [403, "OpenRouter access forbidden (403)"],
    [429, "OpenRouter rate limit exceeded (429)"],
    [503, "OpenRouter service error (503)"],
  ] as const) {
    const provider = new OpenRouterProvider("https://openrouter.test", "openrouter/free", 1000, async () => jsonResponse(status, {}));
    provider.setRuntimeApiKey("test-only-key");
    const result = await provider.getStatus();
    assert.equal(result.available, false);
    assert.equal(result.error, expected);
    assert.equal(JSON.stringify(result).includes("test-only-key"), false);
  }
});

test("maps OpenRouter timeout without the key", async () => {
  const provider = new OpenRouterProvider("https://openrouter.test", "openrouter/free", 5, async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
  provider.setRuntimeApiKey("test-only-key");
  const result = await provider.getStatus();

  assert.equal(result.available, false);
  assert.equal(result.error, "OpenRouter request timed out");
});


test("routes code and planning prompts to different free-model families", async () => {
  const provider = new OpenRouterProvider("https://openrouter.test", "openrouter/free", 1000, async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { model?: string };
    return jsonResponse(200, { choices: [{ message: { content: body.model ?? "" } }] });
  });
  provider.setRuntimeApiKey("test-only-key");
  const code = await provider.generate("fix this TypeScript React build error");
  const planning = await provider.generate("plan the architecture for a multi-step autonomous agent");
  assert.match(code, /north-mini-code|laguna-s-2\.1|laguna-xs-2\.1/);
  assert.match(planning, /nemotron-3-ultra|nemotron-3\.5-lightning/);
});


test("does not silently switch an explicitly selected model", async () => {
  let requestedModels: string[] = [];
  const provider = new OpenRouterProvider("https://openrouter.test", "openrouter/free", 1000, async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { model?: string };
    requestedModels.push(body.model ?? "");
    return jsonResponse(200, { choices: [{ message: { content: body.model ?? "" } }] });
  });
  provider.setRuntimeApiKey("test-only-key");

  const result = await provider.generate("write code", "qwen/example-explicit-model");

  assert.equal(result, "qwen/example-explicit-model");
  assert.deepEqual(requestedModels, ["qwen/example-explicit-model"]);
});
