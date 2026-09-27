import assert from "node:assert/strict";
import test from "node:test";
import { OrcaRouterProvider } from "./orcarouter.js";

test("exposes OrcaRouter free DeepSeek model", () => {
  const provider = new OrcaRouterProvider();
  assert.equal(provider.id, "orcarouter");
  assert.equal(provider.model, "deepseek/deepseek-v4-flash-free");
  assert.equal(provider.hasApiKey(), Boolean(process.env.ORCAROUTER_API_KEY?.trim()));
});

test("accepts a runtime OrcaRouter key", () => {
  const provider = new OrcaRouterProvider();
  provider.setRuntimeApiKey("sk-orca-test-key-1234567890");
  assert.equal(provider.hasApiKey(), true);
});


test("forwards model and generation limits to OrcaRouter", async () => {
  let body = "";
  const provider = new OrcaRouterProvider("https://orcarouter.test/v1", "deepseek/test-free", 1000, async (_input, init) => {
    body = String(init?.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  });
  provider.setRuntimeApiKey("test-only-key");
  assert.equal(await provider.generate("Привет", undefined, { maxTokens: 321, temperature: 0.2 }), "ok");
  assert.match(body, /"model":"deepseek\/test-free"/);
  assert.match(body, /"max_tokens":321/);
  assert.match(body, /"temperature":0.2/);
});

test("maps OrcaRouter rate-limit and auth errors distinctly", async () => {
  for (const [status, expected] of [
    [401, "OrcaRouter authentication failed (401)"],
    [403, "OrcaRouter access forbidden (403)"],
    [429, "OrcaRouter rate limit exceeded (429)"],
    [503, "OrcaRouter service error (503)"],
  ] as const) {
    const provider = new OrcaRouterProvider("https://orcarouter.test/v1", "deepseek/test-free", 1000, async () =>
      new Response(JSON.stringify({}), { status }),
    );
    provider.setRuntimeApiKey("test-only-key");
    await assert.rejects(() => provider.generate("test"), new RegExp(expected.replace(/[()]/g, "\\$&")));
  }
});
