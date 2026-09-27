import type { AIProvider, AIProviderStatus } from "./types.js";

export interface GatewayGenerateOptions {
  provider?: string;
  model?: string;
  fallback?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export interface GatewayProviderInfo {
  id: string;
  name: string;
  model: string;
  isDefault: boolean;
}

export interface GatewayFallbackEvent {
  fromProvider: string;
  fromModel: string;
  toProvider: string;
  toModel: string;
  reason: string;
  timestamp: number;
}

export class AIGateway {
  private readonly providers: Map<string, AIProvider>;
  private readonly defaultProviderId: string;
  private readonly fallbackProviderId?: string;
  private readonly onFallback?: (event: GatewayFallbackEvent) => void;

  constructor(
    providers: AIProvider[],
    defaultProviderId = providers[0]?.id,
    options: {
      fallbackProviderId?: string;
      onFallback?: (event: GatewayFallbackEvent) => void;
    } = {},
  ) {
    if (providers.length === 0) {
      throw new Error("AI Gateway requires at least one provider");
    }

    if (!defaultProviderId || !providers.some((provider) => provider.id === defaultProviderId)) {
      throw new Error(`Unknown default AI provider: ${defaultProviderId ?? "undefined"}`);
    }

    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
    this.defaultProviderId = defaultProviderId;
    this.fallbackProviderId = options.fallbackProviderId && this.providers.has(options.fallbackProviderId)
      ? options.fallbackProviderId
      : undefined;
    this.onFallback = options.onFallback;
  }

  setRuntimeOpenAIKey(apiKey: string): void {
    const provider = this.providers.get("openai");
    if (!provider || typeof (provider as { setRuntimeApiKey?: (key: string) => void }).setRuntimeApiKey !== "function") {
      throw new Error("OpenAI provider is unavailable");
    }
    (provider as unknown as { setRuntimeApiKey: (key: string) => void }).setRuntimeApiKey(apiKey);
  }

  hasOpenAIKey(): boolean {
    const provider = this.providers.get("openai");
    return Boolean(provider && typeof (provider as { hasApiKey?: () => boolean }).hasApiKey === "function" && (provider as unknown as { hasApiKey: () => boolean }).hasApiKey());
  }

  setRuntimeOrcaRouterKey(apiKey: string): void {
    const provider = this.providers.get("orcarouter");
    if (!provider || typeof (provider as { setRuntimeApiKey?: (key: string) => void }).setRuntimeApiKey !== "function") {
      throw new Error("OrcaRouter provider is unavailable");
    }
    (provider as unknown as { setRuntimeApiKey: (key: string) => void }).setRuntimeApiKey(apiKey);
  }

  hasOrcaRouterKey(): boolean {
    const provider = this.providers.get("orcarouter");
    return Boolean(provider && typeof (provider as { hasApiKey?: () => boolean }).hasApiKey === "function" && (provider as unknown as { hasApiKey: () => boolean }).hasApiKey());
  }

  setRuntimeOpenRouterKey(apiKey: string): void {
    const provider = this.providers.get("openrouter");
    if (!provider || typeof (provider as { setRuntimeApiKey?: (key: string) => void }).setRuntimeApiKey !== "function") {
      throw new Error("OpenRouter provider is unavailable");
    }
    (provider as unknown as { setRuntimeApiKey: (key: string) => void }).setRuntimeApiKey(apiKey);
  }

  hasOpenRouterKey(): boolean {
    const provider = this.providers.get("openrouter");
    return Boolean(provider && typeof (provider as { hasApiKey?: () => boolean }).hasApiKey === "function" && (provider as unknown as { hasApiKey: () => boolean }).hasApiKey());
  }

  getDefaultModel(providerId = this.defaultProviderId): string {
    return this.providers.get(providerId)?.model ?? this.providers.get(this.defaultProviderId)!.model;
  }

  async generate(message: string, options: GatewayGenerateOptions | string = {}): Promise<string> {
    const normalizedOptions = typeof options === "string" ? { provider: options } : options;
    const providerId = normalizedOptions.provider ?? this.defaultProviderId;
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new Error(`Unknown AI provider: ${providerId}`);
    }

    const localizedMessage = [
      "LANGUAGE PROTOCOL: Russian is the default user language. Understand Russian naturally. Reply in Russian unless the user explicitly requests another language. Preserve code, JSON keys, tool names, API identifiers, file paths and commands exactly.",
      message,
    ].join("\n");

    try {
      return await provider.generate(localizedMessage, normalizedOptions.model, {
        ...(normalizedOptions.maxTokens === undefined ? {} : { maxTokens: normalizedOptions.maxTokens }),
        ...(normalizedOptions.temperature === undefined ? {} : { temperature: normalizedOptions.temperature }),
      });
    } catch (error) {
      const fallbackId = this.fallbackProviderId;
      if (normalizedOptions.fallback === false || !fallbackId || fallbackId === provider.id) {
        throw error;
      }

      const fallback = this.providers.get(fallbackId);
      if (!fallback) throw error;

      const reason = error instanceof Error ? error.message : "AI provider request failed";
      const event: GatewayFallbackEvent = {
        fromProvider: provider.id,
        fromModel: normalizedOptions.model ?? provider.model,
        toProvider: fallback.id,
        toModel: fallback.model,
        reason,
        timestamp: Date.now(),
      };
      this.onFallback?.(event);

      return fallback.generate(localizedMessage, fallback.model, {
        ...(normalizedOptions.maxTokens === undefined ? {} : { maxTokens: normalizedOptions.maxTokens }),
        ...(normalizedOptions.temperature === undefined ? {} : { temperature: normalizedOptions.temperature }),
      });
    }
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
