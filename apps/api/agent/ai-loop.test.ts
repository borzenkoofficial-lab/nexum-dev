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

  const result = await loop.run("Создай простой сайт NEXUM.DEV", { provider: "openrouter", model: "openrouter/free" });
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

  const result = await loop.run("Создай простой сайт NEXUM.DEV");

  assert.equal(result.success, false);
  assert.equal(result.steps[0]?.tool, "writeFile");
  assert.match(result.error ?? "", /Tool writeFile failed|project directory/i);
});

test("invalid model tool calls fall back without executing arbitrary tools", async () => {
  const { loop } = await createLoop([
    "Here is code, not a tool call",
  ]);

  const result = await loop.run("Создай простой сайт NEXUM.DEV");

  assert.equal(result.success, true);
  assert.equal(result.steps.length, 0);
});
