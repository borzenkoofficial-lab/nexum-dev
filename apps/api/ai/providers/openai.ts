import type { AIProvider, AIProviderStatus } from "../types.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5";
const DEFAULT_MODELS = [
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
];

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface OpenAIModelsResponse {
  data?: Array<{ id?: string }>;
}

export class OpenAIProvider implements AIProvider {
  id = "openai";
  name = "OpenAI";
  model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private runtimeApiKey = process.env.OPENAI_API_KEY?.trim() || "";

  constructor(
    baseUrl = process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL,
    model = DEFAULT_MODEL,
    timeoutMs = 60_000,
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
      throw new Error("OpenAI API key is invalid");
    }
    this.runtimeApiKey = value;
  }

  hasApiKey(): boolean {
    return Boolean(this.runtimeApiKey);
  }

  async generate(message: string, model = this.model): Promise<string> {
    const data = await this.request<OpenAIChatResponse>("/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: this.validateModel(model),
        messages: [{ role: "user", content: message }],
      }),
    });
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("OpenAI returned an invalid response");
    return content;
  }

  async listModels(): Promise<string[]> {
    const data = await this.request<OpenAIModelsResponse>("/models", { method: "GET" });
    const remote = (data.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string")
      .filter((id) => /^gpt-/i.test(id));
    return [...new Set([...DEFAULT_MODELS, ...remote])];
  }

  async getStatus(model = this.model): Promise<AIProviderStatus> {
    const startedAt = Date.now();
    if (!this.runtimeApiKey) {
      return {
        available: false,
        model: this.validateModel(model),
        latencyMs: Date.now() - startedAt,
        error: "OPENAI_API_KEY is not configured. Add an API key in NEXUM Settings.",
      };
    }

    try {
      const models = await this.listModels();
      return {
        available: models.length > 0,
        model: this.validateModel(model),
        latencyMs: Date.now() - startedAt,
        ...(models.length === 0 ? { error: "OpenAI returned no GPT models" } : {}),
      };
    } catch (error) {
      return {
        available: false,
        model: this.validateModel(model),
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "OpenAI is unavailable",
      };
    }
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const apiKey = this.runtimeApiKey;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
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
      if (controller.signal.aborted) throw new Error("OpenAI request timed out");
      if (error instanceof Error && error.message.startsWith("OpenAI")) throw error;
      throw new Error("OpenAI network error");
    } finally {
      clearTimeout(timeout);
    }
  }

  private httpError(status: number): string {
    if (status === 401) return "OpenAI authentication failed (401)";
    if (status === 403) return "OpenAI access forbidden (403)";
    if (status === 429) return "OpenAI rate limit or quota exceeded (429)";
    if (status >= 500) return `OpenAI service error (${status})`;
    return `OpenAI request failed (${status})`;
  }

  private validateModel(model: string): string {
    const value = model.trim();
    if (!value || value.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
      throw new Error("OpenAI model name is invalid");
    }
    return value;
  }
}
