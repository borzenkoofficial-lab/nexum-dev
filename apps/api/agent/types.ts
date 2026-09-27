export interface ToolResult {
  success: boolean;
  output: string;
}

export interface Tool {
  name: string;
  description: string;
  execute(input: string): Promise<ToolResult>;
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
  executeTool(tool: string, input: string): Promise<ToolResult>;
}

export interface AgentStep {
  iteration: number;
  tool: string;
  input: string;
  success: boolean;
}

export interface AgentLoopResult {
  phase: AgentPhase;
  success: boolean;
  iterations: number;
  productPlan?: ProductPlan;
  steps: AgentStep[];
  finalResponse?: string;
  error?: string;
}
