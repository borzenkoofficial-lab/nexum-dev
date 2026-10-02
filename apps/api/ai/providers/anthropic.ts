import type { AIProvider, AIProviderStatus, AIGenerateOptions } from "../types.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const DEFAULT_MODELS = ["claude-sonnet-5", "claude-opus-4-8"];

interface AnthropicResponse { content?: Array<{ type?: string; text?: string }> }
interface AnthropicModelsResponse { data?: Array<{ id?: string }> }

export class AnthropicProvider implements AIProvider {
  id = "anthropic";
  name = "Anthropic";
  model: string;
  capabilities = { text: true, code: true, vision: false, toolCalling: false, streaming: false, structuredOutput: false, reasoning: false, contextWindow: null } as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private runtimeApiKey = process.env.ANTHROPIC_API_KEY?.trim() || "";

  constructor(baseUrl = process.env.ANTHROPIC_BASE_URL || DEFAULT_BASE_URL, model = DEFAULT_MODEL, timeoutMs = 90_000, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = this.validateModel(model);
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  setRuntimeApiKey(apiKey: string): void {
    const value = apiKey.trim();
    if (!value || value.length < 20 || value.length > 500) throw new Error("Anthropic API key is invalid");
    this.runtimeApiKey = value;
  }

  hasApiKey(): boolean { return Boolean(this.runtimeApiKey); }

  async generate(message: string, model = this.model, options: AIGenerateOptions = {}): Promise<string> {
    const data = await this.request<AnthropicResponse>("/messages", {
      method: "POST",
      body: JSON.stringify({
        model: this.validateModel(model),
        max_tokens: Math.max(1, options.maxTokens ?? 4096),
        messages: [{ role: "user", content: message }],
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      }),
    });
    const content = (data.content ?? []).filter((item) => item.type === "text" && typeof item.text === "string").map((item) => item.text as string).join("\n");
    if (!content) throw new Error("Anthropic returned an invalid response");
    return content;
  }

  async listModels(): Promise<string[]> {
    if (!this.runtimeApiKey) return [...DEFAULT_MODELS];
    try {
      const data = await this.request<AnthropicModelsResponse>("/models", { method: "GET" });
      const remote = (data.data ?? []).map((item) => item.id).filter((id): id is string => typeof id === "string" && /^claude-/i.test(id));
      return [...new Set([...DEFAULT_MODELS, ...remote])];
    } catch { return [...DEFAULT_MODELS]; }
  }

  async getStatus(model = this.model): Promise<AIProviderStatus> {
    const startedAt = Date.now();
    if (!this.runtimeApiKey) return { available: false, model: this.validateModel(model), latencyMs: Date.now() - startedAt, error: "ANTHROPIC_API_KEY is not configured. Add an API key in NEXUM Settings." };
    try {
      const models = await this.listModels();
      return { available: models.length > 0, model: this.validateModel(model), latencyMs: Date.now() - startedAt };
    } catch (error) {
      return { available: false, model: this.validateModel(model), latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : "Anthropic is unavailable" };
    }
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const apiKey = this.runtimeApiKey;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const callerSignal = (init as RequestInit).signal;
    const abortFromCaller = () => controller.abort(callerSignal?.reason);
    if (callerSignal) { if (callerSignal.aborted) abortFromCaller(); else callerSignal.addEventListener("abort", abortFromCaller, { once: true }); }
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { Accept: "application/json", "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", ...(init.headers ?? {}) },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(this.httpError(response.status));
      return (await response.json()) as T;
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Anthropic request timed out");
      if (error instanceof Error && error.message.startsWith("Anthropic")) throw error;
      throw new Error("Anthropic network error");
    } finally { clearTimeout(timeout); }
  }

  private httpError(status: number): string {
    if (status === 401) return "Anthropic authentication failed (401)";
    if (status === 403) return "Anthropic access forbidden (403)";
    if (status === 429) return "Anthropic rate limit or quota exceeded (429)";
    if (status >= 500) return `Anthropic service error (${status})`;
    return `Anthropic request failed (${status})`;
  }

  private validateModel(model: string): string {
    const value = model.trim();
    if (!value || value.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw new Error("Anthropic model name is invalid");
    return value;
  }
}
