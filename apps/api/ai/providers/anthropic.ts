import type {
  AIContentPart,
  AIModelCapabilities,
  AIProvider,
  AIProviderStatus,
  AIRequest,
  AIResponse,
  AIGenerateOptions,
} from "../types.js";
import { validateCanonicalRequest } from "../canonical.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const DEFAULT_API_VERSION = "2026-10-21";

interface AnthropicResponse {
  id?: string;
  type?: string;
  model?: string;
  content?: Array<{
    type?: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>;
  stop_reason?: string | null;
  stop_sequence?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens_details?: { thinking_tokens?: number };
  };
}

interface AnthropicModelInfo {
  id?: string;
  lifecycle?: "active" | "deprecated" | "retired";
  max_input_tokens?: number | null;
  max_tokens?: number | null;
  capabilities?: {
    image_input?: { supported?: boolean };
    structured_outputs?: { supported?: boolean };
    thinking?: { supported?: boolean };
    tool_use?: { supported?: boolean };
  } | null;
}

interface AnthropicModelsResponse {
  data?: AnthropicModelInfo[];
  has_more?: boolean;
  last_id?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function mapContent(content: string | AIContentPart[]): string | Array<Record<string, unknown>> {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    if (part.source.type === "url") {
      throw new Error("Anthropic Messages adapter: URL images are not supported; provide a base64 image source");
    }
    const allowedMediaTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
    if (!allowedMediaTypes.has(part.source.mediaType)) {
      throw new Error("Anthropic Messages adapter: unsupported image media type");
    }
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: part.source.mediaType,
        data: part.source.data,
      },
    };
  });
}

function textOnly(content: string | AIContentPart[]): string {
  if (typeof content === "string") return content;
  const parts: string[] = [];
  for (const part of content) {
    if (part.type !== "text") throw new Error("Anthropic Messages adapter: tool results must contain text only");
    parts.push(part.text);
  }
  return parts.join("\n");
}

export class AnthropicProvider implements AIProvider {
  id = "anthropic";
  name = "Anthropic";
  protocol = "anthropic-messages" as const;
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
  private readonly modelInfo = new Map<string, AnthropicModelInfo>();
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly apiVersion: string;
  private readonly fetchImpl: typeof fetch;
  private runtimeApiKey = process.env.ANTHROPIC_API_KEY?.trim() || "";

  constructor(
    baseUrl = process.env.ANTHROPIC_BASE_URL || DEFAULT_BASE_URL,
    model = DEFAULT_MODEL,
    timeoutMs = 90_000,
    fetchImpl: typeof fetch = fetch,
    apiVersion = process.env.ANTHROPIC_API_VERSION || DEFAULT_API_VERSION,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = this.validateModel(model);
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.apiVersion = apiVersion;
  }

  getCapabilities(model = this.model): AIModelCapabilities {
    const info = this.modelInfo.get(model);
    const active = info?.lifecycle === "active";
    const capability = (value: { supported?: boolean } | undefined): boolean | "unknown" =>
      value?.supported === true ? true : value?.supported === false ? false : "unknown";
    return {
      text: active ? true : "unknown",
      code: active ? true : "unknown",
      vision: capability(info?.capabilities?.image_input),
      toolCalling: capability(info?.capabilities?.tool_use),
      streaming: active,
      structuredOutput: capability(info?.capabilities?.structured_outputs),
      reasoning: capability(info?.capabilities?.thinking),
      contextWindow: validTokenCount(info?.max_input_tokens) ? info.max_input_tokens : null,
    };
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
      signal: options.signal,
      body: JSON.stringify({
        model: this.validateModel(model),
        max_tokens: Math.max(1, options.maxTokens ?? 4096),
        messages: [{ role: "user", content: message }],
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      }),
    });
    const content = (data.content ?? [])
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text as string)
      .join("\n");
    if (!content) throw new Error("Anthropic returned an invalid response");
    return content;
  }

  async generateRequest(request: AIRequest): Promise<AIResponse> {
    validateCanonicalRequest(request);
    if (request.stream) throw new Error("Anthropic Messages adapter does not support streaming through generateRequest");
    if (request.responseFormat === "json") {
      throw new Error("Anthropic Messages adapter: JSON Schema is required for structured output");
    }

    const systemBlocks: Array<{ type: "text"; text: string }> = [];
    const messages: Array<Record<string, unknown>> = [];
    let conversationStarted = false;

    for (const message of request.messages) {
      if (message.role === "system" || message.role === "developer") {
        if (conversationStarted) {
          throw new Error("Anthropic Messages adapter: system and developer messages must precede conversation messages");
        }
        if (typeof message.content === "string") {
          systemBlocks.push({ type: "text", text: message.content });
        } else {
          for (const part of message.content) {
            if (part.type !== "text") throw new Error("Anthropic Messages adapter: system messages cannot contain images");
            systemBlocks.push({ type: "text", text: part.text });
          }
        }
        continue;
      }

      conversationStarted = true;
      if (message.role === "tool") {
        messages.push({
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: message.toolCallId,
            content: textOnly(message.content),
          }],
        });
        continue;
      }

      const content = typeof message.content === "string" ? message.content : mapContent(message.content);
      if (message.toolCalls?.length) {
        const blocks: Array<Record<string, unknown>> = typeof content === "string"
          ? (content ? [{ type: "text", text: content }] : [])
          : [...content];
        for (const call of message.toolCalls) {
          blocks.push({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: call.arguments,
          });
        }
        messages.push({ role: message.role, content: blocks });
      } else if (typeof content === "string" ? content.length > 0 : content.length > 0) {
        messages.push({ role: message.role, content });
      }
    }

    const body: Record<string, unknown> = {
      model: this.validateModel(request.model),
      max_tokens: Math.max(1, request.maxTokens ?? 4096),
      messages,
    };
    if (systemBlocks.length) body.system = systemBlocks;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.topP !== undefined) body.top_p = request.topP;
    if (request.stopSequences?.length) body.stop_sequences = request.stopSequences;
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        input_schema: tool.inputSchema,
      }));
    }
    if (request.toolChoice !== undefined) {
      if (typeof request.toolChoice === "object") {
        body.tool_choice = { type: "tool", name: request.toolChoice.name };
      } else {
        body.tool_choice = {
          type: request.toolChoice === "required" ? "any" : request.toolChoice,
        };
      }
    }
    if (request.responseFormat && request.responseFormat !== "text") {
      body.output_config = {
        format: {
          type: "json_schema",
          schema: request.responseFormat.schema,
        },
      };
    }

    const startedAt = Date.now();
    const data = await this.request<AnthropicResponse>("/messages", {
      method: "POST",
      body: JSON.stringify(body),
      ...(request.signal ? { signal: request.signal } : {}),
    }, request.timeoutMs);

    if (data.type !== "message" || !Array.isArray(data.content)) {
      throw new Error("Anthropic Messages returned an invalid response");
    }

    const textParts: string[] = [];
    const toolCalls = [];
    for (const block of data.content) {
      if (block.type === "text" && typeof block.text === "string") {
        textParts.push(block.text);
      } else if (block.type === "tool_use") {
        if (typeof block.id !== "string" || typeof block.name !== "string" || !isRecord(block.input)) {
          throw new Error("Anthropic Messages returned invalid tool input");
        }
        toolCalls.push({ id: block.id, name: block.name, arguments: block.input });
      }
    }

    const usage: AIResponse["usage"] = data.usage ? {
      ...(validTokenCount(data.usage.input_tokens) ? { inputTokens: data.usage.input_tokens } : {}),
      ...(validTokenCount(data.usage.output_tokens) ? { outputTokens: data.usage.output_tokens } : {}),
      ...(validTokenCount(data.usage.cache_read_input_tokens) ? { cachedInputTokens: data.usage.cache_read_input_tokens } : {}),
      ...(validTokenCount(data.usage.cache_creation_input_tokens) ? { cacheCreationInputTokens: data.usage.cache_creation_input_tokens } : {}),
      ...(validTokenCount(data.usage.output_tokens_details?.thinking_tokens) ? { reasoningTokens: data.usage.output_tokens_details.thinking_tokens } : {}),
    } : undefined;
    const completeUsage = validTokenCount(data.usage?.input_tokens) &&
      validTokenCount(data.usage?.output_tokens) &&
      validTokenCount(data.usage?.cache_read_input_tokens) &&
      validTokenCount(data.usage?.cache_creation_input_tokens);
    const usageWithTotal = usage && completeUsage
      ? {
          ...usage,
          totalTokens:
            (data.usage?.input_tokens ?? 0) +
            (data.usage?.output_tokens ?? 0) +
            (data.usage?.cache_read_input_tokens ?? 0) +
            (data.usage?.cache_creation_input_tokens ?? 0),
        }
      : usage;

    const content = textParts.join("\n");
    return {
      content,
      ...(content ? { contentBlocks: [{ type: "text", text: content }] } : {}),
      provider: this.id,
      model: typeof data.model === "string" && data.model.trim() ? data.model : request.model,
      ...(typeof data.id === "string" ? { requestId: data.id } : {}),
      ...(usageWithTotal && Object.keys(usageWithTotal).length ? { usage: usageWithTotal } : {}),
      usageSource: completeUsage ? "provider_reported" as const : "unavailable" as const,
      ...(toolCalls.length ? { toolCalls } : {}),
      ...(typeof data.stop_reason === "string" ? { finishReason: data.stop_reason } : {}),
      ...(typeof data.stop_sequence === "string" ? { stopSequence: data.stop_sequence } : {}),
      latencyMs: Date.now() - startedAt,
    };
  }

  async *streamRequest(request: AIRequest): AsyncGenerator<import("../types.js").AIStreamEvent> {
    validateCanonicalRequest({ ...request, stream: true });
    if (request.responseFormat === "json") {
      throw new Error("Anthropic Messages adapter: JSON Schema is required for structured output");
    }
    const model = this.validateModel(request.model);
    const system: Array<{ type: "text"; text: string }> = [];
    const messages: Array<Record<string, unknown>> = [];
    let started = false;
    for (const message of request.messages) {
      if (message.role === "system" || message.role === "developer") {
        if (started) throw new Error("Anthropic system messages must precede conversation messages");
        if (typeof message.content === "string") system.push({ type: "text", text: message.content });
        else for (const part of message.content) {
          if (part.type !== "text") throw new Error("Anthropic system messages cannot contain images");
          system.push({ type: "text", text: part.text });
        }
      } else {
        started = true;
        if (message.role === "tool") messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: message.toolCallId, content: textOnly(message.content) }] });
        else {
          const content = typeof message.content === "string" ? message.content : mapContent(message.content);
          const blocks: Array<Record<string, unknown>> = typeof content === "string" ? (content ? [{ type: "text", text: content }] : []) : [...content];
          for (const call of message.toolCalls ?? []) blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
          if (blocks.length) messages.push({ role: message.role, content: blocks });
        }
      }
    }
    const body: Record<string, unknown> = { model, max_tokens: request.maxTokens ?? 4096, messages, stream: true };
    if (system.length) body.system = system;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.topP !== undefined) body.top_p = request.topP;
    if (request.stopSequences?.length) body.stop_sequences = request.stopSequences;
    if (request.tools?.length) body.tools = request.tools.map((tool) => ({ name: tool.name, ...(tool.description ? { description: tool.description } : {}), input_schema: tool.inputSchema }));
    if (request.toolChoice !== undefined) body.tool_choice = typeof request.toolChoice === "object" ? { type: "tool", name: request.toolChoice.name } : { type: request.toolChoice === "required" ? "any" : request.toolChoice };
    if (request.responseFormat && request.responseFormat !== "text") body.output_config = { format: { type: "json_schema", schema: request.responseFormat.schema } };
    const key = this.runtimeApiKey;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not configured");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? this.timeoutMs);
    const abort = () => controller.abort(request.signal?.reason);
    if (request.signal) {
      if (request.signal.aborted) abort();
      else request.signal.addEventListener("abort", abort, { once: true });
    }
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let messageStopped = false;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/messages`, {
        method: "POST", headers: { Accept: "text/event-stream", "Content-Type": "application/json", "x-api-key": key, "anthropic-version": this.apiVersion },
        body: JSON.stringify(body), signal: controller.signal,
      });
      if (!response.ok) throw new Error(this.httpError(response.status));
      if (!response.body) throw new Error("Anthropic streaming response has no body");
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", eventName = "", data = "";
      let inputTokens: number | undefined, outputTokens: number | undefined;
      let finishReason: string | undefined, stopSequence: string | undefined;
      let resolvedModel = model, requestId: string | undefined;
      const tools = new Map<number, { id: string; name: string }>();
      const emit = (name: string, raw: string): import("../types.js").AIStreamEvent[] => {
        if (!raw) return [];
        const p = JSON.parse(raw) as Record<string, any>;
        if (name === "message_start") {
          resolvedModel = typeof p.message?.model === "string" ? p.message.model : model;
          requestId = typeof p.message?.id === "string" ? p.message.id : undefined;
          inputTokens = validTokenCount(p.message?.usage?.input_tokens) ? p.message.usage.input_tokens : undefined;
          return [{ type: "message_start", provider: this.id, model: resolvedModel, ...(requestId ? { requestId } : {}) }];
        }
        if (name === "content_block_start" && p.content_block?.type === "tool_use") {
          const index = Number(p.index), tool = { id: String(p.content_block.id ?? ""), name: String(p.content_block.name ?? "") };
          if (!Number.isInteger(index) || index < 0 || !tool.id || !/^[A-Za-z0-9_-]{1,64}$/.test(tool.name)) throw new Error("Invalid Anthropic tool call header");
          tools.set(index, tool); return [{ type: "tool_call_start", index, ...tool }];
        }
        if (name === "content_block_delta") {
          const index = Number(p.index);
          if (p.delta?.type === "text_delta" && typeof p.delta.text === "string") return [{ type: "text_delta", text: p.delta.text }];
          if (p.delta?.type === "input_json_delta" && typeof p.delta.partial_json === "string" && tools.has(index)) return [{ type: "tool_call_delta", index, argumentsDelta: p.delta.partial_json }];
        }
        if (name === "message_delta") {
          if (validTokenCount(p.usage?.output_tokens)) outputTokens = p.usage.output_tokens;
          if (typeof p.delta?.stop_reason === "string") finishReason = p.delta.stop_reason;
          if (typeof p.delta?.stop_sequence === "string") stopSequence = p.delta.stop_sequence;
        }
        if (name === "message_stop") {
          messageStopped = true;
          return [
            inputTokens !== undefined && outputTokens !== undefined
              ? { type: "usage", usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }, source: "provider_reported" }
              : { type: "usage", usage: {}, source: "unavailable" },
            { type: "message_end", ...(finishReason ? { finishReason } : {}), ...(stopSequence ? { stopSequence } : {}) },
          ];
        }
        if (name === "error") throw new Error("Anthropic stream returned an error event");
        return [];
      };
      while (true) {
        const part = await reader.read();
        buffer += decoder.decode(part.value, { stream: !part.done });
        const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).trimStart();
          else if (!line) { for (const event of emit(eventName, data)) yield event; eventName = ""; data = ""; }
        }
        if (part.done) break;
      }
      if (buffer.startsWith("event:")) eventName = buffer.slice(6).trim();
      else if (buffer.startsWith("data:")) data += (data ? "\\n" : "") + buffer.slice(5).trimStart();
      if (data) for (const event of emit(eventName, data)) yield event;
      if (!messageStopped) throw new Error("Anthropic stream ended before message_stop");
    } catch (error) {
      if (request.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (controller.signal.aborted) throw new Error("Anthropic request timed out");
      throw error instanceof Error ? error : new Error("Anthropic streaming request failed");
    } finally {
      if (reader) {
        try { await reader.cancel(); } catch { /* stream may already be closed */ }
        reader.releaseLock();
      }
      clearTimeout(timeout); request.signal?.removeEventListener("abort", abort);
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    if (!this.runtimeApiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    const discovered = new Map<string, AnthropicModelInfo>();
    let cursor: string | null = null;
    const maxPages = 20;
    for (let page = 0; page < maxPages; page += 1) {
      const params = new URLSearchParams({ lifecycle: "active", limit: "1000" });
      if (cursor) params.set("after_id", cursor);
      const data = await this.request<AnthropicModelsResponse>(`/models?${params.toString()}`, {
        method: "GET",
        ...(signal ? { signal } : {}),
      });
      for (const item of data.data ?? []) {
        if (typeof item.id === "string" && /^claude-/i.test(item.id) && item.lifecycle === "active") {
          discovered.set(item.id, item);
        }
      }
      if (!data.has_more) {
        this.modelInfo.clear();
        for (const [id, info] of discovered) this.modelInfo.set(id, info);
        return [...discovered.keys()];
      }
      if (!data.last_id || data.last_id === cursor) {
        throw new Error("Anthropic model catalog pagination returned an invalid cursor");
      }
      cursor = data.last_id;
    }
    throw new Error("Anthropic model catalog exceeded the safe pagination limit");
  }

  async getStatus(model = this.model, signal?: AbortSignal): Promise<AIProviderStatus> {
    const startedAt = Date.now();
    const selectedModel = this.validateModel(model);
    if (!this.runtimeApiKey) {
      return {
        available: false,
        model: selectedModel,
        latencyMs: Date.now() - startedAt,
        error: "ANTHROPIC_API_KEY is not configured. Add an API key in NEXUM Settings.",
      };
    }
    try {
      const models = await this.listModels(signal);
      const available = models.includes(selectedModel) && this.getCapabilities(selectedModel).text === true;
      return {
        available,
        model: selectedModel,
        latencyMs: Date.now() - startedAt,
        ...(!available ? { error: "Configured model is not a verified Claude text generation model for this API account" } : {}),
      };
    } catch (error) {
      return {
        available: false,
        model: selectedModel,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Anthropic is unavailable",
      };
    }
  }

  private async request<T>(path: string, init: RequestInit, timeoutMs = this.timeoutMs): Promise<T> {
    const apiKey = this.runtimeApiKey;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
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
          "Content-Type": "application/json",
           "x-api-key": apiKey,
          "anthropic-version": this.apiVersion,
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(this.httpError(response.status));
      return (await response.json()) as T;
    } catch (error) {
      if (callerSignal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (controller.signal.aborted) throw new Error("Anthropic request timed out");
      if (error instanceof Error && error.message.startsWith("Anthropic")) throw error;
      throw new Error("Anthropic network error");
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
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
    if (!value || value.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
      throw new Error("Anthropic model name is invalid");
    }
    return value;
  }
}
