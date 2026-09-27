import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AIGateway } from "../ai/gateway.js";
import type { AIProvider } from "../ai/types.js";
import { NexumAgent } from "./agent.js";
import { AgentLoop } from "./loop.js";

class ScriptedProvider implements AIProvider {
  id = "openrouter";
  name = "Scripted OpenRouter";
  model = "openrouter/free";
  private index = 0;

  constructor(private readonly responses: string[]) {}

  async generate(): Promise<string> {
    return this.responses[this.index++] ?? '{"done":true,"finalResponse":"Done"}';
  }
}

async function createLoop(responses: string[]) {
  const projectRoot = await mkdtemp(join(tmpdir(), "nexum-agent-loop-"));
  const provider = new ScriptedProvider(responses);
  const gateway = new AIGateway([provider], "openrouter");
  const agent = new NexumAgent(gateway, projectRoot);
  return { projectRoot, loop: new AgentLoop(agent, gateway) };
}

test("AI structured plan selects writeFile and executes it", async () => {
  const { projectRoot, loop } = await createLoop([
    JSON.stringify({ tool: "writeFile", input: { path: "index.html", content: "<h1>NEXUM.DEV</h1>" } }),
    JSON.stringify({ tool: "runCommand", input: "node --version" }),
    JSON.stringify({ done: true, finalResponse: "Created index.html and verified the project." }),
  ]);

  const result = await loop.run("Запиши index.html", { provider: "openrouter", model: "openrouter/free" });
  const content = await readFile(join(projectRoot, "index.html"), "utf8");

  assert.equal(result.success, true);
  assert.deepEqual(result.steps.map((step) => step.tool), ["writeFile", "runCommand"]);
  assert.equal(content, "<h1>NEXUM.DEV</h1>");
  assert.match(result.finalResponse ?? "", /Created index\.html/);
  assert.equal((result.finalResponse ?? "").includes("<h1>NEXUM.DEV</h1>"), false);
});

test("tool errors stop the Agent Loop with a clear error", async () => {
  const { loop } = await createLoop([
    JSON.stringify({ tool: "writeFile", input: { path: "../outside.txt", content: "blocked" } }),
  ]);

  const result = await loop.run("Запиши файл ../outside.txt");

  assert.equal(result.success, false);
  assert.equal(result.steps[0]?.tool, "writeFile");
  assert.match(result.error ?? "", /Tool writeFile failed|project directory/i);
});

test("invalid model tool calls fall back without executing arbitrary tools", async () => {
  const { loop } = await createLoop([
    "Here is code, not a tool call",
  ]);

  const result = await loop.run("Покажи структуру проекта");

  assert.equal(result.success, true);
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0]?.tool, "listFiles");
});

test("deterministic Builder fallback implements a scaffold when no real AI plan is available", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "nexum-agent-fallback-"));
  const gateway = new AIGateway([new (class implements AIProvider {
    id = "mock";
    name = "Mock";
    model = "mock";
    async generate(): Promise<string> { return "demo"; }
    async listModels(): Promise<string[]> { return ["mock"]; }
    async getStatus(model = this.model) { return { available: false, model, latencyMs: null, error: "test" }; }
  })()], "mock");
  const agent = new NexumAgent(gateway, projectRoot);
  const scaffold = {
    iteration: 1,
    tool: "scaffoldProject",
    input: "Создай React dashboard",
    result: { success: true, output: "React/Vite scaffold created for test." },
  };
  const inspection = {
    iteration: 1,
    tool: "listFiles",
    input: ".",
    result: { success: true, output: "package.json\nsrc/App.jsx\nsrc/styles.css" },
  };
  const appPlan = agent.plan("Создай React dashboard", [inspection, scaffold]);
  assert.equal(appPlan?.tool, "writeFile");
  assert.ok(appPlan?.input.includes('"path":"src/App.jsx"'));

  const appWrite = {
    iteration: 3,
    tool: "writeFile",
    input: appPlan?.input ?? "",
    result: { success: true, output: "App.jsx implemented" },
  };
  const stylesPlan = agent.plan("Создай React dashboard", [inspection, scaffold, appWrite]);
  assert.equal(stylesPlan?.tool, "writeFile");
  assert.ok(stylesPlan?.input.includes('"path":"src/styles.css"'));
});
