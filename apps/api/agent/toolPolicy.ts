import type { Tool } from "./types.js";

export type ToolRisk = "READ" | "WRITE" | "EXECUTE" | "DESTRUCTIVE";

export interface ToolSecurityPolicy {
  risk: ToolRisk;
  requiresProjectScope: boolean;
  maxInputBytes: number;
  allowedDuringAgentRun: boolean;
}

const POLICIES: Record<string, ToolSecurityPolicy> = {
  listFiles: { risk: "READ", requiresProjectScope: true, maxInputBytes: 2_000, allowedDuringAgentRun: true },
  readFile: { risk: "READ", requiresProjectScope: true, maxInputBytes: 4_000, allowedDuringAgentRun: true },
  searchFiles: { risk: "READ", requiresProjectScope: true, maxInputBytes: 4_000, allowedDuringAgentRun: true },
  git: { risk: "READ", requiresProjectScope: true, maxInputBytes: 2_000, allowedDuringAgentRun: true },
  github: { risk: "READ", requiresProjectScope: false, maxInputBytes: 8_000, allowedDuringAgentRun: true },
  validateProject: { risk: "READ", requiresProjectScope: true, maxInputBytes: 2_000, allowedDuringAgentRun: true },
  testProject: { risk: "EXECUTE", requiresProjectScope: true, maxInputBytes: 2_000, allowedDuringAgentRun: true },
  writeFile: { risk: "WRITE", requiresProjectScope: true, maxInputBytes: 1_000_000, allowedDuringAgentRun: true },
  patchFile: { risk: "WRITE", requiresProjectScope: true, maxInputBytes: 1_000_000, allowedDuringAgentRun: true },
  scaffoldProject: { risk: "WRITE", requiresProjectScope: true, maxInputBytes: 20_000, allowedDuringAgentRun: true },
  runCommand: { risk: "EXECUTE", requiresProjectScope: true, maxInputBytes: 8_000, allowedDuringAgentRun: true },
  runSandbox: { risk: "EXECUTE", requiresProjectScope: true, maxInputBytes: 8_000, allowedDuringAgentRun: true },
};

export function getToolSecurityPolicy(toolName: string): ToolSecurityPolicy {
  const policy = POLICIES[toolName];
  if (!policy) throw new Error(`No security policy registered for tool: ${toolName}`);
  return policy;
}

export function validateToolInvocation(tool: Tool, input: string): ToolSecurityPolicy {
  const policy = getToolSecurityPolicy(tool.name);
  if (!policy.allowedDuringAgentRun) throw new Error(`Tool is disabled during Agent runs: ${tool.name}`);
  if (Buffer.byteLength(input, "utf8") > policy.maxInputBytes) {
    throw new Error(`Tool input exceeds the safety limit for ${tool.name}`);
  }
  return policy;
}

export function assertCompleteToolPolicy(toolNames: string[]): void {
  const missing = toolNames.filter((name) => !POLICIES[name]);
  if (missing.length) throw new Error(`Missing security policies: ${missing.join(", ")}`);
}
