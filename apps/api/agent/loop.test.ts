import assert from "node:assert/strict";
import { test } from "node:test";
import { AIGateway } from "../ai/gateway.js";
import { MockProvider } from "../ai/providers/mock.js";
import { NexumAgent } from "./agent.js";
import { AgentLoop, compactAgentHistory } from "./loop.js";
import type { AgentRuntime } from "./types.js";
import type { AIProvider } from "../ai/types.js";

const gateway = new AIGateway([new MockProvider()]);
class ProductPlanProvider implements AIProvider {
  id = "test-planner";
  name = "Test planner";
  model = "planner-test";
  capabilities = { text: true, code: true, vision: false, toolCalling: false, streaming: false, structuredOutput: true, reasoning: false, contextWindow: 32768 };
  async generate(): Promise<string> {
    return JSON.stringify({
      goal: "Создать сайт автосервиса",
      productType: "Auto repair service website",
      targetUser: "Владельцы автомобилей",
      pages: ["Главная", "Услуги", "Диагностика", "Цены", "Отзывы", "Контакты"],
      components: ["Услуги", "Отзывы", "Форма записи"],
      visualSystem: ["Профессиональный автосервис"],
      interactions: ["Запись на обслуживание"],
      dataModel: ["Заявка на обслуживание"],
      filesToInspect: ["src/App.tsx"],
      filesToChange: ["src/App.tsx"],
      acceptanceCriteria: ["Auto repair services and diagnostics are clearly represented"]
    });
  }
}


test("compacts large tool history while preserving actionable failures", () => {
  const large = "x".repeat(20_000);
  const history = compactAgentHistory([
    { iteration: 1, tool: "writeFile", input: JSON.stringify({ path: "src/App.tsx", content: large }), result: { success: true, output: large } },
    { iteration: 2, tool: "runCommand", input: "npm run build", result: { success: false, output: "TypeScript error: src/App.tsx:42 " + large } },
    { iteration: 3, tool: "listFiles", input: ".", result: { success: true, output: "src/App.tsx\\npackage.json" } },
  ]);
  assert.ok(JSON.stringify(history).length < 5_500);
  assert.equal(history.some((item) => item.tool === "runCommand" && !item.result.success), true);
  assert.match(history.find((item) => item.tool === "writeFile")?.input ?? "", /<20000 chars>/);
  assert.ok((history.find((item) => item.tool === "writeFile")?.result.output.length ?? 0) <= 520);
});

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

test("replans when project context changes after an action", async () => {
  let plannerCalls = 0;
  let localPlans = 0;
  const runtime: AgentRuntime = {
    getAvailableTools: () => ["fake"],
    plan: () => {
      localPlans += 1;
      return { tool: "fake", input: "same" };
    },
    planWithAI: async () => {
      plannerCalls += 1;
      return { tool: "fake", input: "same" };
    },
    executeTool: async () => ({ success: true, output: "ok" }),
  };
  const result = await new AgentLoop(runtime, gateway, 3).run("repeat the same AI context");
  assert.equal(result.success, false);
  assert.equal(plannerCalls, 2);
  assert.equal(localPlans, 1);
});

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

test("creates structured Intent and execution plan for every Agent run", async () => {
  const agent = new NexumAgent(gateway);
  const runtime = fakeRuntime(
    (task, previousResults) => agent.plan(task, previousResults),
    async () => ({ success: true, output: "git status passed" }),
  );
  runtime.getAvailableTools = () => agent.getAvailableTools();
  const result = await new AgentLoop(runtime, gateway).run("Покажи статус Git");

  assert.equal(result.success, true);
  assert.equal(result.finalState, "COMPLETED");
  assert.equal(result.intent?.type, "analyze");
  assert.equal(result.intent?.objective, "Покажи статус Git");
  assert.ok(result.intent?.requestId);
  assert.ok(result.executionPlan?.planId);
  assert.equal(result.executionPlan?.taskId, result.intent?.taskId);
  assert.equal(result.validation?.passed, true);
  assert.equal(result.summary?.status, "COMPLETED");
});

test("does not accept model done without executed and validated evidence", async () => {
  const runtime: AgentRuntime = {
    getAvailableTools: () => ["fake"],
    plan: () => ({ tool: "", input: "", done: true, finalResponse: "Done" }),
    executeTool: async () => ({ success: true, output: "should never run" }),
  };
  const result = await new AgentLoop(runtime, gateway, 3).run("Анализируй задачу");

  assert.equal(result.success, false);
  assert.notEqual(result.finalState, "COMPLETED");
  assert.match(result.error ?? "", /actionable|implementation|validation|completion|plan|bounded repair/i);
});

test("central Agent state machine rejects terminal resurrection", async () => {
  const { transitionAgentState } = await import("./executionState.js");
  const { createAgentIntent } = await import("./intent.js");
  const intent = createAgentIntent("Проверить проект", { requestId: "r", projectId: "p", taskId: "t", agentJobId: "j" });
  const snapshot: any = {
    intent,
    state: "IDLE",
    plan: (await import("./executionState.js")).createExecutionPlan(intent),
    observations: [],
    completedStepIds: [],
    repairAttempts: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  assert.equal(transitionAgentState(snapshot, "UNDERSTANDING", () => undefined), true);
  assert.equal(transitionAgentState(snapshot, "PLANNING", () => undefined), true);
  assert.equal(transitionAgentState(snapshot, "FAILED", () => undefined), true);
  assert.equal(transitionAgentState(snapshot, "RUNNING" as any, () => undefined), false);
  assert.equal(snapshot.state, "FAILED");
});

test("completion gate requires validation, execution and consistent state", async () => {
  const { evaluateCompletionGate } = await import("./executionState.js");
  assert.equal(evaluateCompletionGate({
    hasPlan: true,
    hasExecuted: true,
    validationPassed: false,
    acceptanceCriteriaSatisfied: true,
    noCriticalErrors: true,
    projectStateConsistent: true,
  }).ok, false);
  assert.equal(evaluateCompletionGate({
    hasPlan: true,
    hasExecuted: true,
    validationPassed: true,
    acceptanceCriteriaSatisfied: true,
    noCriticalErrors: true,
    projectStateConsistent: true,
  }).ok, true);
});

test("returns a terminal CANCELLED result and never resurrects execution", async () => {
  const controller = new AbortController();
  controller.abort();
  const runtime = fakeRuntime(
    () => ({ tool: "fake", input: "x" }),
    async () => ({ success: true, output: "ok" }),
  );

  const result = await new AgentLoop(runtime, gateway, 3, undefined, undefined, undefined, {
    requestId: "req-cancel",
    agentRunId: "job-cancel",
    taskId: "task-cancel",
    projectId: "project-cancel",
  }).run("Отмени задачу", { signal: controller.signal });

  assert.equal(result.success, false);
  assert.equal(result.finalState, "CANCELLED");
  assert.equal(result.summary?.status, "CANCELLED");
  assert.equal(result.steps.length, 0);
});

test("stops when a tool returns an error", async () => {
  const result = await new AgentLoop(new NexumAgent(gateway), gateway).run(
    "Прочитай файл ../package.json",
  );

  assert.equal(result.success, false);
  assert.ok(result.iterations >= 1 && result.iterations <= 20);
  assert.match(result.error ?? "", /failed|project directory|maximum iterations|repeated action|bounded repair|loop/i);
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
  assert.match(result.error ?? "", /repeated.*action/i);
});

test("scaffold tool refuses non-empty projects", async () => {
  const { mkdtemp, readFile, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { ScaffoldProjectTool } = await import("./tools/scaffoldProject.js");
  const { ProjectWorkspace } = await import("./tools/workspace.js");

  const root = await mkdtemp(join(tmpdir(), "nexum-scaffold-"));
  await writeFile(join(root, "index.html"), "<h1>existing</h1>", "utf8");

  const tool = new ScaffoldProjectTool(new ProjectWorkspace(root));
  const result = await tool.execute("Создай новый сайт");
  assert.equal(result.success, false);
  assert.match(result.output, /Refused to scaffold a non-empty project/i);
  assert.equal(await readFile(join(root, "index.html"), "utf8"), "<h1>existing</h1>");
});

test("never scaffolds over an existing project during deterministic recovery", () => {
  const agent = new NexumAgent(gateway);
  const result = agent.plan("Создай заново сайт digital-агентства", [
    {
      iteration: 1,
      tool: "listFiles",
      input: ".",
      result: { success: true, output: "index.html\nstyle.css\napp.js" },
    },
  ]);

  assert.notEqual(result?.tool, "scaffoldProject");
  assert.equal(result?.tool, "readFile");
  assert.equal(result?.input, "index.html");
});

test("automatically installs and builds a generated React/Vite scaffold", async () => {
  const commands: string[] = [];
  const runtime: AgentRuntime = {
    getAvailableTools: () => ["scaffoldProject", "writeFile", "runCommand"],
    plan: (_task, previousResults) => {
      if (previousResults.length === 0) {
        return { tool: "scaffoldProject", input: "Создай React приложение" };
      }
      if (previousResults.some((item) => item.tool === "scaffoldProject") &&
          !previousResults.some((item) => item.tool === "writeFile" && item.input.includes("src/App.jsx"))) {
        return {
          tool: "writeFile",
          input: JSON.stringify({ path: "src/App.jsx", content: "implemented app" }),
        };
      }
      if (previousResults.some((item) => item.tool === "writeFile" && item.input.includes("src/App.jsx")) &&
          !previousResults.some((item) => item.tool === "writeFile" && item.input.includes("src/styles.css"))) {
        return {
          tool: "writeFile",
          input: JSON.stringify({ path: "src/styles.css", content: "implemented styles" }),
        };
      }
      return { tool: "", input: "", done: true, finalResponse: "Готово" };
    },
    executeTool: async (tool, input) => {
      if (tool === "scaffoldProject") {
        return { success: true, output: "React/Vite scaffold created for test. Run npm install and npm run build." };
      }
      if (tool === "writeFile") {
        return { success: true, output: "App.jsx implemented" };
      }
      commands.push(input);
      return { success: true, output: input === "npm install" ? "dependencies installed" : "vite build passed" };
    },
  };

  const result = await new AgentLoop(runtime, gateway).run("Создай React приложение");

  assert.equal(result.success, true);
  assert.deepEqual(commands, ["npm install", "npm run build", "npm run build", "npm run build"]);
  assert.deepEqual(result.steps.map((step) => step.tool), [
    "scaffoldProject",
    "runCommand",
    "runCommand",
    "writeFile",
    "runCommand",
    "writeFile",
    "runCommand",
  ]);
  assert.equal(result.steps.every((step) => step.success), true);
});

test("recovers from a failed build after a file fix", async () => {
  const commands: string[] = [];
  let buildAttempts = 0;
  const runtime: AgentRuntime = {
    getAvailableTools: () => ["listFiles", "readFile", "writeFile", "runCommand"],
    plan: (_task, previousResults) => {
      if (previousResults.length === 0) return { tool: "listFiles", input: "." };
      if (previousResults.some((item) => item.tool === "listFiles") && !previousResults.some((item) => item.tool === "readFile")) {
        return { tool: "readFile", input: "package.json" };
      }
      if (previousResults.some((item) => item.tool === "readFile") && !previousResults.some((item) => item.tool === "writeFile")) {
        return { tool: "writeFile", input: JSON.stringify({ path: "src/App.jsx", content: "broken" }) };
      }
      if (previousResults.some((item) => item.tool === "runCommand" && item.input === "npm run build" && !item.result.success) &&
          !previousResults.some((item) => item.tool === "writeFile" && item.input.includes('"content":"fixed"'))) {
        return { tool: "writeFile", input: JSON.stringify({ path: "src/App.jsx", content: "fixed" }) };
      }
      return { tool: "", input: "", done: true, finalResponse: "Готово" };
    },
    executeTool: async (tool, input) => {
      if (tool === "listFiles") return { success: true, output: "package.json\nsrc/App.jsx" };
      if (tool === "readFile") return { success: true, output: JSON.stringify({ scripts: { build: "vite build" } }) };
      if (tool === "writeFile") return { success: true, output: input.includes('"content":"fixed"') ? "fixed App.jsx" : "initial App.jsx" };
      commands.push(input);
      if (input === "npm install") return { success: true, output: "installed" };
      buildAttempts += 1;
      return buildAttempts === 1
        ? { success: false, output: "vite compilation error" }
        : { success: true, output: "vite build passed" };
    },
  };

  const result = await new AgentLoop(runtime, gateway).run("Создай React приложение");

  assert.equal(result.success, true);
  assert.equal(commands.filter((command) => command === "npm run build").length, 2);
  assert.ok(result.steps.some((step) => step.tool === "writeFile" && step.input.includes('"content":"fixed"')));
});



test("empty Builder project selects scaffold after initial inspection", () => {
  const agent = new NexumAgent(gateway);
  const result = agent.plan("Создай сайт автосервиса", [
    {
      iteration: 1,
      tool: "listFiles",
      input: ".",
      result: { success: true, output: "" },
    },
  ]);

  assert.equal(result?.tool, "scaffoldProject");
  assert.equal(result?.input, "Создай сайт автосервиса");
});

test("Builder refreshes the project tree after successful scaffold", () => {
  const agent = new NexumAgent(gateway);
  const result = agent.plan("Создай сайт автосервиса", [
    {
      iteration: 1,
      tool: "listFiles",
      input: ".",
      result: { success: true, output: "" },
    },
    {
      iteration: 2,
      tool: "scaffoldProject",
      input: "Создай сайт автосервиса",
      result: { success: true, output: "React/Vite scaffold created" },
    },
  ]);

  assert.equal(result?.tool, "listFiles");
  assert.equal(result?.input, ".");
});

test("Builder reads the newly scaffolded entry file before implementation", () => {
  const agent = new NexumAgent(gateway);
  const result = agent.plan("Создай сайт автосервиса", [
    {
      iteration: 1,
      tool: "listFiles",
      input: ".",
      result: { success: true, output: "" },
    },
    {
      iteration: 2,
      tool: "scaffoldProject",
      input: "Создай сайт автосервиса",
      result: { success: true, output: "React/Vite scaffold created" },
    },
    {
      iteration: 3,
      tool: "listFiles",
      input: ".",
      result: { success: true, output: "package.json\nsrc/App.tsx\nsrc/main.tsx" },
    },
  ]);

  assert.equal(result?.tool, "readFile");
  assert.equal(result?.input, "package.json");
});

test("locks auto-repair requests to the automotive domain", async () => {
  const plannerGateway = new AIGateway([new ProductPlanProvider()]);
  const agent = new NexumAgent(plannerGateway);
  const plan = await agent.createProductPlan("Сделай сайт по ремонту авто", []);
  assert.equal(plan.productType, "Auto repair service website");
  assert.deepEqual(plan.pages, ["Главная", "Услуги", "Диагностика", "Цены", "Отзывы", "Контакты"]);
  assert.ok(plan.acceptanceCriteria.some((item) => /auto repair/i.test(item)));
  assert.ok(plan.acceptanceCriteria.every((item) => !/construction|строитель/i.test(item)));
});

test("does not let an automotive request accept a construction write plan", () => {
  const agent = new NexumAgent(gateway);
  const aligned = (agent as any).isPlanAlignedWithTask("Сделай сайт по ремонту авто", {
    tool: "writeFile",
    input: JSON.stringify({
      path: "src/App.tsx",
      content: "СТРОИТЕЛЬНАЯ КОМПАНИЯ. Демонтаж, фасадные работы, объекты.",
    }),
  });
  const rejected = (agent as any).isPlanAlignedWithTask("Сделай сайт по ремонту авто", {
    tool: "writeFile",
    input: JSON.stringify({
      path: "src/App.tsx",
      content: "Автосервис. Диагностика автомобиля, ремонт двигателя, запись на обслуживание.",
    }),
  });
  assert.equal(aligned, false);
  assert.equal(rejected, true);
});


test("does not get stuck on repeated searchFiles during Builder recovery", async () => {
  let writes = 0;
  const runtime: AgentRuntime = {
    getAvailableTools: () => ["listFiles", "searchFiles", "readFile", "writeFile", "testProject"],
    plan: (_task, previousResults) => {
      if (previousResults.length === 0) return { tool: "listFiles", input: "." };
      if (!previousResults.some((item) => item.tool === "readFile" && item.result.success)) {
        return { tool: "searchFiles", input: "ремонт авто" };
      }
      if (writes < 1) return { tool: "writeFile", input: JSON.stringify({ path: "src/App.tsx", content: "Автосервис. Диагностика и ремонт двигателя." }) };
      if (writes < 2) return { tool: "writeFile", input: JSON.stringify({ path: "src/App.css", content: ".auto-service-site{}" }) };
      return { tool: "", input: "", done: true, finalResponse: "Готово" };
    },
    executeTool: async (tool, input) => {
      if (tool === "listFiles") return { success: true, output: "src/App.tsx\nsrc/App.css\npackage.json" };
      if (tool === "searchFiles") return { success: true, output: "no useful match" };
      if (tool === "readFile") return { success: true, output: "existing app" };
      if (tool === "writeFile") { writes += 1; return { success: true, output: "written" }; }
      return { success: true, output: "tests passed" };
    },
  };
  const result = await new AgentLoop(runtime, gateway, 8).run("Сделай сайт автосервиса с диагностикой и ремонтом двигателя");
  assert.equal(result.success, true);
  assert.equal(writes, 2);
  assert.equal(result.steps.some((step) => step.tool === "searchFiles"), true);
});

test("does not finish an automotive site when generated content is construction-only", async () => {
  let domainValidationSeen = false;
  const runtime: AgentRuntime = {
    getAvailableTools: () => ["writeFile", "testProject"],
    plan: (_task, previousResults) => {
      if (previousResults.length === 0) {
        return {
          tool: "writeFile",
          input: JSON.stringify({
            path: "src/App.tsx",
            content: "Строительная компания. Демонтаж, фасад, стяжка и подрядные работы.",
          }),
        };
      }
      if (previousResults.some((item) => item.tool === "domainValidation" && !item.result.success)) {
        domainValidationSeen = true;
        const repaired = previousResults.some(
          (item) => item.tool === "writeFile" && item.result.success && /Автосервис\. Диагностика автомобиля/i.test(item.input),
        );
        if (!repaired) {
          return {
            tool: "writeFile",
            input: JSON.stringify({
              path: "src/App.tsx",
              content: "Автосервис. Диагностика автомобиля, ремонт двигателя, тормозы и запись.",
            }),
          };
        }
      }
      return { tool: "", input: "", done: true, finalResponse: "Готово" };
    },
    executeTool: async (tool, input) => {
      if (tool === "writeFile") return { success: true, output: input };
      return { success: true, output: "tests passed" };
    },
  };

  const result = await new AgentLoop(runtime, gateway).run("Сделай сайт по ремонту авто");
  assert.equal(domainValidationSeen, true);
  assert.equal(result.success, true);
});

test("detects alternating failing tool loops", async () => {
  let calls = 0;
  const runtime: AgentRuntime = {
    getAvailableTools: () => ["a", "b"],
    plan: (_task, previousResults) => ({ tool: previousResults.length % 2 === 0 ? "a" : "b", input: "same" }),
    executeTool: async () => { calls += 1; return { success: false, output: "transient tool failure" }; },
  };
  const result = await new AgentLoop(runtime, gateway, 8).run("alternate tools");
  assert.equal(result.success, false);
  assert.equal(result.finalState, "FAILED");
  assert.equal(result.error, "LOOP_DETECTED");
  assert.equal(calls, 4);
});

test("cancellation returns the last canonical execution snapshot", async () => {
  const controller = new AbortController();
  let callbackSnapshot: any;
  const runtime: AgentRuntime = {
    getAvailableTools: () => ["fake"],
    plan: () => ({ tool: "fake", input: "x" }),
    executeTool: async (_tool, _input, signal) => {
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
      return { success: true, output: "completed" };
    },
  };
  const promise = new AgentLoop(runtime, gateway, 8, undefined, undefined, undefined, {
    requestId: "req-cancel-snapshot",
    agentRunId: "job-cancel-snapshot",
    taskId: "task-cancel-snapshot",
    projectId: "project-cancel-snapshot",
  }, snapshot => { callbackSnapshot = snapshot; }).run("cancel during action", { signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 10));
  controller.abort();
  const result = await promise;
  assert.equal(result.finalState, "CANCELLED");
  assert.equal(result.executionPlan?.planId, callbackSnapshot?.plan.planId);
  assert.deepEqual(result.intent?.projectId, "project-cancel-snapshot");
});


test("Builder cannot complete until runtime preview validation passes after the latest change", async () => {
  let writes = 0;
  let runtimeChecks = 0;
  const runtime: AgentRuntime = {
    getAvailableTools: () => ["listFiles", "writeFile", "validateProject", "testProject"],
    plan: (_task, previousResults) => {
      if (previousResults.length === 0) return { tool: "listFiles", input: "." };

      const runtimeFailure = previousResults.some(
        (item) => item.tool === "runtimeValidation" && !item.result.success,
      );

      if (runtimeFailure && writes < 3) {
        return {
          tool: "writeFile",
          input: JSON.stringify({
            path: "index.html",
            content: "<!doctype html><html><body><main>Автосервис — диагностика и ремонт автомобилей.</main></body></html>",
          }),
        };
      }

      if (writes === 0) {
        return {
          tool: "writeFile",
          input: JSON.stringify({
            path: "index.html",
            content: "<!doctype html><html><body><main>Автосервис — диагностика автомобилей.</main></body></html>",
          }),
        };
      }

      if (writes === 1) {
        return {
          tool: "writeFile",
          input: JSON.stringify({
            path: "style.css",
            content: "body { font-family: system-ui; } main { max-width: 900px; margin: auto; }",
          }),
        };
      }

      return { tool: "", input: "", done: true, finalResponse: "Готово" };
    },
    executeTool: async (tool, input) => {
      if (tool === "listFiles") {
        return { success: true, output: "index.html\nstyle.css" };
      }
      if (tool === "writeFile") {
        writes += 1;
        return { success: true, output: "written" };
      }
      if (tool === "validateProject") {
        return { success: true, output: "Static validation passed." };
      }
      if (tool === "testProject") {
        return { success: true, output: "Static smoke test passed." };
      }
      return { success: true, output: "unexpected" };
    },
    validateRuntime: async () => {
      runtimeChecks += 1;
      if (runtimeChecks === 1) {
        return {
          success: false,
          output: "Preview HTTP 503",
          error: {
            code: "RUNTIME_ERROR",
            message: "Preview is unavailable.",
            retryable: true,
            repairable: true,
            fatal: false,
          },
        };
      }
      return { success: true, output: "Preview HTTP 200; HTML document received." };
    },
  };

  const result = await new AgentLoop(runtime, gateway, 10).run(
    "Сделай сайт автосервиса с диагностикой и ремонтом автомобилей",
  );

  assert.equal(result.success, true);
  assert.ok(runtimeChecks >= 2);
  assert.ok(writes >= 3);
  assert.ok(result.steps.some((step) => step.tool === "runtimeValidation" && step.success));
});
