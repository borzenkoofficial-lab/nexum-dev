import type { AIGateway } from "./gateway.js";
import type { AIModelCapabilities, AIModelCapabilityKey, AIModelCatalogEntry } from "./types.js";

export type AIModelRequirement = Partial<Record<AIModelCapabilityKey, boolean>>;

export interface RegisteredAIModel {
  provider: string;
  model: string;
  capabilities: AIModelCapabilities;
  verified: boolean;
  source: AIModelCatalogEntry["source"];
  status: AIModelCatalogEntry["status"];
  errorCode?: AIModelCatalogEntry["errorCode"];
}

export class AIModelRegistry {
  constructor(private readonly gateway: AIGateway) {}

  async list(providerId?: string, signal?: AbortSignal): Promise<RegisteredAIModel[]> {
    const catalog = await this.gateway.getModelCatalog(signal);
    const entries = catalog.providers.filter((entry) => !providerId || entry.provider === providerId);
    return entries.flatMap((entry) => entry.models.map((model) => ({
      provider: entry.provider,
      model,
      capabilities: this.gateway.getCapabilities(entry.provider, model),
      verified: entry.verified,
      source: entry.source,
      status: entry.status,
      ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
    })));
  }

  async select(
    requirement: AIModelRequirement,
    options: { provider?: string; model?: string } = {},
    signal?: AbortSignal,
  ): Promise<RegisteredAIModel | null> {
    const providerId = options.model
      ? options.provider ?? this.gateway.getDefaultProviderId()
      : options.provider;
    const models = await this.list(providerId, signal);
    const candidate = options.model
      ? models.find((item) => item.model === options.model && item.verified)
      : models.find((item) => item.verified && this.matches(item.capabilities, requirement));
    if (!candidate || !this.matches(candidate.capabilities, requirement)) return null;
    return candidate;
  }

  private matches(capabilities: AIModelCapabilities, requirement: AIModelRequirement): boolean {
    return Object.entries(requirement).every(([key, expected]) =>
      expected === undefined || capabilities[key as keyof AIModelCapabilities] === expected,
    );
  }
}
