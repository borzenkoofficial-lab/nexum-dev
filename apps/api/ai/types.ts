export interface AIProvider {
  id: string;
  name: string;
  model: string;
  generate(message: string, model?: string, options?: AIGenerateOptions): Promise<string>;
  listModels?(): Promise<string[]>;
  getStatus?(model?: string): Promise<AIProviderStatus>;
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
