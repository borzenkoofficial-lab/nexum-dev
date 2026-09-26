export interface ToolResult {
  success: boolean;
  output: string;
}

export interface Tool {
  name: string;
  description: string;
  execute(input: string): Promise<ToolResult>;
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
  planWithAI?(task: string, previousResults: AgentToolResult[], options?: AgentModelOptions): Promise<AgentPlan | null>;
  executeTool(tool: string, input: string): Promise<ToolResult>;
}

export interface AgentStep {
  iteration: number;
  tool: string;
  input: string;
  success: boolean;
}

export interface AgentLoopResult {
  success: boolean;
  iterations: number;
  steps: AgentStep[];
  finalResponse?: string;
  error?: string;
}
