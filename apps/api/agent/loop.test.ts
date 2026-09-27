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
  assert.ok(result.iterations >= 1 && result.iterations <= 20);
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
