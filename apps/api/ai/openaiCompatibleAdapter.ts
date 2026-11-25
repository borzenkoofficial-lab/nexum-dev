import type { AIContentPart, AIRequest, AIResponse } from "./types.js";
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
