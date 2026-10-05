import type { AIProvider, AIProviderStatus } from "../types.js";

export class MockProvider implements AIProvider {
  id = "mock";
  name = "NEXUM E2E Mock";
  model = "e2e-v1";
  capabilities = {
    text: true,
    code: false,
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

    if (/You are the NEXUM\.DEV autonomous project builder/i.test(message)) {
      // E2E Builder mode supplies deterministic implementation actions only.
      // Production AgentLoop, filesystem tools, build, tests and Preview remain real.
      const writeCount = (message.match(/writeFile:/gi) ?? []).length;
      if (/readFile:\s*index\.html/i.test(message) && !/scaffoldProject:/i.test(message) && writeCount === 0) {
        return JSON.stringify({ tool: "scaffoldProject", input: "Сделай сайт автосервиса с диагностикой и ремонтом автомобилей" });
      }
      if (/scaffoldProject:/i.test(message) && writeCount === 0) {
        return JSON.stringify({
          tool: "writeFile",
          input: {
            path: "src/App.jsx",
            content: "export default function App(){return <main><h1>Диагностика и ремонт автомобилей</h1><p>Автосервис полного цикла.</p><button>Записаться на диагностику</button></main>}",
          },
        });
      }
      if (writeCount === 1) {
        return JSON.stringify({
          tool: "writeFile",
          input: {
            path: "src/styles.css",
            content: "html,body,#root{min-height:100%;margin:0}body{font-family:system-ui,sans-serif;background:#101010;color:#fff}main{min-height:100vh;padding:48px;box-sizing:border-box}h1{font-size:64px}",
          },
        });
      }
      if (writeCount >= 2) return JSON.stringify({ done: true, finalResponse: "Сайт автосервиса создан, собран и проверен в Preview." });
      return JSON.stringify({ tool: "listFiles", input: "." });
    }

    if (/previous response was not valid nexum tool-plan json/i.test(message)) {
      return JSON.stringify({ tool: "listFiles", input: "." });
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
