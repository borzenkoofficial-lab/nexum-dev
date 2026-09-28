import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { AIGateway } from "../ai/gateway.js";
import type { AIProvider, AIProviderStatus } from "../ai/types.js";
import { NexumAgent } from "./agent.js";
import { AgentLoop } from "./loop.js";

class E2EProvider implements AIProvider {
  id = "openai";
  name = "NEXUM E2E";
  model = "e2e";
  private calls = 0;
  hasApiKey() { return true; }
  async getStatus(model = this.model): Promise<AIProviderStatus> {
    return { available: true, model, latencyMs: 1, error: undefined };
  }
  async listModels() { return [this.model]; }
  async generate(message: string): Promise<string> {
    this.calls += 1;
    if (/Product planner|product brief|product plan/i.test(message)) {
      return JSON.stringify({
        goal: "Создать сайт строительной компании по демонтажу фасадов",
        productType: "Construction company website",
        targetUser: "Клиенты строительной компании",
        pages: ["Главная", "Услуги", "Объекты", "Контакты"],
        components: ["Hero", "Services", "Projects", "CTA"],
        visualSystem: ["graphite", "yellow accents", "light serious UI"],
        interactions: ["contact CTA"],
        dataModel: [],
        filesToInspect: ["index.html"],
        filesToChange: ["index.html"],
        acceptanceCriteria: ["construction domain preserved", "Preview-ready"],
      });
    }
    const history = message.split(/Previous tool results:\s*/i)[1] ?? "";
    if (/listFiles/i.test(history) && !/writeFile/i.test(history)) {
      return JSON.stringify({ tool: "writeFile", input: JSON.stringify({
        path: "index.html",
        content: "<!doctype html><html lang=\"ru\"><body><main><h1>Демонтаж фасадов</h1><p>Строительная компания</p></main></body></html>",
      }) });
    }
    if (!history.trim()) {
      return JSON.stringify({ tool: "listFiles", input: "." });
    }
    return JSON.stringify({ done: true, finalResponse: "Готово: строительный сайт создан и проверен." });
  }
}


class ScriptedAgent extends NexumAgent {
  constructor(gateway: AIGateway, projectRoot: string, private readonly malformed = false) {
    super(gateway, projectRoot);
  }

  override async planWithAI(
    _task: string,
    previousResults: any[],
    options?: { role?: string },
  ): Promise<any> {
    if (previousResults.some((item) => item.tool === "testProject" && !item.result.success)) {
      return {
        tool: "writeFile",
        input: JSON.stringify({
          path: "index.html",
          content: "<!doctype html><html lang=\"ru\"><body><main><h1>Демонтаж фасадов</h1><p>Строительная компания</p></main></body></html>",
        }),
      };
    }
    if (options?.role === "debugger") {
      return {
        tool: "writeFile",
        input: JSON.stringify({
          path: "index.html",
          content: "<!doctype html><html lang=\"ru\"><body><main><h1>Демонтаж фасадов</h1><p>Строительная компания</p></main></body></html>",
        }),
      };
    }
    if (!previousResults.some((item) => item.tool === "listFiles" && item.result.success)) {
      return { tool: "listFiles", input: "." };
    }
    const writes = previousResults.filter((item) => item.tool === "writeFile" && item.result.success);
    if (writes.length === 0) {
      return {
        tool: "writeFile",
        input: JSON.stringify({
          path: "index.html",
          content: this.malformed
            ? "<!doctype html><html lang=\"ru\"><body><main><h1>Демонтаж фасадов</h1><p>Строительная компания</p><script>window.nexumBroken = true"
            : "<!doctype html><html lang=\"ru\"><body><main><h1>Демонтаж фасадов</h1><p>Строительная компания</p></main></body></html>",
        }),
      };
    }
    if (writes.length === 1) {
      return {
        tool: "writeFile",
        input: JSON.stringify({
          path: "style.css",
          content: "body{font-family:system-ui} main{padding:40px}",
        }),
      };
    }
    return { done: true, finalResponse: "Готово: реализация выполнена и проверена." };
  }
}

test("AI E2E keeps construction intent and executes a real AI plan", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-ai-e2e-"));
  await writeFile(join(root, "index.html"), "<!doctype html><html lang=\"ru\"><body><h1>Старый проект</h1></body></html>", "utf8");

  const gateway = new AIGateway([new E2EProvider()], "openai");
  const agent = new ScriptedAgent(gateway, root);
  const result = await new AgentLoop(agent, gateway, 8).run(
    "Создай современный сайт строительной компании по демонтажу фасадов",
    { provider: "openai", model: "e2e" },
  );

  assert.equal(result.success, true);
  assert.ok(result.productPlan);
  assert.match(result.productPlan?.productType ?? "", /Construction/i);
  assert.ok(result.steps.some((step) => step.tool === "listFiles"));
  assert.ok(result.steps.some((step) => step.tool === "writeFile"));
  assert.ok(result.steps.some((step) => step.tool === "testProject"));
  assert.match(result.finalResponse ?? "", /Готово|создан|проверен/i);
});

