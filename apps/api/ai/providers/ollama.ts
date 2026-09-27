import type { AIProvider, AIProviderStatus } from "../types.js";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "qwen3:4b";
const DEFAULT_TIMEOUT_MS = 900_000;
const DEFAULT_CONTEXT = 4096;

interface OllamaChatResponse {
  message?: { content?: string };
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

export class OllamaProvider implements AIProvider {
  id = "ollama";
  name = "Ollama";
  model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL,
    model = process.env.OLLAMA_MODEL || DEFAULT_MODEL,
    timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = this.validateModel(model);
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async generate(message: string, model = this.model): Promise<string> {
    const selectedModel = this.validateModel(model);
    const data = await this.request<OllamaChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        model: selectedModel,
        messages: [{ role: "user", content: message }],
        stream: false,
        keep_alive: "10m",
        think: false,
        options: {
          num_ctx: Number(process.env.OLLAMA_NUM_CTX || DEFAULT_CONTEXT),
          ...(process.env.OLLAMA_NUM_THREAD?.trim() ? { num_thread: Number(process.env.OLLAMA_NUM_THREAD) } : {}),
          num_predict: Number(process.env.OLLAMA_NUM_PREDICT || 1400),
        },
      }),
    });

    const content = data.message?.content;
    if (typeof content !== "string") {
      throw new Error("Ollama returned an invalid response");
    }
    return content;
  }

  async listModels(): Promise<string[]> {
    const data = await this.request<OllamaTagsResponse>("/api/tags", { method: "GET" });
    return (data.models ?? [])
      .map((model) => model.name)
      .filter((model): model is string => typeof model === "string" && model.length > 0);
  }

  async getStatus(model = this.model): Promise<AIProviderStatus> {
    const startedAt = Date.now();

    try {
      const selectedModel = this.validateModel(model);
      const models = await this.listModels();
      const modelAvailable = models.some(
        (installedModel) =>
          installedModel === selectedModel ||
          installedModel.startsWith(selectedModel + ":"),
      );

      if (!modelAvailable) {
        return {
          available: false,
          model: selectedModel,
          latencyMs: Date.now() - startedAt,
          error: `Ollama is running, but model ${selectedModel} is not installed`,
        };
      }

      return {
        available: true,
        model: selectedModel,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        available: false,
        model: this.validateModel(model),
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Ollama is unavailable",
      };
    }
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        let detail = "";
        if (body) {
          try {
            const parsed = JSON.parse(body) as { error?: unknown };
            if (typeof parsed.error === "string" && parsed.error.trim()) detail = `: ${parsed.error.trim()}`;
          } catch {
            // Keep the transport error generic if Ollama returned non-JSON content.
          }
        }
        throw new Error(`Ollama request failed (${response.status})${detail}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Ollama request timed out");
      if (error instanceof Error && error.message.startsWith("Ollama ")) throw error;
      throw new Error("Ollama is unavailable");
    } finally {
      clearTimeout(timeout);
    }
  }

  private validateModel(model: string): string {
    const value = model.trim();
    if (!value || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) {
      throw new Error("Ollama model name is invalid");
    }
    return value;
  }
}
