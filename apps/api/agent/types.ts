export type AgentIntentType = "create" | "modify" | "debug" | "refactor" | "analyze" | "configure" | "unknown";

export type AgentPlanStepStatus = "PENDING" | "READY" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED" | "CANCELLED";

export interface ToolResult {
  success: boolean;
  output: string;
  toolCallId?: string;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  metadata?: {
    projectId?: string;
    taskId?: string;
    durationMs?: number;
    exitCode?: number | null;
  };
}

export interface Tool {
  name: string;
  description: string;
  execute(input: string, signal?: AbortSignal): Promise<ToolResult>;
}

export interface ProductPlan {
  goal: string;
  productType: string;
  targetUser: string;
  pages: string[];
  components: string[];
  visualSystem: string[];
  interactions: string[];
  dataModel: string[];
  filesToInspect: string[];
  filesToChange: string[];
  acceptanceCriteria: string[];
}

export interface ProductReview {
  passed: boolean;
  missing: string[];
  risks: string[];
}

export type AgentPhase = "analyze" | "plan" | "implement" | "validate" | "repair" | "verify" | "finish";

export interface AgentPlanStep {
  id: string;
  description: string;
  dependencies: string[];
  status: AgentPlanStepStatus;
  attempts: number;
  result?: string;
}

export interface AgentPlanDocument {
  planId: string;
  taskId: string;
  goal: string;
  steps: AgentPlanStep[];
  acceptanceCriteria: string[];
  risks: string[];
  createdAt: number;
}

export interface AgentPlan {
  tool: string;
  input: string;
  done?: boolean;
  finalResponse?: string;
}

export interface AgentModelOptions {
  provider?: string;
  model?: string;
}

export interface AgentToolResult {
  iteration: number;
  tool: string;
  input: string;
  result: ToolResult;
}

export interface AgentRuntime {
  getAvailableTools(): string[];
  plan(task: string, previousResults: AgentToolResult[]): AgentPlan | null;
  createProductPlan?(task: string, previousResults: AgentToolResult[], options?: AgentModelOptions): Promise<ProductPlan>;
  planWithAI?(task: string, previousResults: AgentToolResult[], options?: AgentModelOptions, productPlan?: ProductPlan): Promise<AgentPlan | null>;
  reviewProduct?(task: string, previousResults: AgentToolResult[], productPlan: ProductPlan, options?: AgentModelOptions): Promise<ProductReview>;
  executeTool(tool: string, input: string, signal?: AbortSignal): Promise<ToolResult>;
}

export interface AgentStep {
  iteration: number;
  tool: string;
  input: string;
  success: boolean;
}

export interface AgentErrorInfo {
  code: "USER_ERROR" | "MODEL_ERROR" | "PROVIDER_ERROR" | "TOOL_ERROR" | "BUILD_ERROR" | "RUNTIME_ERROR" | "NETWORK_ERROR" | "AUTH_ERROR" | "CONFIG_ERROR" | "INTERNAL_ERROR";
  message: string;
  retryable: boolean;
  category?: string;
  summary?: string;
  recoveryStrategy?: string;
}

export interface AgentLoopResult {
  phase: AgentPhase;
  success: boolean;
  iterations: number;
  productPlan?: ProductPlan;
  steps: AgentStep[];
  finalResponse?: string;
  error?: string;
  errorInfo?: AgentErrorInfo;
  intent?: import("./intent.js").AgentIntent;
  plan?: AgentPlanDocument;
}
