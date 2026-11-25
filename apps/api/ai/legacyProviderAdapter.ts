import { NexumError } from "../core/errors.js";
import { normalizeAIResponse, validateCanonicalRequest } from "./canonical.js";
import type { AIProvider, AIRequest, AIResponse } from "./types.js";

function unsupported(reason: string): never {
  throw new NexumError("MODEL_ERROR", "Выбранный AI-провайдер не поддерживает одну из функций этого запроса.", {
    status: 400,
    retryable: false,
    technicalDetails: `Legacy adapter cannot represent this request: ${reason}`,
  });
}

/**
 * Transitional bridge for providers that only implement generate(string).
 * It deliberately supports a narrow text-only subset instead of silently
 * dropping structured messages, tools, images, streaming or output modes.
 */
export async function generateWithLegacyProvider(
  provider: AIProvider,
  request: AIRequest,
): Promise<AIResponse> {
  validateCanonicalRequest(request);

  const legacyGenerate = provider.generate;
  if (typeof legacyGenerate !== "function") {
    throw new NexumError("CONFIG_ERROR", "Переходный адаптер недоступен для этого AI-провайдера.", {
      retryable: false,
      technicalDetails: `Provider ${provider.id} does not implement legacy generate()`,
    });
  }
  if (provider.capabilities.text !== true) unsupported("text generation is not explicitly declared");
  if (request.messages.some((message) => message.role === "developer" || message.role === "tool")) {
    unsupported("developer and tool message roles require a native canonical adapter");
  }
  if (request.messages.some((message) => message.toolCalls?.length)) {
    unsupported("assistant tool-call history requires a native canonical adapter");
  }
  if (request.messages.some((message) => Array.isArray(message.content))) {
    unsupported("multimodal content requires a native canonical adapter");
  }
  if (request.tools?.length || (request.toolChoice !== undefined && request.toolChoice !== "none")) {
    unsupported("tool calling requires a native canonical adapter");
  }
  if (request.stream) unsupported("streaming requires a native canonical adapter");
  if (request.responseFormat !== undefined && request.responseFormat !== "text") {
    unsupported("structured output requires a native canonical adapter");
  }
  if (request.topP !== undefined || request.stopSequences !== undefined || request.timeoutMs !== undefined) {
    unsupported("topP, stopSequences and custom timeout require a native canonical adapter");
  }
  if (request.signal?.aborted) {
    throw new NexumError("NETWORK_ERROR", "Запрос отменён.", {
      status: 499,
      retryable: false,
      technicalDetails: "AbortSignal was already aborted before provider invocation",
    });
  }

  const prompt = request.messages.map((message) => {
    const role = message.role.toUpperCase();
    return `[${role}]\n${message.content as string}`;
  }).join("\n\n");

  const content = await legacyGenerate.call(provider, prompt, request.model, {
    ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  });

  return normalizeAIResponse({
    content,
    provider: provider.id,
    model: request.model || provider.model,
    usageSource: "unavailable",
  }, provider.id, request.model || provider.model);
}
