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
