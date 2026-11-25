import assert from "node:assert/strict";
import { test } from "node:test";
import { AIGateway } from "./gateway.js";
import { AIModelRegistry } from "./modelRegistry.js";
import type { AIProvider } from "./types.js";

function provider(id: string, model: string): AIProvider {
  return {
    id,
    name: id,
    model,
    capabilities: {
      text: true,
      code: id === "coder",
      vision: false,
      toolCalling: false,
      streaming: false,
      structuredOutput: false,
      reasoning: false,
      contextWindow: 8192,
    },
    async generate() { return "ok"; },
    async listModels() { return [model]; },
  };
}

test("model registry selects a model by declared capabilities", async () => {
  const gateway = new AIGateway([provider("plain", "text-v1"), provider("coder", "code-v1")], "plain");
  const registry = new AIModelRegistry(gateway);

  const selected = await registry.select({ text: true, code: true });

  assert.deepEqual(
    { provider: selected?.provider, model: selected?.model },
    { provider: "coder", model: "code-v1" },
  );
});

test("model registry rejects an explicitly selected model that lacks required capabilities", async () => {
  const gateway = new AIGateway([provider("plain", "text-v1")], "plain");
  const registry = new AIModelRegistry(gateway);

  const selected = await registry.select({ text: true, code: true }, { model: "text-v1" });

  assert.equal(selected, null);
});


test("model registry exposes unverified configured fallback but never selects it", async () => {
  const offline: AIProvider = {
    ...provider("offline", "fallback-model"),
    async listModels() { throw new Error("provider unavailable"); },
  };
  const registry = new AIModelRegistry(new AIGateway([offline], offline.id));
  const listed = await registry.list();
  assert.equal(listed[0].verified, false);
  assert.equal(listed[0].source, "configured_fallback");
  assert.equal(await registry.select({ text: true }), null);
});

test("explicit model selection requires a verified model in the provider catalog", async () => {
  const available = provider("available", "configured-model");
  available.listModels = async () => ["verified-model"];
  const registry = new AIModelRegistry(new AIGateway([available], available.id));
  assert.equal(await registry.select({ text: true }, { model: "not-in-catalog" }), null);
  const selected = await registry.select({ text: true }, { model: "verified-model" });
  assert.equal(selected?.verified, true);
  assert.equal(selected?.source, "provider_api");
});
