import type { AIProvider, AIProviderStatus, AIGenerateOptions, AIRequest, AIResponse, AIModelCapabilities, AIContentPart } from "../types.js";
import { validateCanonicalRequest } from "../canonical.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5";
interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface OpenAIModelsResponse {
  data?: Array<{ id?: string }>;
}

interface OpenAIResponsesResponse {
  id?: string;
  status?: string;
  model?: string;
  output?: Array<{
    type?: string;
    role?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
    call_id?: string;
    name?: string;
    arguments?: string;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
  incomplete_details?: { reason?: string } | null;
  error?: { message?: string } | null;
}

function toResponsesContent(content: string | AIContentPart[]): string | Array<Record<string, unknown>> {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") return { type: "input_text", text: part.text };
    const imageUrl = part.source.type === "url"
      ? part.source.url
      : `data:${part.source.mediaType};base64,${part.source.data}`;
    return { type: "input_image", image_url: imageUrl };
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKnownTextGenerationModel(model: string): boolean {
  const id = model.toLowerCase();
  if (/^(gpt-(image|realtime|audio|embedding|moderation)|text-embedding|whisper|omni-moderation)/.test(id)) return false;
  return /^gpt-/.test(id) || /^o[134](?:-|$)/.test(id) || id === "chat-latest";
}

export class OpenAIProvider implements AIProvider {
  id = "openai";
  name = "OpenAI";
  protocol = "openai-responses" as const;
  legacyProtocol = "openai-chat-completions" as const;
  adapterVersion = "2.0.0";
  model: string;
  capabilities = { text: true, code: true, vision: "unknown", toolCalling: "unknown", streaming: false, structuredOutput: "unknown", reasoning: "unknown", contextWindow: null } as const;

  getCapabilities(model = this.model): AIModelCapabilities {
    const knownTextModel = isKnownTextGenerationModel(model);
    return {
      text: knownTextModel ? true : "unknown",
      code: knownTextModel ? true : "unknown",
      vision: "unknown",
      toolCalling: "unknown",
      streaming: false,
      structuredOutput: "unknown",
      reasoning: "unknown",
      contextWindow: null,
    };
  }
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

  async generate(message: string, model = this.model, options: AIGenerateOptions = {}): Promise<string> {
    const data = await this.request<OpenAIChatResponse>("/chat/completions", {
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
    if (typeof content !== "string") throw new Error("OpenAI returned an invalid response");
    return content;
  }

  async generateRequest(request: AIRequest): Promise<AIResponse> {
    validateCanonicalRequest(request);
    if (request.stream) throw new Error("OpenAI Responses adapter does not support streaming through generateRequest");
    if (request.stopSequences?.length) throw new Error("OpenAI Responses adapter: stop sequences are not supported by this endpoint contract");

    const input: Array<Record<string, unknown>> = [];
    for (const message of request.messages) {
      if (message.role === "tool") {
        const output = typeof message.content === "string"
          ? message.content
          : message.content.map((part) => {
            if (part.type !== "text") throw new Error("OpenAI Responses adapter: tool output cannot contain images");
            return part.text;
          }).join("\n");
        input.push({ type: "function_call_output", call_id: message.toolCallId, output });
        continue;
      }

      const content = typeof message.content === "string" ? message.content : toResponsesContent(message.content);
      if ((typeof content === "string" && content.length > 0) || (Array.isArray(content) && content.length > 0)) {
        input.push({ role: message.role, content });
      }
      if (message.toolCalls?.length) {
        for (const call of message.toolCalls) {
          input.push({
            type: "function_call",
            call_id: call.id,
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          });
        }
      }
    }

    const body: Record<string, unknown> = {
      model: this.validateModel(request.model),
      input,
    };
    if (request.maxTokens !== undefined) body.max_output_tokens = request.maxTokens;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.topP !== undefined) body.top_p = request.topP;
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: "function",
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parameters: tool.inputSchema,
      }));
    }
    if (request.toolChoice !== undefined) {
      body.tool_choice = typeof request.toolChoice === "object"
        ? { type: "function", name: request.toolChoice.name }
        : request.toolChoice;
    }
    if (request.responseFormat === "json") {
      body.text = { format: { type: "json_object" } };
    } else if (request.responseFormat && request.responseFormat !== "text") {
      body.text = {
        format: {
          type: "json_schema",
          name: request.responseFormat.name,
          schema: request.responseFormat.schema,
          strict: request.responseFormat.strict ?? false,
        },
      };
    }

    const startedAt = Date.now();
    const headers: Record<string, string> = {};
    if (request.metadata?.idempotencyKey) headers["Idempotency-Key"] = request.metadata.idempotencyKey;
    const data = await this.request<OpenAIResponsesResponse>("/responses", {
      method: "POST",
      body: JSON.stringify(body),
      ...(request.signal ? { signal: request.signal } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
    }, request.timeoutMs);

    if (!Array.isArray(data.output)) throw new Error("OpenAI Responses returned an invalid response");
    if (data.error?.message) throw new Error("OpenAI Responses returned an unsuccessful response");
    const textParts: string[] = [];
    const toolCalls = [];
    for (const item of data.output) {
      if (item.type === "message") {
        for (const part of item.content ?? []) {
          if (part.type === "output_text" && typeof part.text === "string") textParts.push(part.text);
          else if (part.type === "refusal" && typeof part.refusal === "string") textParts.push(part.refusal);
        }
      } else if (item.type === "function_call") {
        let args: unknown;
        try {
          args = JSON.parse(item.arguments ?? "");
        } catch {
          throw new Error("OpenAI Responses returned invalid function arguments");
        }
        if (!isObject(args) || typeof item.call_id !== "string" || typeof item.name !== "string") {
          throw new Error("OpenAI Responses returned invalid function arguments");
        }
        toolCalls.push({ id: item.call_id, name: item.name, arguments: args });
      }
    }

    const usage = data.usage ? {
      ...(typeof data.usage.input_tokens === "number" ? { inputTokens: data.usage.input_tokens } : {}),
      ...(typeof data.usage.output_tokens === "number" ? { outputTokens: data.usage.output_tokens } : {}),
      ...(typeof data.usage.total_tokens === "number" ? { totalTokens: data.usage.total_tokens } : {}),
      ...(typeof data.usage.input_tokens_details?.cached_tokens === "number" ? { cachedInputTokens: data.usage.input_tokens_details.cached_tokens } : {}),
      ...(typeof data.usage.output_tokens_details?.reasoning_tokens === "number" ? { reasoningTokens: data.usage.output_tokens_details.reasoning_tokens } : {}),
    } : undefined;
    const content = textParts.join("\n");
    return {
      content,
      ...(content ? { contentBlocks: [{ type: "text", text: content }] } : {}),
      provider: this.id,
      model: typeof data.model === "string" && data.model.trim() ? data.model : request.model,
      ...(typeof data.id === "string" ? { requestId: data.id } : {}),
      ...(usage && Object.keys(usage).length ? { usage, usageSource: "provider_reported" as const } : { usageSource: "unavailable" as const }),
      ...(toolCalls.length ? { toolCalls } : {}),
      ...(typeof data.status === "string" ? { finishReason: data.status } : data.incomplete_details?.reason ? { finishReason: data.incomplete_details.reason } : {}),
      latencyMs: Date.now() - startedAt,
    };
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const data = await this.request<OpenAIModelsResponse>("/models", { method: "GET", ...(signal ? { signal } : {}) });
    const remote = (data.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0 && id.length <= 200)
      .map((id) => id.trim());
    return [...new Set(remote)];
  }

  async getStatus(model = this.model, signal?: AbortSignal): Promise<AIProviderStatus> {
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
      const models = await this.listModels(signal);
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

  private async request<T>(path: string, init: RequestInit, timeoutMs = this.timeoutMs): Promise<T> {
    const apiKey = this.runtimeApiKey;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

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
      if (controller.signal.aborted) throw new Error("OpenAI request timed out");
      if (error instanceof Error && error.message.startsWith("OpenAI")) throw error;
      throw new Error("OpenAI network error");
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
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
