import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AIGateway } from "../ai/gateway.js";
import type { AIProvider, AIGenerateOptions } from "../ai/types.js";
import { NexumAgent } from "./agent.js";
import { AgentLoop } from "./loop.js";

class ScriptedProvider implements AIProvider {
  id = "openrouter";
  name = "Scripted OpenRouter";
  model = "openrouter/free";
  capabilities = { text: true, code: true, vision: false, toolCalling: false, streaming: false, structuredOutput: true, reasoning: false, contextWindow: 32768 };
  private index = 0;
  readonly requestedMaxTokens: number[] = [];

  constructor(
    private readonly responses: string[],
    private readonly beforeGenerate?: () => Promise<void>,
    private readonly respondToMessage?: (message: string, index: number) => string,
  ) {}

  async generate(message: string, _model?: string, options?: AIGenerateOptions): Promise<string> {
    this.requestedMaxTokens.push(options?.maxTokens ?? 0);
    await this.beforeGenerate?.();
    const index = this.index++;
    return this.respondToMessage?.(message, index) ?? this.responses[index] ?? '{"done":true,"finalResponse":"Done"}';
  }
}

test("empty Builder project is scaffolded before the first model request", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "nexum-empty-builder-"));
  const provider = new ScriptedProvider(
    [
      JSON.stringify({
        goal: "Сайт ресторана с меню и бронированием",
        productType: "Сайт ресторана",
        targetUser: "Посетители ресторана",
        pages: ["Главная", "Меню", "Контакты"],
        components: ["Навигация", "Карточки блюд", "Форма бронирования"],
        visualSystem: ["Тёплая цветовая палитра", "Адаптивная сетка"],
        interactions: ["Отправка формы бронирования"],
        dataModel: ["Блюдо", "Бронирование"],
        filesToInspect: ["index.html", "style.css", "app.js"],
        filesToChange: ["index.html", "style.css", "app.js"],
        acceptanceCriteria: ["Есть меню и контакты ресторана"],
      }),
      JSON.stringify({
        tool: "writeFile",
        input: {
          path: "index.html",
          content: "<!doctype html><html lang=\"ru\"><body><h1>Кофейня Север</h1><section><h2>Меню</h2><p>Кофе и десерты</p></section><a href=\"#contacts\">Контакты</a></body></html>",
        },
      }),
    ],
    async () => {
      const scaffoldExists = await readFile(join(projectRoot, "index.html"), "utf8")
        .then(() => true)
        .catch(() => false);
      assert.equal(
        scaffoldExists,
        true,
        "the project must have a real scaffold before the first model request",
      );
    },
    (message) => {
      const prompt = message.toLowerCase();
      if (prompt.includes("you are the nexum product planner.") ||
          prompt.includes("turn the user's request into a concrete implementation plan for a coding agent")) {
        return JSON.stringify({
          goal: "Сайт ресторана с меню и бронированием",
          productType: "Сайт ресторана",
          targetUser: "Посетители ресторана",
          pages: ["Главная", "Меню", "Контакты"],
          components: ["Навигация", "Карточки блюд", "Форма бронирования"],
          visualSystem: ["Тёплая цветовая палитра", "Адаптивная сетка"],
          interactions: ["Отправка формы бронирования"],
          dataModel: ["Блюдо", "Бронирование"],
          filesToInspect: ["index.html", "style.css", "app.js"],
          filesToChange: ["index.html", "style.css", "app.js"],
          acceptanceCriteria: ["Есть меню и контакты ресторана"],
        });
      }
      return JSON.stringify({
        tool: "writeFile",
        input: {
          path: "index.html",
          content: "<!doctype html><html lang=\"ru\"><body><h1>Кофейня Север</h1><section><h2>Меню</h2><p>Кофе и десерты</p></section><a href=\"#contacts\">Контакты</a></body></html>",
        },
      });
    }
  );
  const gateway = new AIGateway([provider], "openrouter");
  const agent = new NexumAgent(gateway, projectRoot);
  const loop = new AgentLoop(agent, gateway);

  const result = await loop.run(
    "Создай сайт ресторана с меню и бронированием",
    { provider: "openrouter", model: "openrouter/free" },
  );

  assert.ok(result.steps.some((step) => step.tool === "scaffoldProject" && step.success));
  assert.ok(result.steps.some((step) => step.tool === "writeFile" && step.success), "Builder must start implementing after scaffold: " + JSON.stringify(result.steps));
  const successfulTools = result.steps.filter((step) => step.success).map((step) => step.tool);
  const scaffoldAt = successfulTools.indexOf("scaffoldProject");
  const refreshedListingAt = successfulTools.indexOf("listFiles", scaffoldAt + 1);
  const entryReadAt = successfulTools.indexOf("readFile", refreshedListingAt + 1);
  const implementationAt = successfulTools.indexOf("writeFile", entryReadAt + 1);
  assert.ok(scaffoldAt >= 0 && refreshedListingAt > scaffoldAt && entryReadAt > refreshedListingAt && implementationAt > entryReadAt,
    "Builder must scaffold, inspect the generated tree, read an entry file, then implement");
  assert.match(await readFile(join(projectRoot, "index.html"), "utf8"), /Кофейня Север/, "requested product content must replace the generic starter");
  assert.ok(provider.requestedMaxTokens.includes(1200), "Product Planner should receive the planner token budget");
  assert.ok(provider.requestedMaxTokens.includes(4000), "Builder implementation planning should receive the coder token budget");
});

test("known NEXUM starter is verified and replaced before the first model request", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "nexum-starter-builder-"));
  await writeFile(
    join(projectRoot, "index.html"),
    '<!doctype html><html lang="en"><body><p>Your project is ready. Ask the Agent to design and build it.</p></body></html>',
    "utf8",
  );
  await writeFile(join(projectRoot, "style.css"), "body { margin: 0; }", "utf8");
  await writeFile(
    join(projectRoot, "app.js"),
    'console.info("NEXUM project foundation ready"); // NEXUM project foundation ready',
    "utf8",
  );

  const provider = new ScriptedProvider(
    [
      JSON.stringify({
        goal: "Сайт кофейни с меню и контактами",
        productType: "Сайт кофейни",
        targetUser: "Посетители кофейни",
        pages: ["Главная", "Меню", "Контакты"],
        components: ["Навигация", "Карточки напитков"],
        visualSystem: ["Тёплая палитра", "Адаптивная сетка"],
        interactions: ["Переход к меню"],
        dataModel: ["Напиток"],
        filesToInspect: ["index.html", "style.css", "app.js"],
        filesToChange: ["index.html", "style.css", "app.js"],
        acceptanceCriteria: ["На странице есть меню и контакты"],
      }),
      "not valid model output",
    ],
    async () => {
      const html = await readFile(join(projectRoot, "index.html"), "utf8");
      assert.doesNotMatch(
        html,
        /Your project is ready\. Ask the Agent to design and build it\./i,
        "the known starter must be replaced before any model request",
      );
    },
  );
  const gateway = new AIGateway([provider], "openrouter");
  const agent = new NexumAgent(gateway, projectRoot);
  const loop = new AgentLoop(agent, gateway);

  const result = await loop.run(
    "Создай сайт кофейни с меню и контактами",
    { provider: "openrouter", model: "openrouter/free" },
  );

  assert.ok(result.steps.some((step) => step.tool === "scaffoldProject" && step.success));
  assert.doesNotMatch(
    await readFile(join(projectRoot, "index.html"), "utf8"),
    /Your project is ready\. Ask the Agent to design and build it\./i,
  );
});

