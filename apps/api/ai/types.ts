export type AIModelCapabilityKey =
  | "text"
  | "code"
  | "vision"
  | "toolCalling"
  | "streaming"
  | "structuredOutput"
  | "reasoning";

export type AIModelCapabilityValue = boolean | "unknown";

export interface AIModelCapabilities {
  text: AIModelCapabilityValue;
  code: AIModelCapabilityValue;
  vision: AIModelCapabilityValue;
  toolCalling: AIModelCapabilityValue;
  streaming: AIModelCapabilityValue;
  structuredOutput: AIModelCapabilityValue;
  reasoning: AIModelCapabilityValue;
  contextWindow: number | null;
}

export type AIMessageRole = "system" | "developer" | "user" | "assistant" | "tool";

export type AIContentPart =
  | { type: "text"; text: string }
  | {
      type: "image";
      source:
        | { type: "url"; url: string }
        | { type: "base64"; mediaType: string; data: string };
    };

export interface AIToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface AIMessage {
  role: AIMessageRole;
  content: string | AIContentPart[];
  toolCallId?: string;
  toolCalls?: AIToolCall[];
}

export interface AIToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export type AIResponseFormat =
  | "text"
  | "json"
  | { type: "json_schema"; name: string; schema: Record<string, unknown>; strict?: boolean };

export interface AIUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningTokens?: number;
}

export type AIUsageSource = "provider_reported" | "estimated" | "unavailable";

export interface AIRequest {
  version: 1;
  messages: AIMessage[];
  model: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  tools?: AIToolDefinition[];
  toolChoice?: "auto" | "none" | "required" | { name: string };
  stream?: boolean;
  responseFormat?: AIResponseFormat;
  timeoutMs?: number;
  metadata?: {
    requestId?: string;
    idempotencyKey?: string;
    organizationId?: string;
    userId?: string;
    subscriptionId?: string;
  };
  signal?: AbortSignal;
}

export interface AIResponse {
  content: string;
  contentBlocks?: AIContentPart[];
  provider: string;
  model: string;
  requestId?: string;
  usage?: AIUsage;
  usageSource?: AIUsageSource;
  toolCalls?: AIToolCall[];
  finishReason?: string;
  latencyMs?: number;
}

export type AIProviderProtocol =
  | "openai-chat-completions"
  | "openai-compatible-chat-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "ollama-chat"
  | "mock"
  | "custom"
  | (string & {});

export interface AIProvider {
  id: string;
  name: string;
  model: string;
  /** Exact upstream protocol implemented by this adapter, not a compatibility guess. */
  protocol?: AIProviderProtocol;
  /** Older protocol retained only for the legacy string facade, if different. */
  legacyProtocol?: AIProviderProtocol;
  /** Adapter implementation version, independent of upstream model/API version. */
  adapterVersion?: string;
  capabilities: AIModelCapabilities;
  generate?(message: string, model?: string, options?: AIGenerateOptions): Promise<string>;
  generateRequest?(request: AIRequest): Promise<AIResponse>;
  listModels?(signal?: AbortSignal): Promise<string[]>;
  getStatus?(model?: string, signal?: AbortSignal): Promise<AIProviderStatus>;
  getCapabilities?(model?: string): AIModelCapabilities;
}

export interface AIGenerateOptions {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface AIProviderStatus {
  available: boolean;
  model: string;
  latencyMs: number | null;
  error?: string;
}


export interface AIModelCatalogEntry {
  provider: string;
  configuredModel: string;
  models: string[];
  source: "provider_api" | "configured_fallback";
  verified: boolean;
  status: "available" | "empty" | "unavailable";
  errorCode?: "catalog_not_supported" | "catalog_request_failed" | "catalog_empty";
}
