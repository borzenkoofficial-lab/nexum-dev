import type { AIProvider, AIProviderStatus, AIGenerateOptions } from "../types.js";

const DEFAULT_BASE_URL = "https://api.orcarouter.ai/v1";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash-free";
const DEFAULT_TIMEOUT_MS = 60_000;

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface ModelsResponse {
  data?: Array<{ id?: string }>;
}

export class OrcaRouterProvider implements AIProvider {
  id = "orcarouter";
  name = "OrcaRouter";
  model = process.env.ORCAROUTER_MODEL || DEFAULT_MODEL;
  capabilities = { text: true, code: true, vision: false, toolCalling: false, streaming: false, structuredOutput: false, reasoning: false, contextWindow: null } as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private runtimeApiKey = process.env.ORCAROUTER_API_KEY?.trim() || "";

  constructor(
    baseUrl = process.env.ORCAROUTER_BASE_URL || DEFAULT_BASE_URL,
    model = process.env.ORCAROUTER_MODEL || DEFAULT_MODEL,
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
    if (!value || value.length < 20 || value.length > 500) {
      throw new Error("OrcaRouter API key is invalid");
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
    if (typeof content !== "string") {
      throw new Error("OrcaRouter returned an invalid response");
    }
    return content;
  }

  async listModels(): Promise<string[]> {
    try {
      const data = await this.request<ModelsResponse>("/models", { method: "GET" });
      const remote = (data.data ?? [])
        .map((item) => item.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      return [...new Set([this.model, DEFAULT_MODEL, ...remote])];
    } catch {
      return [this.model, DEFAULT_MODEL];
    }
  }

  async getStatus(model = this.model): Promise<AIProviderStatus> {
    const startedAt = Date.now();
    if (!this.runtimeApiKey) {
      return {
        available: false,
        model: this.validateModel(model),
        latencyMs: Date.now() - startedAt,
        error: "ORCAROUTER_API_KEY is not configured. Add an OrcaRouter key in NEXUM Settings.",
      };
    }

    try {
      const models = await this.listModels();
      return {
        available: models.length > 0,
        model: this.validateModel(model),
        latencyMs: Date.now() - startedAt,
        ...(models.length === 0 ? { error: "OrcaRouter returned no models" } : {}),
      };
    } catch (error) {
      return {
        available: false,
        model: this.validateModel(model),
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "OrcaRouter is unavailable",
      };
    }
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const apiKey = this.runtimeApiKey;
    if (!apiKey) throw new Error("ORCAROUTER_API_KEY is not configured");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const callerSignal = (init as RequestInit).signal;
    const abortFromCaller = () => controller.abort(callerSignal?.reason);
    if (callerSignal) { if (callerSignal.aborted) abortFromCaller(); else callerSignal.addEventListener("abort", abortFromCaller, { once: true }); }
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
      if (controller.signal.aborted) throw new Error("OrcaRouter request timed out");
      if (error instanceof Error && error.message.startsWith("OrcaRouter")) throw error;
      throw new Error("OrcaRouter network error");
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
  }

  private httpError(status: number): string {
    if (status === 401) return "OrcaRouter authentication failed (401)";
    if (status === 403) return "OrcaRouter access forbidden (403)";
    if (status === 429) return "OrcaRouter rate limit exceeded (429)";
    if (status >= 500) return `OrcaRouter service error (${status})`;
    return `OrcaRouter request failed (${status})`;
  }

  private validateModel(model: string): string {
    const value = model.trim();
    if (!value || value.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) {
      throw new Error("OrcaRouter model name is invalid");
    }
    return value;
  }
}
