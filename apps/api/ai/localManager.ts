const DEFAULT_BASE_URL = "http://127.0.0.1:11434";

export interface LocalModel {
  name: string;
  size?: number;
  digest?: string;
  modifiedAt?: string;
  details?: Record<string, unknown>;
}

export interface LocalAIStatus {
  available: boolean;
  baseUrl: string;
  version?: string;
  error?: string;
  latencyMs: number | null;
}

interface OllamaTagsResponse { models?: Array<Record<string, unknown>>; }
interface OllamaVersionResponse { version?: string; }

export class LocalAIManager {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL,
    timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS || 15_000),
    fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\\/+$/, "");
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async status(): Promise<LocalAIStatus> {
    const startedAt = Date.now();
    try {
      const data = await this.request<OllamaVersionResponse>("/api/version", { method: "GET" });
      return {
        available: true,
        baseUrl: this.baseUrl,
        version: typeof data.version === "string" ? data.version : undefined,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        available: false,
        baseUrl: this.baseUrl,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Ollama is unavailable",
      };
    }
  }

  async listModels(): Promise<LocalModel[]> {
    const data = await this.request<OllamaTagsResponse>("/api/tags", { method: "GET" });
    return (data.models ?? []).map((item) => ({
      name: typeof item.name === "string" ? item.name : "",
      size: typeof item.size === "number" ? item.size : undefined,
      digest: typeof item.digest === "string" ? item.digest : undefined,
      modifiedAt: typeof item.modified_at === "string" ? item.modified_at : undefined,
      details: item.details && typeof item.details === "object" ? item.details as Record<string, unknown> : undefined,
    })).filter((item) => item.name.length > 0);
  }

  async showModel(name: string): Promise<Record<string, unknown>> {
    this.validateModel(name);
    return this.request<Record<string, unknown>>("/api/show", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  async pullModel(name: string): Promise<{ success: true; model: string; status: string }> {
    this.validateModel(name);
    const response = await this.requestRaw("/api/pull", {
      method: "POST",
      body: JSON.stringify({ model: name, stream: false }),
    });
    let status = "success";
    try {
      const parsed = JSON.parse(response) as { status?: unknown };
      if (typeof parsed.status === "string") status = parsed.status;
    } catch {}
    return { success: true, model: name, status };
  }

  async deleteModel(name: string): Promise<{ success: true; model: string }> {
    this.validateModel(name);
    await this.requestRaw("/api/delete", {
      method: "DELETE",
      body: JSON.stringify({ model: name }),
    });
    return { success: true, model: name };
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const raw = await this.requestRaw(path, init);
    return JSON.parse(raw) as T;
  }

  private async requestRaw(path: string, init: RequestInit): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.baseUrl + path, {
        ...init,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) {
        let detail = "";
        try {
          const parsed = JSON.parse(body) as { error?: unknown };
          if (typeof parsed.error === "string" && parsed.error.trim()) detail = `: ${parsed.error.trim()}`;
        } catch {}
        throw new Error(`Ollama request failed (${response.status})${detail}`);
      }
      return body;
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Ollama request timed out");
      if (error instanceof Error && error.message.startsWith("Ollama ")) throw error;
      throw new Error("Ollama is unavailable");
    } finally {
      clearTimeout(timeout);
    }
  }

  private validateModel(name: string): void {
    if (!name || name.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(name)) {
      throw new Error("Invalid local model name");
    }
  }
}
