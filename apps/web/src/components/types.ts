export interface Project {
  id: string;
  name: string;
  description?: string;
  type?: string;
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

export type AgentStage = "thinking" | "analyzing" | "planning" | "reading" | "editing" | "running" | "building" | "testing" | "completed" | "error" | null;

export interface PreviewStatus {
  online: boolean;
  url: string | null;
}
