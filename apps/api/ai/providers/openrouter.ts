import type { AIProvider, AIProviderStatus, AIGenerateOptions } from "../types.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "openrouter/free";
const DEFAULT_FREE_MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "poolside/laguna-s-2.1:free",
  "nvidia/nemotron-3.5-lightning:free",
  "dots-studio/dots3-note-preview:free",
  "cohere/north-mini-code:free",
  "poolside/laguna-xs-2.1:free",
  "qwen/qwen3.8-27b:free",
  "google/gemma-4-26b-a4b-it:free",
];
const DEFAULT_TIMEOUT_MS = 60_000;

interface OpenRouterChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface OpenRouterModelsResponse {
  data?: Array<{ id?: string }>;
}

export class OpenRouterProvider implements AIProvider {
  id = "openrouter";
  name = "OpenRouter";
  model: string;
  capabilities = { text: true, code: true, vision: false, toolCalling: false, streaming: false, structuredOutput: false, reasoning: false, contextWindow: null } as const;
  private readonly models: string[];
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private runtimeApiKey = process.env.OPENROUTER_API_KEY?.trim() || "";

  constructor(
    baseUrl = process.env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL,
    model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = this.validateModel(model);
    const configuredModels = (process.env.OPENROUTER_MODELS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    this.models = [...new Set(
      (configuredModels.length > 0 ? configuredModels : DEFAULT_FREE_MODELS)
        .map((value) => this.validateModel(value)),
    )];
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  setRuntimeApiKey(apiKey: string): void {
    const value = apiKey.trim();
    if (!value || value.length < 10 || value.length > 500) {
      throw new Error("OpenRouter API key is invalid");
    }
    this.runtimeApiKey = value;
  }

  hasApiKey(): boolean {
    return Boolean(this.runtimeApiKey);
  }

  async generate(message: string, model = this.selectModel(message), options: AIGenerateOptions = {}): Promise<string> {
    const candidates = this.buildCandidates(model, message);
    let lastError: unknown;

    for (const candidate of candidates) {
      try {
        const data = await this.request<OpenRouterChatResponse>("/chat/completions", {
          method: "POST",
          body: JSON.stringify({
            model: candidate,
            messages: [{ role: "user", content: message }],
            ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
            ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
          }),
        });
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== "string") throw new Error("OpenRouter returned an invalid response");
        return content;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("All OpenRouter models failed");
  }

  private selectModel(message: string): string {
    const text = message.toLowerCase();

    if (/code|typescript|javascript|react|vite|npm|bug|error|debug|refactor|file|component|api|database|build|compile|terminal/.test(text)) {
      return this.models.find((model) => model.includes("north-mini-code") || model.includes("laguna-s-2.1") || model.includes("laguna-xs-2.1")) ?? this.models[0]!;
    }

    if (/plan|architect|architecture|reason|analy[sz]|research|compare|strategy|agent|multi-step/.test(text)) {
      return this.models.find((model) => model.includes("nemotron-3-ultra") || model.includes("nemotron-3.5-lightning")) ?? this.models[0]!;
    }

    if (/image|visual|design|ui|ux|screenshot|photo/.test(text)) {
      return this.models.find((model) => model.includes("gemma")) ?? this.models[0]!;
    }

    return this.models.find((model) => model.includes("qwen")) ?? this.models[0]!;
  }

  private buildCandidates(model: string, message: string): string[] {
    const selected = this.validateModel(model);

    // An explicit model is a strict contract. Automatic model routing is only
    // allowed when the provider itself was asked to route (openrouter/free) or
    // when no concrete model was supplied by the caller.
    if (selected !== this.model || selected === "openrouter/free") {
      return [selected];
    }

    const preferred = this.selectModel(message);
    return [...new Set([preferred])];
  }

  async listModels(): Promise<string[]> {
    const data = await this.request<OpenRouterModelsResponse>("/models", { method: "GET" });
    return (data.data ?? [])
      .map((model) => model.id)
      .filter((model): model is string => typeof model === "string" && model.length > 0);
  }

  async getStatus(model = this.model): Promise<AIProviderStatus> {
    const startedAt = Date.now();
    if (!this.runtimeApiKey) {
      return {
        available: false,
        model: this.validateModel(model),
        latencyMs: Date.now() - startedAt,
        error: "OPENROUTER_API_KEY is not configured. Add it to the deployment environment.",
      };
    }
    try {
      const models = await this.listModels();
      return {
        available: true,
        model: this.validateModel(model),
        latencyMs: Date.now() - startedAt,
        ...(models.length === 0 ? { error: "OpenRouter returned no models" } : {}),
      };
    } catch (error) {
      return {
        available: false,
        model: this.validateModel(model),
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "OpenRouter is unavailable",
      };
    }
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const apiKey = this.runtimeApiKey;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://nexum.dev",
          "X-Title": "NEXUM.DEV",
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(this.httpError(response.status));
      return (await response.json()) as T;
    } catch (error) {
      if (controller.signal.aborted) throw new Error("OpenRouter request timed out");
      if (error instanceof Error && error.message.startsWith("OpenRouter")) throw error;
      throw new Error("OpenRouter network error");
    } finally {
      clearTimeout(timeout);
    }
  }

  private httpError(status: number): string {
    if (status === 401) return "OpenRouter authentication failed (401)";
    if (status === 403) return "OpenRouter access forbidden (403)";
    if (status === 429) return "OpenRouter rate limit exceeded (429)";
    if (status >= 500) return `OpenRouter service error (${status})`;
    return `OpenRouter request failed (${status})`;
  }

  private validateModel(model: string): string {
    const value = model.trim();
    if (!value || value.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) {
      throw new Error("OpenRouter model name is invalid");
    }
    return value;
  }
}
