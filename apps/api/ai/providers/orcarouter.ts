import type { AIModelCapabilities, AIProvider, AIProviderStatus, AIRequest, AIResponse, AIGenerateOptions, AIStreamEvent } from "../types.js";
import { validateCanonicalRequest } from "../canonical.js";
import {
  getOpenAICompatibleModelCapabilities,
  normalizeOpenAICompatibleResponse,
  serializeOpenAICompatibleRequest,
  type OpenAICompatibleChatResponse,
  type OpenAICompatibleModelMetadata,
  streamOpenAICompatibleChat,
} from "../openaiCompatibleAdapter.js";

const DEFAULT_BASE_URL = "https://api.orcarouter.ai/v1";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash-free";
const DEFAULT_TIMEOUT_MS = 60_000;

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface ModelsResponse {
  data?: Array<OpenAICompatibleModelMetadata & { id?: string }>;
}

export class OrcaRouterProvider implements AIProvider {
  id = "orcarouter";
  name = "OrcaRouter";
  protocol = "openai-compatible-chat-completions" as const;
  adapterVersion = "2.0.0";
  model = process.env.ORCAROUTER_MODEL || DEFAULT_MODEL;
  capabilities = { text: "unknown", code: "unknown", vision: "unknown", toolCalling: "unknown", streaming: false, structuredOutput: "unknown", reasoning: "unknown", contextWindow: null } as const;
  private readonly modelInfo = new Map<string, OpenAICompatibleModelMetadata>();
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

  getCapabilities(model = this.model): AIModelCapabilities {
    const info = this.modelInfo.get(model);
    const capabilities = getOpenAICompatibleModelCapabilities(info, Boolean(info));
    return { ...capabilities, streaming: Boolean(info) };
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

  async generateRequest(request: AIRequest): Promise<AIResponse> {
    const startedAt = Date.now();
    const body = serializeOpenAICompatibleRequest(request);
    const data = await this.request<OpenAICompatibleChatResponse>("/chat/completions", {
      method: "POST",
      body: JSON.stringify(body),
      ...(request.signal ? { signal: request.signal } : {}),
    }, request.timeoutMs);
    return normalizeOpenAICompatibleResponse(data, this.id, request.model, Date.now() - startedAt);
  }

  async *streamRequest(request: AIRequest): AsyncGenerator<AIStreamEvent> {
    validateCanonicalRequest(request);
    if (!this.modelInfo.has(request.model)) {
      throw new Error("OrcaRouter streaming requires a model verified through the provider catalog");
    }
    const body = serializeOpenAICompatibleRequest({ ...request, stream: false });
    body.stream = true;
    body.stream_options = { include_usage: true };
    const apiKey = this.runtimeApiKey;
    if (!apiKey) throw new Error("ORCAROUTER_API_KEY is not configured");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? this.timeoutMs);
    const callerSignal = request.signal;
    const abortFromCaller = () => controller.abort(callerSignal?.reason);
    if (callerSignal) {
      if (callerSignal.aborted) abortFromCaller();
      else callerSignal.addEventListener("abort", abortFromCaller, { once: true });
    }
    try {
      const response = await this.fetchImpl(this.baseUrl + "/chat/completions", {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(this.httpError(response.status));
      for await (const event of streamOpenAICompatibleChat(response, this.id, request.model)) yield event;
    } catch (error) {
      if (callerSignal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (controller.signal.aborted) throw new Error("OrcaRouter request timed out");
      if (error instanceof Error && error.message.toLowerCase().startsWith(this.id)) throw error;
      throw new Error("OrcaRouter streaming request failed");
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const data = await this.request<ModelsResponse>("/models", { method: "GET", ...(signal ? { signal } : {}) });
    const discovered = new Map<string, OpenAICompatibleModelMetadata>();
    for (const item of data.data ?? []) {
      if (typeof item.id === "string" && item.id.trim().length > 0) discovered.set(item.id.trim(), item);
    }
    this.modelInfo.clear();
    for (const [id, info] of discovered) this.modelInfo.set(id, info);
    return [...discovered.keys()];
  }

  async getStatus(model = this.model, signal?: AbortSignal): Promise<AIProviderStatus> {
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
      const selectedModel = this.validateModel(model);
      const models = await this.listModels(signal);
      const available = models.includes(selectedModel) && this.getCapabilities(selectedModel).text === true;
      return {
        available,
        model: selectedModel,
        latencyMs: Date.now() - startedAt,
        ...(!available ? { error: "Configured model is not a verified text generation model for this API account" } : {}),
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

  private async request<T>(path: string, init: RequestInit, timeoutMs = this.timeoutMs): Promise<T> {
    const apiKey = this.runtimeApiKey;
    if (!apiKey) throw new Error("ORCAROUTER_API_KEY is not configured");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
      if (callerSignal?.aborted) throw new DOMException("Aborted", "AbortError");
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
