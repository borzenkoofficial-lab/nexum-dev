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

interface AnthropicModelsResponse {
  data?: Array<{ id?: string }>;
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
    text: true,
    code: true,
    vision: "unknown",
    toolCalling: "unknown",
    streaming: false,
    structuredOutput: "unknown",
    reasoning: "unknown",
    contextWindow: null,
  } as const;
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
    const isClaudeModel = /^claude-/i.test(model);
    return {
      text: isClaudeModel,
      code: isClaudeModel,
      vision: "unknown",
      toolCalling: "unknown",
      streaming: false,
      structuredOutput: "unknown",
      reasoning: "unknown",
      contextWindow: null,
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

  async listModels(signal?: AbortSignal): Promise<string[]> {
    if (!this.runtimeApiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    const data = await this.request<AnthropicModelsResponse>("/models?limit=1000", {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    const ids = (data.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string" && /^claude-/i.test(id));
    return [...new Set(ids)];
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
          Authorization: `Bearer ${apiKey}`,
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
