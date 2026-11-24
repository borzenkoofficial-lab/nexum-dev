import test from "node:test";
import assert from "node:assert/strict";
import { validateAgentConfig } from "./agentService.js";

const base = { name: "Demo", instructions: "Work", provider: "openrouter", model: "m" };
test("agent config restricts tools and bounds execution limits", () => {
  const c = validateAgentConfig({ ...base, tools: ["email_draft"], limits: { maxIterations: 999, maxToolCalls: -1, maxDurationSeconds: 1200, maxTokensPerRun: 999999 } });
  assert.deepEqual(c.tools, ["email_draft"]);
  assert.equal(c.limits.maxIterations, 30);
  assert.equal(c.limits.maxToolCalls, 0);
  assert.equal(c.limits.maxDurationSeconds, 900);
  assert.equal(c.limits.maxTokensPerRun, 100000);
});
test("agent config rejects unregistered tools", () => {
  assert.throws(() => validateAgentConfig({ ...base, tools: ["email_send"] }), /Unknown tool/);
});
test("agent definition accepts a custom role without a fixed profession enum", () => {
  const c = validateAgentConfig({ ...base, name: "Контролёр строительных смет", specialization: "Проверка смет генподрядчиков", modes: ["autonomous", "event"], capabilities: ["compare_estimates", "detect_scope_gaps"], channels: [{ type: "custom", config: { adapter: "future-crm" } }], triggers: [{ type: "event", config: { event: "estimate.uploaded" } }] });
  assert.equal(c.specialization, "Проверка смет генподрядчиков");
  assert.deepEqual(c.modes, ["autonomous", "event"]);
  assert.equal(c.triggers[0].type, "event");
});
test("external side effects remain denied unless explicitly enabled", () => {
  const c = validateAgentConfig(base);
  assert.equal(c.permissions.allowExternalSideEffects, false);
  assert.equal(c.memory.enabled, false);
});
test("agent config rejects unknown execution modes and invalid approval policies", () => {
  assert.throws(() => validateAgentConfig({ ...base, modes: ["magic"] }), /modes/);
  assert.throws(() => validateAgentConfig({ ...base, approvalPolicy: { payments: "automatic" } }), /approvalPolicy/);
});
