import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenRouterProvider } from "./openrouter.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function withKey<T>(key: string | undefined, callback: () => Promise<T>): Promise<T> {
  const previousKey = process.env.OPENROUTER_API_KEY;
  if (key === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = key;
  try {
    return await callback();
  } finally {
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
}

test("requires OPENROUTER_API_KEY without exposing it", async () => {
  const result = await withKey(undefined, async () => {
    const provider = new OpenRouterProvider("https://openrouter.test");
    return provider.getStatus();
  });

  assert.equal(result.available, false);
  assert.equal(result.error, "OPENROUTER_API_KEY is not configured");
  assert.equal(JSON.stringify(result).includes("sk-"), false);
});

test("generates with the configured OpenRouter model", async () => {
  let requestedUrl = "";
  let requestedBody = "";
  const result = await withKey("test-only-key", async () => {
    const provider = new OpenRouterProvider("https://openrouter.test", "openrouter/free", 1000, async (input, init) => {
      requestedUrl = String(input);
      requestedBody = String(init?.body);
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-only-key");
      return jsonResponse(200, { choices: [{ message: { content: "Hello from OpenRouter" } }] });
    });
    return provider.generate("Привет", "openrouter/free");
  });

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
    const result = await withKey("test-only-key", async () => {
      const provider = new OpenRouterProvider("https://openrouter.test", "openrouter/free", 1000, async () => jsonResponse(status, {}));
      return provider.getStatus();
    });
    assert.equal(result.available, false);
    assert.equal(result.error, expected);
    assert.equal(JSON.stringify(result).includes("test-only-key"), false);
  }
});

test("maps OpenRouter timeout without the key", async () => {
  const result = await withKey("test-only-key", async () => {
    const provider = new OpenRouterProvider("https://openrouter.test", "openrouter/free", 5, async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }));
    return provider.getStatus();
  });

  assert.equal(result.available, false);
  assert.equal(result.error, "OpenRouter request timed out");
});
