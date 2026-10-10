import type { AIProvider, AIProviderStatus } from "../types.js";

type BuilderStage = "read" | "scaffold" | "app" | "style" | "test" | "done";

const builderStages = new Map<string, BuilderStage>();

export class MockProvider implements AIProvider {
  id = "mock";
  name = "NEXUM E2E Mock";
  model = "e2e-v1";
  capabilities = {
    text: true,
    code: true,
    vision: false,
    toolCalling: false,
    streaming: false,
    structuredOutput: true,
    reasoning: false,
    contextWindow: 32_000,
  } as const;

  async generate(message: string): Promise<string> {
    // Preserve the lightweight mock semantics used by unit tests. The richer
    // deterministic planner is enabled only by the E2E-only environment flag.
    if (process.env.NEXUM_E2E_MOCK_AI !== "true") return `NEXUM Demo: ${message}`;

    if (/Turn the user's request into a concrete implementation plan for a coding agent/i.test(message)) {
      return JSON.stringify({
        goal: "Проверить и выполнить запрос пользователя в тестовом окружении NEXUM.",
        productType: "E2E validation task",
        targetUser: "NEXUM E2E",
        pages: ["workspace"],
        components: ["workspace", "agent activity"],
        visualSystem: ["NEXUM test runtime"],
        interactions: ["submit task", "cancel task"],
        dataModel: ["agent job", "runtime task"],
        filesToInspect: [],
        filesToChange: [],
        acceptanceCriteria: ["Agent task reaches a terminal state", "Runtime ownership is released"],
      });
    }

    if (/You are the NEXUM final implementation reviewer/i.test(message)) {
      return JSON.stringify({ passed: true, missing: [], risks: [] });
    }

    // Builder E2E state is tracked per active project instead of being inferred from
    // compacted tool history. The latter is intentionally lossy and must never be the
    // source of truth for an acceptance workflow.
    const userTask = message.match(/User (?:task|request):\s*([^\n]*)/i)?.[1]?.trim() ?? "";
    const isBuilderTask = /создай|сделай|разработай|build|create|make|сайт|приложени|лендинг|dashboard|landing|web app|website|marketplace|crm/i.test(userTask) || /автосервис|автомобил|диагностик.*авто|ремонт.*авто/i.test(message);

    if (/You are the NEXUM\.DEV autonomous project builder|previous response was not valid nexum tool-plan json/i.test(message)) {
      if (isBuilderTask) {
        const projectKey = message.match(/(?:ID проекта|projectId)\s*[:=]\s*([A-Za-z0-9_-]+)/i)?.[1] ?? userTask;
        const current = builderStages.get(projectKey) ?? "read";

        switch (current) {
          case "read":
            builderStages.set(projectKey, "scaffold");
            return JSON.stringify({ tool: "readFile", input: "index.html" });
          case "scaffold":
            builderStages.set(projectKey, "app");
            return JSON.stringify({ tool: "scaffoldProject", input: "Сделай React/Vite сайт автосервиса с диагностикой и ремонтом автомобилей" });
          case "app":
            builderStages.set(projectKey, "style");
            return JSON.stringify({
              tool: "writeFile",
              input: {
                path: "src/App.jsx",
                content: "export default function App(){return <main><h1>Диагностика и ремонт автомобилей</h1><p>Автосервис полного цикла.</p><button>Записаться на диагностику</button></main>}",
              },
            });
          case "style":
            builderStages.set(projectKey, "test");
            return JSON.stringify({
              tool: "writeFile",
              input: {
                path: "src/styles.css",
                content: "html,body,#root{min-height:100%;margin:0}body{font-family:system-ui,sans-serif;background:#101010;color:#fff}main{min-height:100vh;padding:48px;box-sizing:border-box}h1{font-size:64px}",
              },
            });
          case "test":
            builderStages.set(projectKey, "done");
            return JSON.stringify({ tool: "testProject", input: "." });
          case "done":
            return JSON.stringify({ done: true, finalResponse: "Сайт автосервиса создан, собран и проверен в Preview." });
        }
      }

      // Non-builder tasks continue into the shared tool-history handler below.
    }

    // Non-builder E2E tasks must execute at least one real tool action before
    // proposing completion. This keeps the mock aligned with the Completion Gate
    // and lets failure-injection tests exercise retries and cancellation.
    const history = message.split(/Previous tool results:\s*/i)[1] ?? "";
    if (/No tools have run yet\./i.test(history)) {
      return JSON.stringify({ tool: "listFiles", input: "." });
    }

    const lastHistoryLine = history.trim().split("\n").at(-1) ?? "";
    if (/^listFiles:/i.test(lastHistoryLine) && /injected|failure|error|ошиб/i.test(lastHistoryLine)) {
      return JSON.stringify({ tool: "readFile", input: "index.html" });
    }

    return JSON.stringify({ done: true, finalResponse: "Проверка завершена." });
  }

  async listModels(): Promise<string[]> {
    return [this.model];
  }

  async getStatus(model = this.model): Promise<AIProviderStatus> {
    return {
      available: process.env.NEXUM_E2E_MOCK_AI === "true",
      model,
      latencyMs: process.env.NEXUM_E2E_MOCK_AI === "true" ? 0 : null,
      ...(process.env.NEXUM_E2E_MOCK_AI === "true" ? {} : { error: "Demo provider is not a real AI model" }),
    };
  }
}
