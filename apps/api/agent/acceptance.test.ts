import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AIGateway } from "../ai/gateway.js";
import { MockProvider } from "../ai/providers/mock.js";
import { NexumAgent } from "./agent.js";
import { AgentLoop } from "./loop.js";
import type { AgentRuntime, AgentPlan } from "./types.js";

const gateway = new AIGateway([new MockProvider()]);

test("NEXUM acceptance: builds a domain-locked static site and repairs a real validation failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-acceptance-"));
  await writeFile(
    join(root, "index.html"),
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Строительная компания</title></head><body><main id="app"></main></body></html>`,
    "utf8",
  );
  await writeFile(join(root, "style.css"), "body { margin: 0; }", "utf8");

  const agent = new NexumAgent(gateway, root);
  let repaired = false;
  let validationFailures = 0;

  const runtime: AgentRuntime = {
    getAvailableTools: () => agent.getAvailableTools().filter((tool) => tool !== "testProject"),
    plan: () => ({ tool: "", input: "", done: true, finalResponse: "fallback" }),
    executeTool: (tool, input) => agent.executeTool(tool, input),
    planWithAI: async (_task, previousResults) => {
      const hasWriteIndex = previousResults.some(
        (item) => item.tool === "writeFile" && item.result.success && item.input.includes("index.html"),
      );
      const hasWriteStyle = previousResults.some(
        (item) => item.tool === "writeFile" && item.result.success && item.input.includes("style.css"),
      );
      const hasValidationFailure = previousResults.some(
        (item) => item.tool === "validateProject" && !item.result.success,
      );

      if (!previousResults.some((item) => item.tool === "readFile")) {
        return { tool: "readFile", input: "index.html" };
      }

      if (!hasWriteIndex) {
        return {
          tool: "writeFile",
          input: JSON.stringify({
            path: "index.html",
            content: `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Строительная компания — демонтаж фасадов</title></head><body><main><h1>Демонтаж фасадов</h1><p>Строительная компания. Демонтаж, фасадные работы и подряд.</p></main></body></html>`,
          }),
        };
      }

      if (!hasWriteStyle) {
        return {
          tool: "writeFile",
          input: JSON.stringify({
            path: "style.css",
            content: hasValidationFailure
              ? "body { margin: 0; font-family: sans-serif; }"
              : "body { margin: 0; font-family: sans-serif; ",
          }),
        };
      }

      if (hasValidationFailure && !repaired) {
        repaired = true;
        return {
          tool: "writeFile",
          input: JSON.stringify({
            path: "style.css",
            content: "body { margin: 0; font-family: sans-serif; }",
          }),
        };
      }

      return { tool: "validateProject", input: "." };
    },
  };

  const originalExecute = runtime.executeTool;
  runtime.executeTool = async (tool, input) => {
    const result = await originalExecute(tool, input);
    if (tool === "validateProject" && !result.success) validationFailures += 1;
    return result;
  };

  const result = await new AgentLoop(runtime, gateway, 12).run(
    "Создай сайт строительной компании по демонтажу фасадов",
  );

  assert.equal(result.success, true);
  assert.ok(validationFailures >= 1, "the acceptance test must exercise a real verification failure");
  assert.equal(repaired, true, "the Debugger recovery path must produce a corrective write");
  assert.ok(
    result.steps.some((step) => step.tool === "domainValidation" && step.success),
    "domain validation must be reached",
  );
  assert.ok(
    result.steps.some((step) => step.tool === "validateProject" && step.success),
    "final static validation must pass",
  );
});
