import type { AgentExecutionPlan, AgentIntent, AgentPlanStep, AgentPlanStepStatus, AgentState, AgentTelemetry, AgentValidation } from "./types.js";

export const AGENT_STATE_TRANSITIONS: Record<AgentState, AgentState[]> = {
  IDLE: ["UNDERSTANDING", "FAILED", "CANCELLED"],
  UNDERSTANDING: ["PLANNING", "FAILED", "CANCELLED"],
  PLANNING: ["EXECUTING", "FAILED", "CANCELLED"],
  EXECUTING: ["OBSERVING", "VALIDATING", "REPAIRING", "FAILED", "CANCELLED"],
  OBSERVING: ["PLANNING", "EXECUTING", "VALIDATING", "VERIFYING", "REPAIRING", "FAILED", "CANCELLED"],
  VALIDATING: ["VERIFYING", "REPAIRING", "FAILED", "CANCELLED"],
  REPAIRING: ["EXECUTING", "VALIDATING", "FAILED", "CANCELLED"],
  VERIFYING: ["COMPLETED", "REPAIRING", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export interface AgentExecutionSnapshot {
  intent: AgentIntent;
  state: AgentState;
  currentStepId?: string;
  plan: AgentExecutionPlan;
  observations: string[];
  completedStepIds: string[];
  repairAttempts: number;
  startedAt: number;
  updatedAt: number;
}

export function createExecutionPlan(intent: AgentIntent): AgentExecutionPlan {
  const now = Date.now();
  const steps: AgentPlanStep[] = [
    { id: "understand", description: "Acquire the minimum relevant project context.", dependencies: [], status: "READY", attempts: 0 },
    { id: "plan", description: "Create or refine the bounded execution plan.", dependencies: ["understand"], status: "PENDING", attempts: 0 },
    { id: "execute", description: "Execute concrete project actions one step at a time.", dependencies: ["plan"], status: "PENDING", attempts: 0 },
    { id: "observe", description: "Record and inspect actual tool results.", dependencies: ["execute"], status: "PENDING", attempts: 0 },
    { id: "validate", description: "Run static, project and applicable runtime validation.", dependencies: ["observe"], status: "PENDING", attempts: 0 },
    { id: "repair", description: "Apply bounded repairs after execution or validation failures.", dependencies: ["observe"], status: "PENDING", attempts: 0 },
    { id: "verify", description: "Check acceptance criteria and consistency after the last change.", dependencies: ["validate", "repair"], status: "PENDING", attempts: 0 },
    { id: "complete", description: "Pass the completion gate and publish the terminal result.", dependencies: ["verify"], status: "PENDING", attempts: 0 },
  ];
  return {
    planId: crypto.randomUUID(),
    taskId: intent.taskId,
    goal: intent.objective,
    steps,
    acceptanceCriteria: [...intent.acceptanceCriteria],
    risks: [
      "Model output may be incorrect or incomplete.",
      "Tool output is untrusted project data.",
      "Cancellation can race with model/tool completion.",
    ],
    createdAt: now,
    currentStepId: "understand",
  };
}

export function transitionAgentState(
  snapshot: AgentExecutionSnapshot,
  next: AgentState,
  record: (message: string, severity?: "warn" | "error") => void,
): boolean {
  if (snapshot.state === next) return true;
  if (!AGENT_STATE_TRANSITIONS[snapshot.state].includes(next)) {
    record(`Invalid Agent state transition ${snapshot.state} -> ${next}`, "error");
    return false;
  }
  snapshot.state = next;
  snapshot.updatedAt = Date.now();
  return true;
}

export function canRunPlanStep(plan: AgentExecutionPlan, id: string): boolean {
  const step = plan.steps.find((item) => item.id === id);
  if (!step) return false;
  return step.dependencies.every((dependency) => {
    const dependencyStep = plan.steps.find((item) => item.id === dependency);
    return dependencyStep?.status === "COMPLETED" || dependencyStep?.status === "SKIPPED";
  });
}

export function setPlanStep(
  plan: AgentExecutionPlan,
  id: string,
  status: AgentPlanStepStatus,
  result?: string,
): void {
  const step = plan.steps.find((item) => item.id === id);
  if (!step) return;
  step.status = status;
  step.attempts += status === "RUNNING" ? 1 : 0;
  if (result) step.result = result.slice(0, 1600);
  plan.currentStepId = id;
}

export function markPlanStepSkipped(plan: AgentExecutionPlan, id: string, result?: string): void {
  const step = plan.steps.find((item) => item.id === id);
  if (!step) return;
  step.status = "SKIPPED";
  if (result) step.result = result.slice(0, 1600);
}

export function markPlanStepCompleted(plan: AgentExecutionPlan, id: string, result?: string): void {
  const step = plan.steps.find((item) => item.id === id);
  if (!step) return;
  step.status = "COMPLETED";
  if (result) step.result = result.slice(0, 1600);
}

export function createValidation(
  checks: AgentValidation["checks"],
  failedCriteria: string[] = [],
): AgentValidation {
  const staticPassed = checks.filter((check) => /typecheck|lint|build|static|dependency/i.test(check.name));
  const runtimePassed = checks.filter((check) => /runtime|preview|server|respond/i.test(check.name));
  const functionalPassed = checks.filter((check) => /functional|test|route|action|acceptance/i.test(check.name));
  const projectPassed = checks.filter((check) => /project|domain|consisten/i.test(check.name));
  const category = (items: AgentValidation["checks"]) => items.length === 0 || items.every((item) => item.passed);
  return {
    passed: failedCriteria.length === 0 && checks.every((check) => check.passed),
    categories: {
      static: category(staticPassed),
      runtime: category(runtimePassed),
      functional: category(functionalPassed),
      project: category(projectPassed),
    },
    checks,
    failedCriteria,
  };
}

export function createTelemetry(
  startedAt: number,
  modelCalls: number,
  toolCalls: number,
  steps: number,
  repairAttempts: number,
  provider?: string,
  model?: string,
): AgentTelemetry {
  return {
    modelCalls,
    toolCalls,
    steps,
    repairAttempts,
    durationMs: Date.now() - startedAt,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
  };
}


export interface CompletionGateInput {
  hasPlan: boolean;
  hasExecuted: boolean;
  validationPassed: boolean;
  acceptanceCriteriaSatisfied: boolean;
  noCriticalErrors: boolean;
  projectStateConsistent: boolean;
}

export function evaluateCompletionGate(input: CompletionGateInput): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.hasPlan) reasons.push("execution plan is missing");
  if (!input.hasExecuted) reasons.push("no execution step completed");
  if (!input.validationPassed) reasons.push("validation did not pass");
  if (!input.acceptanceCriteriaSatisfied) reasons.push("acceptance criteria are not satisfied");
  if (!input.noCriticalErrors) reasons.push("critical errors remain");
  if (!input.projectStateConsistent) reasons.push("project state is inconsistent");
  return { ok: reasons.length === 0, reasons };
}
