import type { AIProvider, AIProviderStatus } from "../types.js";

export class MockProvider implements AIProvider {
  id = "mock";
  name = "NEXUM Demo";
  model = "demo-v1";
  capabilities = { text: true, code: false, vision: false, toolCalling: false, streaming: false, structuredOutput: false, reasoning: false, contextWindow: null } as const;

  async generate(message: string): Promise<string> {
    return `NEXUM Demo: ${message}`;
  }

  async listModels(): Promise<string[]> {
    return [this.model];
  }

  async getStatus(model = this.model): Promise<AIProviderStatus> {
    return {
      available: false,
      model,
      latencyMs: null,
      error: "Demo provider is not a real AI model",
    };
  }
}
