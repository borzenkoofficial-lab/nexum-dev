import assert from "node:assert/strict";
import { test } from "node:test";
import { AIGateway } from "../ai/gateway.js";
import { MockProvider } from "../ai/providers/mock.js";
import { NexumAgent } from "./agent.js";
import { AgentLoop } from "./loop.js";
import type { AgentRuntime } from "./types.js";

const gateway = new AIGateway([new MockProvider()]);

function fakeRuntime(
  plan: AgentRuntime["plan"],
  executeTool: AgentRuntime["executeTool"],
): AgentRuntime {
  return {
    getAvailableTools: () => ["fake"],
    plan,
    executeTool,
  };
}

test("completes a one-operation task", async () => {
  const agent = new NexumAgent(gateway);
  const runtime = fakeRuntime(
    (task, previousResults) => agent.plan(task, previousResults),
    async () => ({ success: true, output: "git status passed" }),
  );
  runtime.getAvailableTools = () => agent.getAvailableTools();
  const result = await new AgentLoop(runtime, gateway).run("Покажи статус Git");

  assert.equal(result.success, true);
  assert.equal(result.iterations, 1);
  assert.equal(result.steps[0]?.tool, "git");
});

test("completes a multi-operation project task", async () => {
  const agent = new NexumAgent(gateway);
  const runtime = fakeRuntime(
    (task, previousResults) => agent.plan(task, previousResults),
    async () => ({ success: true, output: "sandbox check passed" }),
  );
  runtime.getAvailableTools = () => agent.getAvailableTools();
  const result = await new AgentLoop(runtime, gateway).run("Покажи структуру проекта и проверь сборку");

  assert.equal(result.success, true);
  assert.equal(result.iterations, 2);
  assert.deepEqual(result.steps.map((step) => step.tool), ["listFiles", "runSandbox"]);
});

test("stops when a tool returns an error", async () => {
  const result = await new AgentLoop(new NexumAgent(gateway), gateway).run(
    "Прочитай файл ../package.json",
  );

  assert.equal(result.success, false);
  assert.ok(result.iterations >= 1 && result.iterations <= 10);
  assert.match(result.error ?? "", /failed|project directory|maximum iterations|repeated action/i);
});

test("stops at the ten-iteration limit", async () => {
  const runtime = fakeRuntime(
    (_task, previousResults) => ({ tool: "fake", input: String(previousResults.length) }),
    async () => ({ success: true, output: "ok" }),
  );
  const result = await new AgentLoop(runtime, gateway, 10).run("repeat until the limit");

  assert.equal(result.success, false);
  assert.equal(result.iterations, 10);
  assert.equal(result.steps.length, 10);
  assert.match(result.error ?? "", /maximum iterations/i);
});

test("stops repeated identical actions", async () => {
  const runtime = fakeRuntime(
    () => ({ tool: "fake", input: "same" }),
    async () => ({ success: true, output: "ok" }),
  );
  const result = await new AgentLoop(runtime, gateway).run("repeat the same action");

  assert.equal(result.success, false);
  assert.equal(result.iterations, 1);
  assert.equal(result.steps.length, 1);
  assert.match(result.error ?? "", /repeated action/i);
});
