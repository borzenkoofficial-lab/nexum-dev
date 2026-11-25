import type {
  AIModelCapabilities,
  AIProvider,
  AIProviderStatus,
  AIRequest,
  AIResponse,
  AIGenerateOptions,
  AIStreamEvent,
} from "../types.js";
import { validateCanonicalRequest } from "../canonical.js";
import {
  normalizeOpenAICompatibleResponse,
  serializeOpenAICompatibleRequest,
  type OpenAICompatibleChatResponse,
  streamOpenAICompatibleChat,
} from "../openaiCompatibleAdapter.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";
const DEFAULT_TIMEOUT_MS = 60_000;

interface OpenRouterModelInfo {
  id?: string;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supported_parameters?: string[];
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
    image?: string;
  };
}

interface OpenRouterModelsResponse {
  data?: OpenRouterModelInfo[];
}

function supported(value: boolean | undefined): boolean | "unknown" {
  return value === true ? true : value === false ? false : "unknown";
}

export class OpenRouterProvider implements AIProvider {
  id = "openrouter";
  name = "OpenRouter";
  protocol = "openai-compatible-chat-completions" as const;
  adapterVersion = "2.0.0";
  model: string;
  capabilities = {
    text: "unknown",
    code: "unknown",
    vision: "unknown",
    toolCalling: "unknown",
    streaming: false,
    structuredOutput: "unknown",
    reasoning: "unknown",
    contextWindow: null,
  } as const;
  private readonly modelInfo = new Map<string, OpenRouterModelInfo>();
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private runtimeApiKey = process.env.OPENROUTER_API_KEY?.trim() || "";

  constructor(
    baseUrl = process.env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL,
    model = DEFAULT_MODEL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = this.validateModel(model);
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  getCapabilities(model = this.model): AIModelCapabilities {
    if (model === "openrouter/free") {
      return {
        text: true,
        code: true,
        vision: "unknown",
        toolCalling: "unknown",
        streaming: false,
        structuredOutput: "unknown",
        reasoning: "unknown",
        contextWindow: null,
      };
    }
    const info = this.modelInfo.get(model);
    const input = info?.architecture?.input_modalities;
    const output = info?.architecture?.output_modalities;
    const parameters = info?.supported_parameters;
    const text = input && output ? input.includes("text") && output.includes("text") : undefined;
    const hasParameter = (...names: string[]) => parameters
      ? names.some((name) => parameters.includes(name))
      : undefined;
    return {
      text: supported(text),
      code: supported(text),
      vision: supported(input ? input.includes("image") : undefined),
      toolCalling: supported(hasParameter("tools", "tool_choice")),
      // OpenRouter documents SSE streaming for all models exposed by its API.
      streaming: Boolean(info),
      structuredOutput: supported(hasParameter("response_format", "structured_outputs")),
      reasoning: supported(hasParameter("reasoning", "reasoning_effort")),
      contextWindow: typeof info?.context_length === "number" && Number.isSafeInteger(info.context_length) && info.context_length > 0
        ? info.context_length
        : null,
    };
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

  async generate(message: string, model = this.model, options: AIGenerateOptions = {}): Promise<string> {
    const selectedModel = this.validateModel(model);
    const data = await this.request<OpenAICompatibleChatResponse>("/chat/completions", {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify({
        model: selectedModel,
        messages: [{ role: "user", content: message }],
        ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      }),
    });
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("OpenRouter returned an invalid response");
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
      throw new Error("OpenRouter streaming requires a model verified through the model catalog");
    }
    const body = serializeOpenAICompatibleRequest({ ...request, stream: false });
    body.stream = true;
    body.stream_options = { include_usage: true };
    const apiKey = this.runtimeApiKey;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

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
          "HTTP-Referer": "https://nexum.dev",
          "X-Title": "КВАРД",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(this.httpError(response.status));
      for await (const event of streamOpenAICompatibleChat(response, this.id, request.model)) yield event;
    } catch (error) {
      if (callerSignal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (controller.signal.aborted) throw new Error("OpenRouter request timed out");
      if (error instanceof Error && error.message.startsWith("OpenRouter")) throw error;
      throw new Error("OpenRouter streaming request failed");
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const data = await this.request<OpenRouterModelsResponse>("/models?output_modalities=text", {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    const discovered = new Map<string, OpenRouterModelInfo>();
    for (const info of data.data ?? []) {
      if (typeof info.id === "string" && info.id.trim().length > 0) {
        discovered.set(info.id.trim(), info);
      }
    }
    this.modelInfo.clear();
    for (const [id, info] of discovered) this.modelInfo.set(id, info);
    return [...discovered.keys()];
  }

  async getStatus(model = this.model, signal?: AbortSignal): Promise<AIProviderStatus> {
    const startedAt = Date.now();
    const selectedModel = this.validateModel(model);
    if (!this.runtimeApiKey) {
      return {
        available: false,
        model: selectedModel,
        latencyMs: Date.now() - startedAt,
        error: "OPENROUTER_API_KEY is not configured. Add an API key in NEXUM Settings.",
      };
    }
    try {
      const models = await this.listModels(signal);
      const available = selectedModel === "openrouter/free"
        ? models.length > 0
        : models.includes(selectedModel) && this.getCapabilities(selectedModel).text === true;
      return {
        available,
        model: selectedModel,
        latencyMs: Date.now() - startedAt,
        ...(!available ? { error: "Configured model is not a verified text generation model for this API account" } : {}),
      };
    } catch (error) {
      return {
        available: false,
        model: selectedModel,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "OpenRouter is unavailable",
      };
    }
  }

  private async request<T>(path: string, init: RequestInit, timeoutMs = this.timeoutMs): Promise<T> {
    const apiKey = this.runtimeApiKey;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
          "HTTP-Referer": "https://nexum.dev",
          "X-Title": "КВАРД",
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(this.httpError(response.status));
      return (await response.json()) as T;
    } catch (error) {
      if (callerSignal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (controller.signal.aborted) throw new Error("OpenRouter request timed out");
      if (error instanceof Error && error.message.startsWith("OpenRouter")) throw error;
      throw new Error("OpenRouter network error");
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
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
