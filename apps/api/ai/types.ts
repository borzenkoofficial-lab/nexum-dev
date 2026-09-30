export interface AIModelCapabilities {
  text: boolean;
  code: boolean;
  vision: boolean;
  toolCalling: boolean;
  streaming: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
  contextWindow: number | null;
}

export interface AIProvider {
  id: string;
  name: string;
  model: string;
  capabilities: AIModelCapabilities;
  generate(message: string, model?: string, options?: AIGenerateOptions): Promise<string>;
  listModels?(): Promise<string[]>;
  getStatus?(model?: string): Promise<AIProviderStatus>;
  getCapabilities?(model?: string): AIModelCapabilities;
}

export interface AIGenerateOptions {
  maxTokens?: number;
  temperature?: number;
}

export interface AIProviderStatus {
  available: boolean;
  model: string;
  latencyMs: number | null;
  error?: string;
}

export interface AIRequest {
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
  }>;
  model: string;
  maxTokens?: number;
  temperature?: number;
  tools?: unknown[];
  stream?: boolean;
  responseFormat?: "text" | "json";
}

export interface AIResponse {
  content: string;
  provider: string;
  model: string;
  requestId?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: unknown;
  }>;
  finishReason?: string;
}
