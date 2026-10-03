import { randomUUID } from "node:crypto";
import type { AgentIntent } from "./intent.js";
import type { AgentPlanDocument, AgentPlanStep, AgentPlanStepStatus } from "./types.js";

export function createPlanDocument(intent: AgentIntent, steps: Array<Pick<AgentPlanStep, "id" | "description" | "dependencies">>): AgentPlanDocument {
  return {
    planId: randomUUID(),
    taskId: intent.taskId,
    goal: intent.objective,
    steps: steps.map((step, index) => ({
      ...step,
      status: index === 0 ? "READY" : "PENDING",
      attempts: 0,
    })),
    acceptanceCriteria: [...intent.acceptanceCriteria],
    risks: [],
    createdAt: Date.now(),
  };
}

export function transitionPlanStep(plan: AgentPlanDocument, stepId: string, status: AgentPlanStepStatus, result?: string): AgentPlanDocument {
  const index = plan.steps.findIndex((step) => step.id === stepId);
  if (index < 0) throw new Error(`Unknown plan step: ${stepId}`);
  const next = plan.steps.map((step, stepIndex) => stepIndex === index
    ? { ...step, status, attempts: status === "RUNNING" ? step.attempts + 1 : step.attempts, ...(result === undefined ? {} : { result }) }
    : step);
  if (status === "COMPLETED") {
    const nextPending = next.findIndex((step) => step.status === "PENDING" && step.dependencies.every((dependency) => next.some((candidate) => candidate.id === dependency && candidate.status === "COMPLETED")));
    if (nextPending >= 0) next[nextPending] = { ...next[nextPending], status: "READY" };
  }
  return { ...plan, steps: next };
}

export function planIsComplete(plan: AgentPlanDocument): boolean {
  return plan.steps.length > 0 && plan.steps.every((step) => ["COMPLETED", "SKIPPED"].includes(step.status));
}
