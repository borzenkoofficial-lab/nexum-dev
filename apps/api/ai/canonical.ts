import { NexumError } from "../core/errors.js";
import type {
  AIContentPart,
  AIModelCapabilities,
  AIRequest,
  AIResponse,
  AIUsage,
} from "./types.js";

const MAX_MESSAGES = 100;
const MAX_IMAGE_BASE64_LENGTH = 20 * 1024 * 1024;

function invalidRequest(reason: string): never {
  throw new NexumError("USER_ERROR", "Запрос к AI-модели имеет неверный формат.", {
    status: 400,
    retryable: false,
    technicalDetails: reason,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateContentPart(part: unknown, index: number): asserts part is AIContentPart {
  if (!isRecord(part) || typeof part.type !== "string") {
    invalidRequest(`messages[].content[${index}] must be a content part`);
  }

  if (part.type === "text") {
    if (typeof part.text !== "string" || !part.text.trim()) {
      invalidRequest(`messages[].content[${index}].text must be a non-empty string`);
    }
    return;
  }

  if (part.type !== "image" || !isRecord(part.source) || typeof part.source.type !== "string") {
    invalidRequest(`messages[].content[${index}] has an unsupported content part`);
  }

  if (part.source.type === "url") {
    if (typeof part.source.url !== "string") invalidRequest("Image URL is required");
    let parsed: URL;
    try {
      parsed = new URL(part.source.url);
    } catch {
      invalidRequest("Image URL must be an absolute HTTP(S) URL");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      invalidRequest("Image URL protocol must be HTTP(S)");
    }
    return;
  }

  if (part.source.type === "base64") {
    const mediaType = part.source.mediaType;
    const data = part.source.data;
    if (typeof mediaType !== "string" || !/^image\/(png|jpeg|webp|gif|avif)$/i.test(mediaType)) {
      invalidRequest("Image base64 mediaType is not supported");
    }
    if (typeof data !== "string" || data.length === 0 || data.length > MAX_IMAGE_BASE64_LENGTH || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      invalidRequest("Image base64 data is invalid or too large");
    }
    return;
  }

  invalidRequest("Image source must be url or base64");
}

export function validateCanonicalRequest(request: AIRequest): void {
  if (!isRecord(request) || request.version !== 1) invalidRequest("Only canonical request version 1 is supported");
  if (typeof request.model !== "string" || !request.model.trim() || request.model.length > 200) {
    invalidRequest("model must be a non-empty string of at most 200 characters");
  }
  if (!Array.isArray(request.messages) || request.messages.length === 0 || request.messages.length > MAX_MESSAGES) {
    invalidRequest(`messages must contain between 1 and ${MAX_MESSAGES} items`);
  }

  for (const [index, message] of request.messages.entries()) {
    if (!isRecord(message) || !["system", "developer", "user", "assistant", "tool"].includes(String(message.role))) {
      invalidRequest(`messages[${index}].role is invalid`);
    }
    if (typeof message.content === "string") {
      if (!message.content.trim()) invalidRequest(`messages[${index}].content must not be empty`);
    } else if (Array.isArray(message.content) && message.content.length > 0) {
      message.content.forEach((part, partIndex) => validateContentPart(part, partIndex));
    } else {
      invalidRequest(`messages[${index}].content must be a string or non-empty content parts`);
    }
    if (message.role === "tool" && (typeof message.toolCallId !== "string" || !message.toolCallId.trim())) {
      invalidRequest(`messages[${index}].toolCallId is required for tool messages`);
    }
  }

  if (request.maxTokens !== undefined && (!Number.isInteger(request.maxTokens) || request.maxTokens < 1 || request.maxTokens > 200_000)) {
    invalidRequest("maxTokens must be an integer between 1 and 200000");
  }
  if (request.temperature !== undefined && (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2)) {
    invalidRequest("temperature must be between 0 and 2");
  }
  if (request.topP !== undefined && (!Number.isFinite(request.topP) || request.topP <= 0 || request.topP > 1)) {
    invalidRequest("topP must be greater than 0 and at most 1");
  }
  if (request.timeoutMs !== undefined && (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 600_000)) {
    invalidRequest("timeoutMs must be an integer between 1 and 600000");
  }
  if (request.stopSequences !== undefined && (!Array.isArray(request.stopSequences) || request.stopSequences.length > 16 || request.stopSequences.some((item) => typeof item !== "string" || item.length > 256))) {
    invalidRequest("stopSequences must contain at most 16 strings of at most 256 characters");
  }
  if (request.tools !== undefined && (!Array.isArray(request.tools) || request.tools.some((tool) =>
    !isRecord(tool) || typeof tool.name !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(tool.name) || !isRecord(tool.inputSchema)
  ))) {
    invalidRequest("tools must contain named tools with object inputSchema values");
  }
  if (request.toolChoice !== undefined && !["auto", "none", "required"].includes(String(request.toolChoice)) &&
    !(isRecord(request.toolChoice) && typeof request.toolChoice.name === "string" && request.toolChoice.name.trim())) {
    invalidRequest("toolChoice is invalid");
  }
  if (request.responseFormat !== undefined && request.responseFormat !== "text" && request.responseFormat !== "json" &&
    !(isRecord(request.responseFormat) && request.responseFormat.type === "json_schema" &&
      typeof request.responseFormat.name === "string" && isRecord(request.responseFormat.schema))) {
    invalidRequest("responseFormat is invalid");
  }
}

export function getRequiredCapabilities(request: AIRequest): Partial<AIModelCapabilities> {
  const hasImage = request.messages.some((message) =>
    Array.isArray(message.content) && message.content.some((part) => part.type === "image"),
  );
  const hasTools = Boolean(request.tools?.length) || request.messages.some((message) => message.role === "tool");
  return {
    text: true,
    ...(hasImage ? { vision: true } : {}),
    ...(hasTools ? { toolCalling: true } : {}),
    ...(request.stream ? { streaming: true } : {}),
    ...(request.responseFormat && request.responseFormat !== "text" ? { structuredOutput: true } : {}),
  };
}

function validUsage(usage: AIUsage | undefined): AIUsage | undefined {
  if (!usage || !isRecord(usage)) return undefined;
  const normalized: AIUsage = {};
  for (const key of ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "reasoningTokens"] as const) {
    const value = usage[key];
    if (value !== undefined) {
      if (!Number.isFinite(value) || value < 0) return undefined;
      normalized[key] = value;
    }
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

export function normalizeAIResponse(
  response: AIResponse,
  providerId: string,
  requestedModel: string,
): AIResponse {
  const usage = validUsage(response.usage);
  const contentBlocks = response.contentBlocks?.length
    ? response.contentBlocks
    : response.content
      ? [{ type: "text" as const, text: response.content }]
      : [];
  const content = response.content || contentBlocks
    .filter((part) => part.type === "text")
    .map((part) => part.type === "text" ? part.text : "")
    .join("");

  return {
    ...response,
    content,
    ...(contentBlocks.length ? { contentBlocks } : {}),
    provider: typeof response.provider === "string" && response.provider.trim() ? response.provider : providerId,
    model: typeof response.model === "string" && response.model.trim() ? response.model : requestedModel,
    ...(usage ? { usage } : { usage: undefined }),
    usageSource: response.usageSource ?? (usage ? "provider_reported" : "unavailable"),
  };
}
