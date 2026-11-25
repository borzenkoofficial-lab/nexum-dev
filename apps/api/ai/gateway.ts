import type { AIProvider, AIProviderStatus, AIModelCapabilities, AIRequest, AIResponse, AIGenerateOptions, AIModelCatalogEntry } from "./types.js";
import { getRequiredCapabilities, normalizeAIResponse, validateCanonicalRequest } from "./canonical.js";
import { generateWithLegacyProvider } from "./legacyProviderAdapter.js";
import { NexumError } from "../core/errors.js";
import { classifyAIError } from "../core/errors.js";
import { agentFailureInjection } from "../agent/failureInjection.js";

function redactProviderError(message: string): string {
  return message
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|rk|or|ak)-[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED]")
    .replace(/((?:api[_-]?key|authorization)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

export interface GatewayGenerateOptions {
  provider?: string;
  model?: string;
  fallback?: boolean;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  onTextDelta?: (delta: string) => void;
}

export interface GatewayProviderInfo {
  id: string;
  name: string;
  model: string;
  isDefault: boolean;
  protocol?: string;
  legacyProtocol?: string;
  adapterVersion?: string;
  adapterMode: "native" | "legacy";
}

export interface GatewayFallbackEvent {
  fromProvider: string;
  fromModel: string;
  toProvider: string;
  toModel: string;
  reason: string;
  timestamp: number;
}

export interface GatewayGenerationResult {
  response: string;
  provider: string;
  model: string;
  fallback: boolean;
}

export class AIGateway {
  private readonly providers: Map<string, AIProvider>;
  private readonly defaultProviderId: string;
  private readonly fallbackProviderId?: string;
  private readonly onFallback?: (event: GatewayFallbackEvent) => void;
  private readonly modelCatalogTtlMs = 60_000;
  private modelCatalogRevision = 0;
  private modelCatalogCache?: {
    expiresAt: number;
    value: { providers: AIModelCatalogEntry[] };
  };
  private modelCatalogInFlight?: {
    revision: number;
    promise: Promise<{ providers: AIModelCatalogEntry[] }>;
  };

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
    if (new Set(providers.map((provider) => provider.id)).size !== providers.length) {
      throw new Error("AI provider identifiers must be unique");
    }
    if (providers.some((provider) => typeof provider.generate !== "function" && typeof provider.generateRequest !== "function")) {
      throw new Error("Every AI provider must implement a native or legacy generation method");
    }
    if (providers.some((provider) => typeof provider.generateRequest === "function" &&
      (!provider.protocol?.trim() || provider.protocol.length > 128 ||
        !provider.adapterVersion?.trim() || provider.adapterVersion.length > 64))) {
      throw new Error("Every native AI provider adapter must declare a protocol and adapter version");
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

  setRuntimeProviderApiKey(providerId: string, apiKey: string): void {
    const provider = this.providers.get(providerId);
    const setter = provider && (provider as unknown as { setRuntimeApiKey?: (key: string) => void }).setRuntimeApiKey;
    if (!setter) throw new Error(`Provider ${providerId} does not support API credentials`);
    setter.call(provider, apiKey);
    this.invalidateModelCatalogCache();
  }

  private invalidateModelCatalogCache(): void {
    this.modelCatalogRevision += 1;
    this.modelCatalogCache = undefined;
    this.modelCatalogInFlight = undefined;
  }

  hasRuntimeProviderApiKey(providerId: string): boolean {
    const provider = this.providers.get(providerId);
    const hasKey = provider && (provider as unknown as { hasApiKey?: () => boolean }).hasApiKey;
    return Boolean(hasKey?.call(provider));
  }

  setRuntimeOpenAIKey(apiKey: string): void {
    this.setRuntimeProviderApiKey("openai", apiKey);
  }

  hasOpenAIKey(): boolean {
    const provider = this.providers.get("openai");
    return Boolean(provider && typeof (provider as { hasApiKey?: () => boolean }).hasApiKey === "function" && (provider as unknown as { hasApiKey: () => boolean }).hasApiKey());
  }

  setRuntimeOrcaRouterKey(apiKey: string): void {
    this.setRuntimeProviderApiKey("orcarouter", apiKey);
  }

  hasOrcaRouterKey(): boolean {
    const provider = this.providers.get("orcarouter");
    return Boolean(provider && typeof (provider as { hasApiKey?: () => boolean }).hasApiKey === "function" && (provider as unknown as { hasApiKey: () => boolean }).hasApiKey());
  }

  setRuntimeOpenRouterKey(apiKey: string): void {
    this.setRuntimeProviderApiKey("openrouter", apiKey);
  }

  hasOpenRouterKey(): boolean {
    const provider = this.providers.get("openrouter");
    return Boolean(provider && typeof (provider as { hasApiKey?: () => boolean }).hasApiKey === "function" && (provider as unknown as { hasApiKey: () => boolean }).hasApiKey());
  }

  setRuntimeAnyModelKey(apiKey: string): void {
    this.setRuntimeProviderApiKey("anymodel", apiKey);
  }

  hasAnyModelKey(): boolean {
    const provider = this.providers.get("anymodel");
    return Boolean(provider && typeof (provider as { hasApiKey?: () => boolean }).hasApiKey === "function" && (provider as unknown as { hasApiKey: () => boolean }).hasApiKey());
  }

  getDefaultProviderId(): string {
    return this.defaultProviderId;
  }

  getCapabilities(providerId = this.defaultProviderId, model?: string): AIModelCapabilities {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    return provider.getCapabilities ? provider.getCapabilities(model) : provider.capabilities;
  }

  getDefaultModel(providerId = this.defaultProviderId): string {
    return this.providers.get(providerId)?.model ?? this.providers.get(this.defaultProviderId)!.model;
  }

  async generateRequest(
    request: AIRequest,
    options: { provider?: string } = {},
  ): Promise<AIResponse> {
    validateCanonicalRequest(request);
    const providerId = options.provider ?? this.defaultProviderId;
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new NexumError("CONFIG_ERROR", "Выбранный AI-провайдер не подключён к КВАРД.", {
        status: 404,
        retryable: false,
        technicalDetails: `Unknown AI provider: ${providerId}`,
      });
    }
    if (request.signal?.aborted) {
      throw new NexumError("NETWORK_ERROR", "Запрос отменён.", {
        status: 499,
        retryable: false,
        technicalDetails: "AbortSignal was already aborted before provider invocation",
      });
    }
    if (request.stream) {
      throw new NexumError("MODEL_ERROR", "Потоковая генерация пока не поддерживается API полного ответа.", {
        status: 400,
        retryable: false,
        technicalDetails: "Streaming requests require a dedicated stream API; generateRequest returns a completed response",
      });
    }

    const model = request.model || provider.model;
    const capabilities = this.getCapabilities(providerId, model);
    const required = getRequiredCapabilities(request);
    for (const [capability, needed] of Object.entries(required)) {
      if (needed && capabilities[capability as keyof AIModelCapabilities] !== true) {
        throw new NexumError("MODEL_ERROR", "Выбранная модель не поддерживает необходимые функции запроса.", {
          status: 400,
          retryable: false,
          technicalDetails: `Provider ${providerId}, model ${model} does not declare capability ${capability}`,
        });
      }
    }

    const canonicalRequest: AIRequest = { ...request, model };
    try {
      const response = provider.generateRequest
        ? await provider.generateRequest(canonicalRequest)
        : await generateWithLegacyProvider(provider, canonicalRequest);
      if (!response || typeof response !== "object" || typeof response.content !== "string") {
        throw new NexumError("MODEL_ERROR", "AI-провайдер вернул ответ в неподдерживаемом формате.", {
          retryable: false,
          technicalDetails: "Canonical provider response must contain a string content field",
        });
      }
      return normalizeAIResponse({ ...response, provider: provider.id }, provider.id, model);
    } catch (error) {
      if (error instanceof NexumError) {
        throw new NexumError(error.code, redactProviderError(error.userSafeMessage), {
          retryable: error.retryable,
          status: error.status,
          technicalDetails: redactProviderError(error.technicalDetails ?? error.message),
          requestId: error.requestId,
          projectId: error.projectId,
          agentRunId: error.agentRunId,
          stage: error.stage,
        });
      }
      throw classifyAIError(new Error(redactProviderError(error instanceof Error ? error.message : String(error))));
    }
  }

  async *streamRequest(
    request: AIRequest,
    options: { provider?: string } = {},
  ): AsyncGenerator<import("./types.js").AIStreamEvent> {
    validateCanonicalRequest({ ...request, stream: true });
    const providerId = options.provider ?? this.defaultProviderId;
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new NexumError("CONFIG_ERROR", "Выбранный AI-провайдер не подключён к КВАРД.", {
        status: 404, retryable: false, technicalDetails: `Unknown AI provider: ${providerId}`,
      });
    }
    if (!provider.streamRequest) {
      throw new NexumError("MODEL_ERROR", "Потоковая генерация не поддерживается адаптером выбранного провайдера.", {
        status: 400, retryable: false, technicalDetails: `Provider ${providerId} has no native streamRequest implementation`,
      });
    }
    if (request.signal?.aborted) {
      throw new NexumError("NETWORK_ERROR", "Запрос отменён.", {
        status: 499, retryable: false, technicalDetails: "AbortSignal was already aborted before stream invocation",
      });
    }
    const model = request.model || provider.model;
    const capabilities = this.getCapabilities(providerId, model);
    if (capabilities.streaming !== true) {
      throw new NexumError("MODEL_ERROR", "Выбранная модель не подтвердила поддержку потоковой генерации.", {
        status: 400, retryable: false, technicalDetails: `Provider ${providerId}, model ${model} does not declare streaming capability`,
      });
    }
    try {
      for await (const event of provider.streamRequest({ ...request, model, stream: true })) {
        yield event;
      }
    } catch (error) {
      if (error instanceof NexumError) {
        throw new NexumError(error.code, redactProviderError(error.userSafeMessage), {
          retryable: error.retryable, status: error.status,
          technicalDetails: redactProviderError(error.technicalDetails ?? error.message),
          requestId: error.requestId, projectId: error.projectId, agentRunId: error.agentRunId, stage: error.stage,
        });
      }
      throw classifyAIError(new Error(redactProviderError(error instanceof Error ? error.message : String(error))));
    }
  }

  private async generateWithProvider(
    provider: AIProvider,
    message: string,
    model: string | undefined,
    options: AIGenerateOptions = {},
  ): Promise<{ response: string; model: string }> {
    const selectedModel = model ?? provider.model;
    if (options.onTextDelta && provider.streamRequest && this.getCapabilities(provider.id, selectedModel).streaming === true) {
      const request: AIRequest = {
        version: 1,
        model: selectedModel,
        messages: [{ role: "user", content: message }],
        stream: true,
        ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      };
      let response = "";
      let terminal = false;
      for await (const event of this.streamRequest(request, { provider: provider.id })) {
        if (terminal) {
          throw new NexumError("PROVIDER_ERROR", "Провайдер отправил события после завершения потока.", {
            retryable: false,
            technicalDetails: `Provider ${provider.id} emitted an event after message_end`,
          });
        }
        if (event.type === "text_delta") {
          response += event.text;
          if (event.text) options.onTextDelta(event.text);
        } else if (event.type === "message_end") {
          terminal = true;
        } else if (event.type === "error") {
          throw new NexumError("PROVIDER_ERROR", event.message, {
            retryable: true,
            technicalDetails: event.message,
          });
        } else if (event.type === "tool_call_start" || event.type === "tool_call_delta") {
          throw new NexumError("MODEL_ERROR", "Финальный текстовый ответ неожиданно содержит вызов инструмента.", {
            retryable: false,
            technicalDetails: `Provider ${provider.id} emitted tool-call events for a text-only generation`,
          });
        }
      }
      if (!terminal) {
        throw new NexumError("PROVIDER_ERROR", "Поток провайдера завершился без финального события.", {
          retryable: true,
          technicalDetails: `Provider ${provider.id} stream ended without message_end`,
        });
      }
      return { response, model: selectedModel };
    }
    if (provider.generateRequest) {
      const response = await this.generateRequest({
        version: 1,
        model: selectedModel,
        messages: [{ role: "user", content: message }],
        ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }, { provider: provider.id });
      options.onTextDelta?.(response.content);
      return { response: response.content, model: response.model };
    }
    if (provider.generate) {
      const response = await provider.generate(message, model, options);
      options.onTextDelta?.(response);
      return { response, model: selectedModel };
    }
    throw new NexumError("CONFIG_ERROR", "AI-провайдер не реализует поддерживаемый интерфейс генерации.", {
      retryable: false,
      technicalDetails: `Provider ${provider.id} has no generation method`,
    });
  }

  async generateWithMetadata(message: string, options: GatewayGenerateOptions | string = {}): Promise<GatewayGenerationResult> {
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

    let emittedText = false;
    const onTextDelta = normalizedOptions.onTextDelta
      ? (delta: string) => {
          if (!delta) return;
          emittedText = true;
          normalizedOptions.onTextDelta?.(delta);
        }
      : undefined;

    try {
      if (agentFailureInjection.consumeFailure("NETWORK_FAILURE")) throw new Error("Injected network failure");
      if (agentFailureInjection.consumeFailure("MODEL_FAILURE")) throw new Error("Injected model failure");
      const generated = await this.generateWithProvider(provider, localizedMessage, normalizedOptions.model, {
        ...(normalizedOptions.maxTokens === undefined ? {} : { maxTokens: normalizedOptions.maxTokens }),
        ...(normalizedOptions.temperature === undefined ? {} : { temperature: normalizedOptions.temperature }),
        ...(normalizedOptions.signal ? { signal: normalizedOptions.signal } : {}),
        ...(onTextDelta ? { onTextDelta } : {}),
      });
      return {
        response: generated.response,
        provider: provider.id,
        model: generated.model,
        fallback: false,
      };
    } catch (error) {
      const normalizedError = classifyAIError(error);
      if (emittedText) throw normalizedError;
      const fallbackId = this.fallbackProviderId;
      const reason = normalizedError.technicalDetails ?? normalizedError.message;
      const explicitSelection =
        typeof options === "string" ||
        normalizedOptions.provider !== undefined ||
        normalizedOptions.model !== undefined;
      if (
        normalizedOptions.fallback === false ||
        (!normalizedOptions.fallback && explicitSelection) ||
        !fallbackId ||
        fallbackId === provider.id ||
        !normalizedError.retryable
      ) {
        throw normalizedError;
      }

      const fallback = this.providers.get(fallbackId);
      if (!fallback) throw error;
      const event: GatewayFallbackEvent = {
        fromProvider: provider.id,
        fromModel: normalizedOptions.model ?? provider.model,
        toProvider: fallback.id,
        toModel: fallback.model,
        reason,
        timestamp: Date.now(),
      };
      this.onFallback?.(event);

      try {
        const generated = await this.generateWithProvider(fallback, localizedMessage, fallback.model, {
          ...(normalizedOptions.maxTokens === undefined ? {} : { maxTokens: normalizedOptions.maxTokens }),
          ...(normalizedOptions.temperature === undefined ? {} : { temperature: normalizedOptions.temperature }),
          ...(normalizedOptions.signal ? { signal: normalizedOptions.signal } : {}),
          ...(onTextDelta ? { onTextDelta } : {}),
        });
        return {
          response: generated.response,
          provider: fallback.id,
          model: generated.model,
          fallback: true,
        };
      } catch (fallbackError) {
        throw classifyAIError(fallbackError);
      }
    }
  }

  async generate(message: string, options: GatewayGenerateOptions | string = {}): Promise<string> {
    const result = await this.generateWithMetadata(message, options);
    return result.response;
  }

  private isTransientProviderError(message: string): boolean {
    return /(?:408|429|rate.?limit|too many requests|timeout|timed out|temporar(?:y|ily)|service unavailable|network error|fetch failed|econnreset|econnrefused|enotfound|\b5\d{2}\b)/i.test(message);
  }

  getProviders(): GatewayProviderInfo[] {
    return [...this.providers.values()].map((provider) => ({
      id: provider.id,
      name: provider.name,
      model: provider.model,
      isDefault: provider.id === this.defaultProviderId,
      ...(provider.protocol ? { protocol: provider.protocol } : {}),
      ...(provider.legacyProtocol ? { legacyProtocol: provider.legacyProtocol } : {}),
      ...(provider.adapterVersion ? { adapterVersion: provider.adapterVersion } : {}),
      adapterMode: provider.generateRequest ? "native" : "legacy",
    }));
  }

  async getModelCatalog(signal?: AbortSignal): Promise<{ providers: AIModelCatalogEntry[] }> {
    const now = Date.now();
    if (this.modelCatalogCache && this.modelCatalogCache.expiresAt > now) {
      return this.modelCatalogCache.value;
    }

    const revision = this.modelCatalogRevision;
    if (!signal && this.modelCatalogInFlight?.revision === revision) {
      return this.modelCatalogInFlight.promise;
    }

    const promise = this.fetchModelCatalog(signal);
    if (!signal) this.modelCatalogInFlight = { revision, promise };
    try {
      const value = await promise;
      if (revision === this.modelCatalogRevision && !signal?.aborted) {
        this.modelCatalogCache = { value, expiresAt: Date.now() + this.modelCatalogTtlMs };
      }
      return value;
    } finally {
      if (this.modelCatalogInFlight?.promise === promise) {
        this.modelCatalogInFlight = undefined;
      }
    }
  }

  private async fetchModelCatalog(signal?: AbortSignal): Promise<{ providers: AIModelCatalogEntry[] }> {
    const providers = await Promise.all([...this.providers.values()].map(async (provider): Promise<AIModelCatalogEntry> => {
      if (!provider.listModels) {
        return {
          provider: provider.id,
          configuredModel: provider.model,
          models: [provider.model],
          source: "configured_fallback",
          verified: false,
          status: "unavailable",
          errorCode: "catalog_not_supported",
        };
      }

      try {
        const discovered = await provider.listModels(signal);
        const models = [...new Set(discovered
          .filter((model): model is string => typeof model === "string")
          .map((model) => model.trim())
          .filter((model) => model.length > 0 && model.length <= 200))];
        if (models.length === 0) {
          return {
            provider: provider.id,
            configuredModel: provider.model,
            models: [provider.model],
            source: "configured_fallback",
            verified: false,
            status: "empty",
            errorCode: "catalog_empty",
          };
        }
        return {
          provider: provider.id,
          configuredModel: provider.model,
          models,
          source: "provider_api",
          verified: true,
          status: "available",
        };
      } catch {
        if (signal?.aborted) throw new NexumError("NETWORK_ERROR", "Получение списка моделей отменено.", {
          status: 499,
          retryable: false,
          technicalDetails: "Model catalog request was aborted",
        });
        return {
          provider: provider.id,
          configuredModel: provider.model,
          models: [provider.model],
          source: "configured_fallback",
          verified: false,
          status: "unavailable",
          errorCode: "catalog_request_failed",
        };
      }
    }));
    return { providers };
  }
  async getModels(signal?: AbortSignal): Promise<Record<string, string[]>> {
    const catalog = await this.getModelCatalog(signal);
    return Object.fromEntries(catalog.providers.map((entry) => [entry.provider, entry.models]));
  }

  async getStatus(providerId = this.defaultProviderId, model?: string, signal?: AbortSignal): Promise<AIProviderStatus & { provider: string }> {
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
