import type { AIProvider, AIProviderStatus, AIGenerateOptions } from "../types.js";

const DEFAULT_BASE_URL = "https://anymodel.org/v1";
const DEFAULT_MODEL = process.env.ANYMODEL_MODEL || "gpt-6-astra";
const DEFAULT_TIMEOUT_MS = 90_000;

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface ModelsResponse {
  data?: Array<{ id?: string }>;
}

export class AnyModelProvider implements AIProvider {
  id = "anymodel";
  name = "AnyModel";
  model: string;
  capabilities = {
    text: true,
    code: true,
    vision: false,
    toolCalling: false,
    streaming: false,
    structuredOutput: false,
    reasoning: true,
    contextWindow: 1_100_000,
  } as const;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private runtimeApiKey = process.env.ANYMODEL_API_KEY?.trim() || "";

  constructor(
    baseUrl = process.env.ANYMODEL_BASE_URL || DEFAULT_BASE_URL,
    model = DEFAULT_MODEL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = this.validateModel(model);
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  setRuntimeApiKey(apiKey: string): void {
    const value = apiKey.trim();
    if (!value || value.length < 10 || value.length > 500) {
      throw new Error("AnyModel API key is invalid");
    }
    this.runtimeApiKey = value;
  }

  hasApiKey(): boolean {
    return Boolean(this.runtimeApiKey);
  }

  async generate(message: string, model = this.model, options: AIGenerateOptions = {}): Promise<string> {
    const data = await this.request<ChatResponse>("/chat/completions", {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify({
        model: this.validateModel(model),
        messages: [{ role: "user", content: message }],
        ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      }),
    });
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("AnyModel returned an invalid response");
    return content;
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    try {
      const data = await this.request<ModelsResponse>("/models", {
        method: "GET",
        ...(signal ? { signal } : {}),
      });
      const remote = (data.data ?? [])
        .map((item) => item.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      return [...new Set([this.model, ...remote])];
    } catch {
      return [this.model];
    }
  }

  async getStatus(model = this.model, signal?: AbortSignal): Promise<AIProviderStatus> {
    const startedAt = Date.now();
    if (!this.runtimeApiKey) {
      return {
        available: false,
        model: this.validateModel(model),
        latencyMs: Date.now() - startedAt,
        error: "ANYMODEL_API_KEY is not configured. Add an AnyModel key in NEXUM Settings.",
      };
    }

    try {
      const models = await this.listModels(signal);
      return {
        available: models.length > 0,
        model: this.validateModel(model),
        latencyMs: Date.now() - startedAt,
        ...(models.length === 0 ? { error: "AnyModel returned no models" } : {}),
      };
    } catch (error) {
      return {
        available: false,
        model: this.validateModel(model),
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "AnyModel is unavailable",
      };
    }
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const apiKey = this.runtimeApiKey;
    if (!apiKey) throw new Error("ANYMODEL_API_KEY is not configured");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const callerSignal = init.signal;
    const abortFromCaller = () => controller.abort(callerSignal?.reason);

    if (callerSignal) {
      if (callerSignal.aborted) abortFromCaller();
      else callerSignal.addEventListener("abort", abortFromCaller, { once: true });
    }

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(this.httpError(response.status));
      return (await response.json()) as T;
    } catch (error) {
      if (callerSignal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (controller.signal.aborted) throw new Error("AnyModel request timed out");
      if (error instanceof Error && error.message.startsWith("AnyModel")) throw error;
      throw new Error("AnyModel network error");
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
  }

  private httpError(status: number): string {
    if (status === 401) return "AnyModel authentication failed (401)";
    if (status === 403) return "AnyModel access forbidden (403)";
    if (status === 429) return "AnyModel rate limit exceeded (429)";
    if (status >= 500) return `AnyModel service error (${status})`;
    return `AnyModel request failed (${status})`;
  }

  private validateModel(model: string): string {
    const value = model.trim();
    if (!value || value.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) {
      throw new Error("AnyModel model name is invalid");
    }
    return value;
  }
}
