import type { AIProvider, AIProviderStatus } from "./types.js";

export interface GatewayGenerateOptions {
  provider?: string;
  model?: string;
}

export interface GatewayProviderInfo {
  id: string;
  name: string;
  model: string;
  isDefault: boolean;
}

export class AIGateway {
  private readonly providers: Map<string, AIProvider>;
  private readonly defaultProviderId: string;

  constructor(providers: AIProvider[], defaultProviderId = providers[0]?.id) {
    if (providers.length === 0) {
      throw new Error("AI Gateway requires at least one provider");
    }

    if (!defaultProviderId || !providers.some((provider) => provider.id === defaultProviderId)) {
      throw new Error(`Unknown default AI provider: ${defaultProviderId ?? "undefined"}`);
    }

    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
    this.defaultProviderId = defaultProviderId;
  }

  async generate(message: string, options: GatewayGenerateOptions | string = {}): Promise<string> {
    const normalizedOptions = typeof options === "string" ? { provider: options } : options;
    const providerId = normalizedOptions.provider ?? this.defaultProviderId;
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new Error(`Unknown AI provider: ${providerId}`);
    }

    return provider.generate(message, normalizedOptions.model);
  }

  getProviders(): GatewayProviderInfo[] {
    return [...this.providers.values()].map((provider) => ({
      id: provider.id,
      name: provider.name,
      model: provider.model,
      isDefault: provider.id === this.defaultProviderId,
    }));
  }

  async getModels(): Promise<Record<string, string[]>> {
    const models: Record<string, string[]> = {};

    for (const provider of this.providers.values()) {
      try {
        models[provider.id] = provider.listModels
          ? await provider.listModels()
          : [provider.model];
      } catch {
        models[provider.id] = [provider.model];
      }
    }

    return models;
  }

  async getStatus(providerId = this.defaultProviderId, model?: string): Promise<AIProviderStatus & { provider: string }> {
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const status = provider.getStatus
      ? await provider.getStatus(model)
      : { available: true, model: model ?? provider.model, latencyMs: 0 };
    return { provider: provider.id, ...status };
  }
}
