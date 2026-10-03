import type { AIGateway } from "./gateway.js";
import type { AIModelCapabilities } from "./types.js";

export type AIModelRequirement = Partial<Pick<AIModelCapabilities,
  "text" | "code" | "vision" | "toolCalling" | "streaming" | "structuredOutput" | "reasoning"
>>;

export interface RegisteredAIModel {
  provider: string;
  model: string;
  capabilities: AIModelCapabilities;
}

export class AIModelRegistry {
  constructor(private readonly gateway: AIGateway) {}

  async list(providerId?: string, signal?: AbortSignal): Promise<RegisteredAIModel[]> {
    const providers = this.gateway.getProviders().filter((provider) => !providerId || provider.id === providerId);
    const models = await this.gateway.getModels(signal);
    const result: RegisteredAIModel[] = [];
    for (const provider of providers) {
      const providerModels = models[provider.id];
      const candidates: string[] = providerModels && providerModels.length > 0 ? providerModels : [provider.model];
      for (const model of candidates) {
        result.push({ provider: provider.id, model, capabilities: this.gateway.getCapabilities(provider.id, model) });
      }
    }
    return result;
  }

  async select(requirement: AIModelRequirement, options: { provider?: string; model?: string } = {}, signal?: AbortSignal): Promise<RegisteredAIModel | null> {
    if (options.model) {
      const provider = options.provider ?? this.gateway.getDefaultProviderId();
      const capabilities = this.gateway.getCapabilities(provider, options.model);
      return this.matches(capabilities, requirement) ? { provider, model: options.model, capabilities } : null;
    }
    const models = await this.list(options.provider, signal);
    return models.find((candidate) => this.matches(candidate.capabilities, requirement)) ?? null;
  }

  private matches(capabilities: AIModelCapabilities, requirement: AIModelRequirement): boolean {
    return Object.entries(requirement).every(([key, expected]) =>
      expected === undefined || capabilities[key as keyof AIModelCapabilities] === expected,
    );
  }
}
