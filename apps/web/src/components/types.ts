export interface Project {
  id: string;
  name: string;
  path: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface AIProviderInfo {
  id: string;
  name: string;
  model: string;
  isDefault: boolean;
}

export interface AIProviderStatus {
  provider: string;
  available: boolean;
  model: string;
  latencyMs: number | null;
  error?: string;
}

export type AgentStage = "thinking" | "running" | "building" | null;
