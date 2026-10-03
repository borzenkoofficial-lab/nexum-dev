export interface ToolResult {
  success: boolean;
  output: string;
  toolCallId?: string;
  toolName?: string;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    repairable?: boolean;
    fatal?: boolean;
  };
  metadata?: {
    projectId?: string;
    taskId?: string;
    agentJobId?: string;
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

export type AgentState =
  | "IDLE"
  | "UNDERSTANDING"
  | "PLANNING"
  | "EXECUTING"
  | "OBSERVING"
  | "VALIDATING"
  | "REPAIRING"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type AgentIntentType = "create" | "modify" | "debug" | "refactor" | "analyze" | "configure" | "unknown";

export interface AgentIntent {
  requestId: string;
  projectId: string;
  taskId: string;
  agentJobId: string;
  type: AgentIntentType;
  objective: string;
  requirements: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  explicitFiles?: string[];
  unknowns: string[];
  confidence?: number;
  createdAt: number;
}

export type AgentPlanStepStatus = "PENDING" | "READY" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED" | "CANCELLED";

export interface AgentPlanStep {
  id: string;
  description: string;
  tool?: string;
  input?: string;
  dependencies: string[];
  status: AgentPlanStepStatus;
  attempts: number;
  result?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface AgentExecutionPlan {
  planId: string;
  taskId: string;
  agentJobId: string;
  goal: string;
  steps: AgentPlanStep[];
  acceptanceCriteria: string[];
  risks: string[];
  createdAt: number;
  currentStepId?: string;
}

export interface AgentValidation {
  passed: boolean;
  categories: {
    static: boolean;
    runtime: boolean;
    functional: boolean;
    project: boolean;
  };
  checks: Array<{ name: string; passed: boolean; evidence: string }>;
  failedCriteria: string[];
}

export interface AgentResultSummary {
  status: AgentState;
  summary: string;
  changedFiles: string[];
  completedSteps: string[];
  warnings: string[];
  errors: string[];
}

export interface AgentTelemetry {
  modelCalls: number;
  toolCalls: number;
  steps: number;
  repairAttempts: number;
  durationMs: number;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AgentPlan {
  tool: string;
  input: string;
  done?: boolean;
  finalResponse?: string;
  planStepId?: string;
}

export interface AgentModelOptions {
  provider?: string;
  model?: string;
  signal?: AbortSignal;
}

export interface AgentToolResult {
  iteration: number;
  tool: string;
  input: string;
  result: ToolResult;
  toolCallId?: string;
  observedAt?: number;
}

export interface AgentRuntime {
  getAvailableTools(): string[];
  plan(task: string, previousResults: AgentToolResult[]): AgentPlan | null;
  createProductPlan?(task: string, previousResults: AgentToolResult[], options?: AgentModelOptions): Promise<ProductPlan>;
  planWithAI?(task: string, previousResults: AgentToolResult[], options?: AgentModelOptions, productPlan?: ProductPlan): Promise<AgentPlan | null>;
  reviewProduct?(task: string, previousResults: AgentToolResult[], productPlan: ProductPlan, options?: AgentModelOptions): Promise<ProductReview>;
  executeTool(tool: string, input: string, signal?: AbortSignal): Promise<ToolResult>;
  validateRuntime?(signal?: AbortSignal): Promise<ToolResult>;
}

export interface AgentStep {
  iteration: number;
  tool: string;
  input: string;
  success: boolean;
  toolCallId?: string;
  durationMs?: number;
  planStepId?: string;
}

export type AgentErrorCategory =
  | "MODEL_ERROR" | "TOOL_ERROR" | "NETWORK_ERROR" | "PROJECT_ERROR"
  | "VALIDATION_ERROR" | "RUNTIME_ERROR" | "DEPENDENCY_ERROR"
  | "PERMISSION_ERROR" | "CANCELLATION" | "TIMEOUT" | "UNKNOWN"
  | "typescript" | "syntax" | "dependency" | "build" | "runtime"
  | "path" | "tool" | "network" | "permission" | "validation"
  | "cancellation" | "timeout" | "unknown" | "completion" | "loop";
export interface AgentErrorInfo {
  code:
    | "USER_ERROR"
    | "MODEL_ERROR"
    | "PROVIDER_ERROR"
    | "TOOL_ERROR"
    | "BUILD_ERROR"
    | "RUNTIME_ERROR"
    | "NETWORK_ERROR"
    | "AUTH_ERROR"
    | "CONFIG_ERROR"
    | "INTERNAL_ERROR"
    | "VALIDATION_ERROR"
    | "CANCELLATION"
    | "TIMEOUT";
  message: string;
  retryable: boolean;
  repairable?: boolean;
  fatal?: boolean;
  category?: AgentErrorCategory;
  summary?: string;
  recoveryStrategy?: string;
}

export interface AgentLoopResult {
  intent?: AgentIntent;
  executionPlan?: AgentExecutionPlan;
  validation?: AgentValidation;
  telemetry?: AgentTelemetry;
  finalState?: AgentState;
  phase: AgentPhase;
  success: boolean;
  iterations: number;
  productPlan?: ProductPlan;
  steps: AgentStep[];
  finalResponse?: string;
  summary?: AgentResultSummary;
  changedFiles?: string[];
  warnings?: string[];
  errors?: string[];
  error?: string;
  errorInfo?: AgentErrorInfo;
}
