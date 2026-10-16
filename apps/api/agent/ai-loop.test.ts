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
  ) {}

  async generate(_message: string, _model?: string, options?: AIGenerateOptions): Promise<string> {
    this.requestedMaxTokens.push(options?.maxTokens ?? 0);
    await this.beforeGenerate?.();
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
      // Planner/recovery paths may request more than one model turn before
      // selecting an executable action. Keep the scripted coder response
      // available rather than letting the test silently fall back to "Done".
      ...Array.from({ length: 4 }, () => JSON.stringify({
        tool: "writeFile",
        input: {
          path: "index.html",
          content: "<!doctype html><html lang=\"ru\"><body><h1>Кофейня Север</h1><section><h2>Меню</h2><p>Кофе и десерты</p></section><a href=\"#contacts\">Контакты</a></body></html>",
        },
      })),
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
  );
  const gateway = new AIGateway([provider], "openrouter");
  const agent = new NexumAgent(gateway, projectRoot);
  const loop = new AgentLoop(agent, gateway);

  const result = await loop.run(
    "Создай сайт ресторана с меню и бронированием",
    { provider: "openrouter", model: "openrouter/free" },
  );

  assert.ok(result.steps.some((step) => step.tool === "scaffoldProject" && step.success));
  assert.ok(result.steps.some((step) => step.tool === "writeFile" && step.success), "Builder must start implementing after scaffold");
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

test("AI structured plan selects writeFile and executes it", async () => {
  const { projectRoot, loop } = await createLoop([
    JSON.stringify({ tool: "writeFile", input: { path: "index.html", content: "<!doctype html><html><body><h1>NEXUM.DEV</h1></body></html>" } }),
    JSON.stringify({ tool: "validateProject", input: "." }),
    JSON.stringify({ done: true, finalResponse: "Created index.html and verified the project." }),
  ]);

  const result = await loop.run("Запиши index.html", { provider: "openrouter", model: "openrouter/free" });
  const content = await readFile(join(projectRoot, "index.html"), "utf8");

  assert.equal(result.success, true);
  assert.deepEqual(result.steps.map((step) => step.tool), ["writeFile", "validateProject"]);
  assert.equal(content, "<!doctype html><html><body><h1>NEXUM.DEV</h1></body></html>");
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

test("deterministic Builder recovery inspects an existing scaffold before editing", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "nexum-agent-fallback-"));
  const gateway = new AIGateway([new (class implements AIProvider {
    id = "mock";
    name = "Mock";
    model = "mock";
    capabilities = { text: true, code: true, vision: false, toolCalling: false, streaming: false, structuredOutput: true, reasoning: false, contextWindow: 32768 };
    async generate(): Promise<string> { return "demo"; }
    async listModels(): Promise<string[]> { return ["mock"]; }
    async getStatus(model = this.model) { return { available: false, model, latencyMs: null, error: "test" }; }
  })()], "mock");
  const agent = new NexumAgent(gateway, projectRoot);
  const inspection = {
    iteration: 1,
    tool: "listFiles",
    input: ".",
    result: { success: true, output: "package.json\\nsrc/App.jsx\\nsrc/styles.css" },
  };
  const scaffold = {
    iteration: 1,
    tool: "scaffoldProject",
    input: "Создай React dashboard",
    result: { success: true, output: "React/Vite scaffold created for test." },
  };
  const packageRead = agent.plan("Создай React dashboard", [inspection, scaffold]);
  assert.equal(packageRead?.tool, "readFile");
  assert.equal(packageRead?.input, "package.json");

  const appRead = agent.plan("Создай React dashboard", [
    inspection,
    scaffold,
    {
      iteration: 2,
      tool: "readFile",
      input: "package.json",
      result: { success: true, output: '{"scripts":{"build":"vite build"}}' },
    },
  ]);
  assert.equal(appRead?.tool, "readFile");
  assert.equal(appRead?.input, "src/App.jsx");
});

test("domain alignment rejects automotive content for construction tasks", async () => {
  const { projectRoot } = await createLoop([]);
  const gateway = new AIGateway([new ScriptedProvider([])], "openrouter");
  const agent = new NexumAgent(gateway, projectRoot);
  const aligned = (agent as unknown as {
    isPlanAlignedWithTask: (task: string, plan: { tool: string; input: string }) => boolean;
  }).isPlanAlignedWithTask(
    "Создай сайт строительной компании",
    { tool: "writeFile", input: JSON.stringify({ path: "index.html", content: "<h1>Автомобильный ремонт</h1>" }) },
  );
  assert.equal(aligned, false);
});

test("repaired AI plans cannot bypass the domain alignment contract", async () => {
  const { projectRoot } = await createLoop([
    JSON.stringify({
      tool: "writeFile",
      input: { path: "index.html", content: "<h1>Автосервис</h1>" },
    }),
    JSON.stringify({
      tool: "writeFile",
      input: { path: "index.html", content: "<h1>Автомобильный ремонт</h1>" },
    }),
  ]);
  const gateway = new AIGateway([
    new ScriptedProvider([
      JSON.stringify({
        tool: "writeFile",
        input: { path: "index.html", content: "<h1>Автосервис</h1>" },
      }),
      JSON.stringify({
        tool: "writeFile",
        input: { path: "index.html", content: "<h1>Автомобильный ремонт</h1>" },
      }),
    ]),
  ], "openrouter");
  const agent = new NexumAgent(gateway, projectRoot);

  const result = await agent.planWithAI(
    "Создай сайт строительной компании",
    [],
    { provider: "openrouter", model: "openrouter/free" },
  );

  assert.equal(result, null);
});
