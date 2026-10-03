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
    // Test-only deterministic responses. This provider is never registered
    // unless NEXUM_E2E_MOCK_AI=true and NODE_ENV=test.
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
      // The first model action performs real project inspection. After that,
      // the canonical AgentLoop completion/validation path takes over.
      return /(?:Previous tool results|listFiles:)/i.test(message)
        ? JSON.stringify({ done: true, finalResponse: "Проверка завершена." })
        : JSON.stringify({ tool: "listFiles", input: "." });
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
      available: true,
      model,
      latencyMs: 0,
    };
  }
}
