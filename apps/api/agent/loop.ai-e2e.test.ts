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
    if (this.calls === 1) {
      return JSON.stringify({ tool: "listFiles", input: "." });
    }
    if (this.calls === 2) {
      return JSON.stringify({ tool: "readFile", input: "index.html" });
    }
    if (this.calls === 3) {
      return JSON.stringify({
        tool: "writeFile",
        input: JSON.stringify({
          path: "index.html",
          content: "<!doctype html><html lang=\"ru\"><body><main><h1>Демонтаж фасадов</h1><p>Строительная компания</p></main></body></html>",
        }),
      });
    }
    return JSON.stringify({ done: true, finalResponse: "Готово: строительный сайт создан и проверен." });
  }
}

test("AI E2E keeps construction intent and executes a real AI plan", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-ai-e2e-"));
  await writeFile(join(root, "index.html"), "<!doctype html><html lang=\"ru\"><body><h1>Старый проект</h1></body></html>", "utf8");

  const gateway = new AIGateway([new E2EProvider()], "openai");
  const agent = new NexumAgent(gateway, root);
  const result = await new AgentLoop(agent, gateway, 8).run(
    "Создай современный сайт строительной компании по демонтажу фасадов",
  );

  assert.equal(result.success, true);
  assert.ok(result.productPlan);
  assert.match(result.productPlan?.productType ?? "", /Construction/i);
  assert.ok(result.steps.some((step) => step.tool === "listFiles"));
  assert.ok(result.steps.some((step) => step.tool === "readFile"));
  assert.ok(result.steps.some((step) => step.tool === "writeFile"));
  assert.ok(result.steps.some((step) => step.tool === "testProject"));
  assert.match(result.finalResponse ?? "", /Готово|создан|проверен/i);
});


class RecoveryE2EProvider extends E2EProvider {
  private recoveryCalls = 0;

  override async generate(message: string): Promise<string> {
    if (/NEXUM DEBUGGER RECOVERY MODE/i.test(message)) {
      this.recoveryCalls += 1;
      if (this.recoveryCalls === 1) {
        return JSON.stringify({ tool: "writeFile", input: JSON.stringify({
          path: "index.html",
          content: "<!doctype html><html lang="ru"><body><main><h1>Демонтаж фасадов</h1><p>Строительная компания</p></main></body></html>",
        }) });
      }
      return JSON.stringify({ done: true, finalResponse: "Debugger исправил ошибку и повторная проверка пройдена." });
    }
    return super.generate(message);
  }

  get recoveryCount() {
    return this.recoveryCalls;
  }
}

test("AI E2E recovers a real Preview-bound validation failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-ai-recovery-e2e-"));
  await writeFile(join(root, "index.html"), "<!doctype html><html lang="ru"><body><h1>Старый проект</h1></body></html>", "utf8");

  const provider = new RecoveryE2EProvider();
  const gateway = new AIGateway([provider], "openai");
  const agent = new NexumAgent(gateway, root);
  const result = await new AgentLoop(agent, gateway, 10).run(
    "Создай современный сайт строительной компании по демонтажу фасадов",
  );

  assert.equal(result.success, true);
  assert.ok(provider.recoveryCount >= 1);
  assert.ok(result.steps.some((step) => step.tool === "validateProject" && !step.success));
  assert.ok(result.steps.some((step) => step.tool === "writeFile" && step.success));
  assert.ok(result.steps.some((step) => step.tool === "validateProject" && step.success));
  assert.match(result.finalResponse ?? "", /Debugger|исправил|проверка/i);
});
