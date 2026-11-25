import type { AIContentPart, AIRequest, AIResponse, AIStreamEvent } from "./types.js";
import { validateCanonicalRequest } from "./canonical.js";

export interface OpenAICompatibleChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | Array<Record<string, unknown>> | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string | Record<string, unknown> };
      }>;
      images?: Array<{ type?: string; image_url?: { url?: string } }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

function toOpenAIContent(content: string | AIContentPart[]): string | Array<Record<string, unknown>> {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    const url = part.source.type === "url"
      ? part.source.url
      : `data:${part.source.mediaType};base64,${part.source.data}`;
    return { type: "image_url", image_url: { url } };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArguments(value: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (typeof value === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error("OpenAI-compatible provider returned invalid function arguments");
    }
    if (!isRecord(parsed)) throw new Error("OpenAI-compatible provider returned invalid function arguments");
    return parsed;
  }
  if (isRecord(value)) return value;
  throw new Error("OpenAI-compatible provider returned invalid function arguments");
}

export function serializeOpenAICompatibleRequest(request: AIRequest): Record<string, unknown> {
  validateCanonicalRequest(request);
  if (request.stream) throw new Error("OpenAI-compatible adapter does not support streaming through generateRequest");

  const messages = request.messages.map((message) => {
    if (message.role === "tool") {
      const content = typeof message.content === "string"
        ? message.content
        : message.content.map((part) => {
          if (part.type !== "text") throw new Error("OpenAI-compatible tool output cannot contain images");
          return part.text;
        }).join("\n");
      return { role: "tool", tool_call_id: message.toolCallId, content };
    }

    const content = toOpenAIContent(message.content);
    const toolCalls = message.toolCalls?.map((call) => ({
      id: call.id,
      type: "function",
      function: {
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      },
    }));
    return {
      role: message.role,
      content,
      ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
    };
  });

  const body: Record<string, unknown> = {
    model: request.model,
    messages,
  };
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.topP !== undefined) body.top_p = request.topP;
  if (request.stopSequences?.length) body.stop = request.stopSequences;
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parameters: tool.inputSchema,
      },
    }));
  }
  if (request.toolChoice !== undefined) {
    body.tool_choice = typeof request.toolChoice === "object"
      ? { type: "function", function: { name: request.toolChoice.name } }
      : request.toolChoice;
  }
  if (request.responseFormat === "json") {
    body.response_format = { type: "json_object" };
  } else if (request.responseFormat && request.responseFormat !== "text") {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: request.responseFormat.name,
        schema: request.responseFormat.schema,
        strict: request.responseFormat.strict ?? false,
      },
    };
  }
  return body;
}

export function normalizeOpenAICompatibleResponse(
  data: OpenAICompatibleChatResponse,
  provider: string,
  requestedModel: string,
  latencyMs: number,
): AIResponse {
  const choice = data.choices?.[0];
  const message = choice?.message;
  if (!message) throw new Error("OpenAI-compatible provider returned an invalid response");

  const textParts: string[] = [];
  const contentBlocks: AIContentPart[] = [];
  if (typeof message.content === "string") {
    if (message.content) {
      textParts.push(message.content);
      contentBlocks.push({ type: "text", text: message.content });
    }
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === "text" && typeof part.text === "string") {
        textParts.push(part.text);
        contentBlocks.push({ type: "text", text: part.text });
      } else if (part.type === "image_url" && isRecord(part.image_url) && typeof part.image_url.url === "string") {
        contentBlocks.push({ type: "image", source: { type: "url", url: part.image_url.url } });
      }
    }
  }
  for (const image of message.images ?? []) {
    if (image.type === "image_url" && typeof image.image_url?.url === "string") {
      contentBlocks.push({ type: "image", source: { type: "url", url: image.image_url.url } });
    }
  }

  const toolCalls = (message.tool_calls ?? []).map((call) => {
    if (typeof call.id !== "string" || typeof call.function?.name !== "string") {
      throw new Error("OpenAI-compatible provider returned an invalid tool call");
    }
    return {
      id: call.id,
      name: call.function.name,
      arguments: parseArguments(call.function.arguments),
    };
  });

  const usage = data.usage ? {
    ...(typeof data.usage.prompt_tokens === "number" ? { inputTokens: data.usage.prompt_tokens } : {}),
    ...(typeof data.usage.completion_tokens === "number" ? { outputTokens: data.usage.completion_tokens } : {}),
    ...(typeof data.usage.total_tokens === "number" ? { totalTokens: data.usage.total_tokens } : {}),
    ...(typeof data.usage.prompt_tokens_details?.cached_tokens === "number" ? { cachedInputTokens: data.usage.prompt_tokens_details.cached_tokens } : {}),
    ...(typeof data.usage.completion_tokens_details?.reasoning_tokens === "number" ? { reasoningTokens: data.usage.completion_tokens_details.reasoning_tokens } : {}),
  } : undefined;
  const completeUsage = typeof data.usage?.prompt_tokens === "number" &&
    Number.isSafeInteger(data.usage.prompt_tokens) && data.usage.prompt_tokens >= 0 &&
    typeof data.usage?.completion_tokens === "number" &&
    Number.isSafeInteger(data.usage.completion_tokens) && data.usage.completion_tokens >= 0 &&
    typeof data.usage?.total_tokens === "number" &&
    Number.isSafeInteger(data.usage.total_tokens) && data.usage.total_tokens >= 0;

  return {
    content: textParts.join("\n"),
    ...(contentBlocks.length ? { contentBlocks } : {}),
    provider,
    model: typeof data.model === "string" && data.model.trim() ? data.model : requestedModel,
    ...(typeof data.id === "string" ? { requestId: data.id } : {}),
    ...(usage && Object.keys(usage).length ? { usage } : {}),
    usageSource: completeUsage ? "provider_reported" : "unavailable",
    ...(toolCalls.length ? { toolCalls } : {}),
    ...(typeof choice?.finish_reason === "string" ? { finishReason: choice.finish_reason } : {}),
    latencyMs,
  };
}


export interface OpenAICompatibleModelMetadata {
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supported_parameters?: string[];
  context_length?: number;
}

export function getOpenAICompatibleModelCapabilities(
  info: OpenAICompatibleModelMetadata | undefined,
  assumeTextForListedModel = false,
): import("./types.js").AIModelCapabilities {
  const input = info?.architecture?.input_modalities;
  const output = info?.architecture?.output_modalities;
  const parameters = info?.supported_parameters;
  const text = input && output
    ? input.includes("text") && output.includes("text")
    : assumeTextForListedModel ? true : undefined;
  const hasParameter = (...names: string[]) => parameters
    ? names.some((name) => parameters.includes(name))
    : undefined;
  return {
    text: text === true ? true : text === false ? false : "unknown",
    code: text === true ? true : text === false ? false : "unknown",
    vision: input ? input.includes("image") : "unknown",
    toolCalling: hasParameter("tools", "tool_choice") ?? "unknown",
    streaming: false,
    structuredOutput: hasParameter("response_format", "structured_outputs") ?? "unknown",
    reasoning: hasParameter("reasoning", "reasoning_effort") ?? "unknown",
    contextWindow: typeof info?.context_length === "number" &&
      Number.isSafeInteger(info.context_length) && info.context_length > 0
      ? info.context_length
      : null,
  };
}


/**
 * Parse OpenAI-compatible Chat Completions SSE into the canonical event contract.
 * The caller owns HTTP status handling, authentication, timeout and AbortSignal wiring.
 */
export async function* streamOpenAICompatibleChat(
  response: Response,
  provider: string,
  requestedModel: string,
): AsyncGenerator<AIStreamEvent> {
  if (!response.body) throw new Error(provider + " stream has no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];
  let started = false;
  let requestId = response.headers.get("X-Generation-Id") ?? undefined;
  let resolvedModel = requestedModel;
  let usageEvent: AIStreamEvent = { type: "usage", usage: {}, source: "unavailable" };
  let finishReason: string | undefined;
  let terminal = false;
  const toolStates = new Map<number, { id: string; name: string; started: boolean; pendingArguments: string }>();

  const emitPayload = (raw: string): AIStreamEvent[] => {
    if (!raw) return [];
    if (raw === "[DONE]") {
      if (!started) throw new Error(provider + " stream ended before its first response chunk");
      if (!finishReason) throw new Error(provider + " stream ended without a finish reason");
      terminal = true;
      return [usageEvent, { type: "message_end", finishReason }];
    }
    let payload: Record<string, any>;
    try { payload = JSON.parse(raw) as Record<string, any>; }
    catch { throw new Error(provider + " returned an invalid streaming event"); }
    if (payload.error) throw new Error(provider + " stream failed during generation");
    const events: AIStreamEvent[] = [];
    if (!started) {
      started = true;
      if (typeof payload.id === "string") requestId = payload.id;
      if (typeof payload.model === "string") resolvedModel = payload.model;
      events.push({ type: "message_start", provider, model: resolvedModel, ...(requestId ? { requestId } : {}) });
    }
    const usage = payload.usage;
    const valid = (value: unknown): value is number =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    if (valid(usage?.prompt_tokens) && valid(usage?.completion_tokens) && valid(usage?.total_tokens)) {
      usageEvent = {
        type: "usage",
        usage: {
          inputTokens: usage.prompt_tokens,
          outputTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
          ...(valid(usage.prompt_tokens_details?.cached_tokens) ? { cachedInputTokens: usage.prompt_tokens_details.cached_tokens } : {}),
          ...(valid(usage.completion_tokens_details?.reasoning_tokens) ? { reasoningTokens: usage.completion_tokens_details.reasoning_tokens } : {}),
        },
        source: "provider_reported",
      };
    }
    const choice = payload.choices?.[0];
    const delta = choice?.delta;
    if (typeof delta?.content === "string" && delta.content) events.push({ type: "text_delta", text: delta.content });
    if (Array.isArray(delta?.tool_calls)) {
      for (const part of delta.tool_calls) {
        const index = part?.index;
        if (!Number.isInteger(index) || index < 0 || index > 31) throw new Error(provider + " returned an invalid tool call index");
        const state = toolStates.get(index) ?? { id: "", name: "", started: false, pendingArguments: "" };
        if (typeof part.id === "string") state.id += part.id;
        if (typeof part.function?.name === "string") state.name += part.function.name;
        if (!state.started && state.id && state.name) {
          if (!/^[A-Za-z0-9_-]{1,64}$/.test(state.name)) throw new Error(provider + " returned an invalid tool name");
          state.started = true;
          events.push({ type: "tool_call_start", index, id: state.id, name: state.name });
          if (state.pendingArguments) {
            events.push({ type: "tool_call_delta", index, argumentsDelta: state.pendingArguments });
            state.pendingArguments = "";
          }
        }
        if (typeof part.function?.arguments === "string" && part.function.arguments) {
          if (state.started) events.push({ type: "tool_call_delta", index, argumentsDelta: part.function.arguments });
          else state.pendingArguments += part.function.arguments;
        }
        toolStates.set(index, state);
      }
    }
    if (choice?.finish_reason === "error") throw new Error(provider + " stream failed during generation");
    if (typeof choice?.finish_reason === "string") finishReason = choice.finish_reason;
    return events;
  };

  const processLine = (line: string): AIStreamEvent[] => {
    if (line.startsWith(":")) return [];
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
      return [];
    }
    if (line === "") {
      const raw = dataLines.join("\n");
      dataLines = [];
      return emitPayload(raw);
    }
    return [];
  };

  try {
    while (true) {
      const part = await reader.read();
      buffer += decoder.decode(part.value, { stream: !part.done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) for (const event of processLine(line)) yield event;
      if (part.done) break;
    }
    if (buffer) for (const event of processLine(buffer)) yield event;
    if (dataLines.length) for (const event of emitPayload(dataLines.join("\n"))) yield event;
    if (!terminal) throw new Error(provider + " stream ended before [DONE]");
  } finally {
    try { await reader.cancel(); } catch { /* stream may already be closed */ }
    reader.releaseLock();
  }
}
