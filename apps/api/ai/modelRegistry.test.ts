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
