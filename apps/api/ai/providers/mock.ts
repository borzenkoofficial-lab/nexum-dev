import type { AIProvider, AIProviderStatus } from "../types.js";

export class MockProvider implements AIProvider {
  id = "mock";
  name = "NEXUM Mock Provider";
  model = "mock-v1";

  async generate(message: string): Promise<string> {
    return `NEXUM AI: ${message}`;
  }

  async listModels(): Promise<string[]> {
    return [this.model];
  }

  async getStatus(model = this.model): Promise<AIProviderStatus> {
    return { available: true, model, latencyMs: 0 };
  }
}
