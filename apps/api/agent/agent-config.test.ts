import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AIGateway } from "../ai/gateway.js";
import { NexumAgent, formatConfiguredAgentInstructions } from "./agent.js";

test("configured agents expose only allowlisted tools and reject direct calls outside the allowlist", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "kvard-agent-policy-"));
  try {
    const agent = new NexumAgent(
      {} as AIGateway,
      projectRoot,
      undefined,
      {},
      { allowedTools: ["readFile"], systemPrompt: "Работай как аналитик." },
    );
    assert.deepEqual(agent.getAvailableTools(), ["readFile"]);
    const result = await agent.executeTool("writeFile", JSON.stringify({ path: "must-not-exist.txt", content: "blocked" }));
    assert.equal(result.success, false);
    assert.match(result.output, /не разрешён|not allowed/i);
    await assert.rejects(() => readFile(join(projectRoot, "must-not-exist.txt"), "utf8"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("configured instructions are clearly lower priority than platform safety", () => {
  const block = formatConfiguredAgentInstructions("Работай как аналитик.");
  assert.match(block, /lower priority than platform safety/);
  assert.match(block, /Работай как аналитик/);
  assert.equal(formatConfiguredAgentInstructions("   "), "");
});
