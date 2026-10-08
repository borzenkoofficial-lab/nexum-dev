import type { AIProvider, AIProviderStatus } from "../types.js";

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

    if (/You are the NEXUM product planner/i.test(message)) {
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

    const history = message.split(/Previous tool results:\s*/i).pop() ?? "";
    const userTask = message.match(/User task:\s*([^\n]*)/i)?.[1]?.trim() ?? "";
    const projectKey = message.match(/ID проекта:\s*([^\n]*)/i)?.[1]?.trim() ?? userTask;
    const isBuilderTask = /создай|сделай|разработай|build|create|make|сайт|приложени|лендинг|dashboard|landing|web app|website|marketplace|crm/i.test(userTask);

    if (/You are the NEXUM\.DEV autonomous project builder/i.test(message)) {
      // E2E Builder mode is deterministic by project, not by a fragile six-item
      // history window. The implementation itself is still real: all file writes,
      // dependency installation, build and project tests go through AgentLoop.
      const hasTool = (name: string) => new RegExp("\\b" + name + ":\\s", "i").test(history);
      const builderProgress = /writeFile:\s*.*src\/App\.jsx/i.test(history) ? 1 : 0;
      const styleProgress = /writeFile:\s*.*src\/styles\.css/i.test(history) ? 1 : 0;
      if (isBuilderTask) {
        if (!hasTool("scaffoldProject") && /readFile:\s*index\.html/i.test(history)) {
          return JSON.stringify({ tool: "scaffoldProject", input: "Сделай React/Vite сайт автосервиса с диагностикой и ремонтом автомобилей" });
        }
        if (!builderProgress) {
          return JSON.stringify({
            tool: "writeFile",
            input: JSON.stringify({
              path: "src/App.jsx",
              content: "export default function App(){return <main><h1>Диагностика и ремонт автомобилей</h1><p>Автосервис полного цикла.</p><button>Записаться на диагностику</button></main>}",
            }),
          });
        }
        if (!styleProgress) {
          return JSON.stringify({
            tool: "writeFile",
            input: JSON.stringify({
              path: "src/styles.css",
              content: "html,body,#root{min-height:100%;margin:0}body{font-family:system-ui,sans-serif;background:#101010;color:#fff}main{min-height:100vh;padding:48px;box-sizing:border-box}h1{font-size:64px}",
            }),
          });
        }
        if (!hasTool("testProject")) {
          return JSON.stringify({ tool: "testProject", input: "." });
        }
        return JSON.stringify({ done: true, finalResponse: "Сайт автосервиса создан, собран и проверен в Preview." });
      }
    }

    if (/previous response was not valid nexum tool-plan json/i.test(message)) {
      return JSON.stringify({ tool: "listFiles", input: "." });
    }

    // Keep generic E2E tasks executable as well: perform one real observation,
    // then finish only after that observation succeeded. A failure is replayed
    // so AgentLoop can exercise its bounded repair/loop detection path.
    const genericHistory = message.split(/Previous tool results:\s*/i).pop() ?? "";
    const lastListFiles = [...genericHistory.matchAll(/listFiles:\s*([^\n]*)/gi)].pop()?.[1]?.trim() ?? "";
    if (!lastListFiles || /failure|error|unable|not found|failed/i.test(lastListFiles)) {
      return JSON.stringify({ tool: "listFiles", input: "." });
    }
    return JSON.stringify({ done: true, finalResponse: "Проверка завершена после выполнения и наблюдения." });
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
