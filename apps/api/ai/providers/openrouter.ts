import type { AIProvider, AIProviderStatus } from "../types.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "openrouter/free";
const DEFAULT_FREE_MODELS = [
  "cohere/north-mini-code:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "qwen/qwen3.8-27b:free",
  "google/gemma-4-26b-a4b-it:free",
  "poolside/laguna-s-2.1:free",
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
  private readonly models: string[];
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

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

  async generate(message: string, model = this.selectModel(message)): Promise<string> {
    const candidates = this.buildCandidates(model, message);
    let lastError: unknown;

    for (const candidate of candidates) {
      try {
        const data = await this.request<OpenRouterChatResponse>("/chat/completions", {
          method: "POST",
          body: JSON.stringify({
            model: candidate,
            messages: [{ role: "user", content: message }],
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
      return this.models.find((model) => model.includes("north-mini-code") || model.includes("laguna")) ?? this.models[0];
    }

    if (/plan|architect|architecture|reason|analy[sz]|research|compare|strategy|agent|multi-step/.test(text)) {
      return this.models.find((model) => model.includes("nemotron")) ?? this.models[0];
    }

    if (/image|visual|design|ui|ux|screenshot|photo/.test(text)) {
      return this.models.find((model) => model.includes("gemma")) ?? this.models[0];
    }

    return this.models.find((model) => model.includes("qwen")) ?? this.models[0];
  }

  private buildCandidates(model: string, message: string): string[] {
    const selected = this.validateModel(model);
    const preferred = selected === this.model ? this.selectModel(message) : selected;
    return [...new Set([preferred, ...this.models])];
  }

  async listModels(): Promise<string[]> {
    const data = await this.request<OpenRouterModelsResponse>("/models", { method: "GET" });
    return (data.data ?? [])
      .map((model) => model.id)
      .filter((model): model is string => typeof model === "string" && model.length > 0);
  }

  async getStatus(model = this.model): Promise<AIProviderStatus> {
    const startedAt = Date.now();
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
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
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
