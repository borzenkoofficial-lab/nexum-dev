import type { NexumIntent } from "./intentEngine.js";
import { decomposeTask, type TaskGraph, type TaskNode } from "./taskDecomposer.js";

export interface BuilderExecutionState {
  graph: TaskGraph;
  completed: Set<string>;
  attempts: Map<string, number>;
}

export const MAX_NODE_ATTEMPTS = 3;

export interface BuilderStep {
  node: TaskNode;
  remaining: string[];
  blocked: boolean;
  exhausted: boolean;
}

export function createBuilderExecutionState(
  task: string,
  intent: NexumIntent,
  context: {
    relevantFiles?: string[];
    routes?: string[];
    architecture?: string[];
    health?: "unknown" | "ready" | "attention";
  } = {},
): BuilderExecutionState {
  return {
    graph: decomposeTask(task, intent, context),
    completed: new Set<string>(),
    attempts: new Map<string, number>(),
  };
}

export function nextBuilderStep(state: BuilderExecutionState): BuilderStep | null {
  const candidates = state.graph.nodes
    .filter((node) => !state.completed.has(node.id))
    .filter((node) => node.dependencies.every((dependency) => state.completed.has(dependency)));

  if (!candidates.length) return null;

  const exhaustedCandidate = candidates.find(
    (candidate) => (state.attempts.get(candidate.id) ?? 0) >= MAX_NODE_ATTEMPTS,
  );
  if (exhaustedCandidate) {
    return {
      node: exhaustedCandidate,
      remaining: candidates.filter((candidate) => candidate.id !== exhaustedCandidate.id).map((candidate) => candidate.id),
      blocked: true,
      exhausted: true,
    };
  }

  const nextId = state.graph.executionOrder
    .flat()
    .find((id) => candidates.some((node) => node.id === id));
  const node = candidates.find((candidate) => candidate.id === nextId) ?? candidates[0];

  return {
    node,
    remaining: state.graph.nodes
      .filter((candidate) => !state.completed.has(candidate.id) && candidate.id !== node.id)
      .map((candidate) => candidate.id),
    blocked: false,
    exhausted: false,
  };
}

export function recordBuilderNodeResult(
  state: BuilderExecutionState,
  nodeId: string,
  success: boolean,
): void {
  const attempts = (state.attempts.get(nodeId) ?? 0) + 1;
  state.attempts.set(nodeId, attempts);
  if (success) state.completed.add(nodeId);
}

/**
 * Rewinds the active graph to a recovery node while preserving attempt counters.
 * Preserving counters makes the recovery budget global and prevents infinite
 * diagnose -> fix -> verify loops.
 */
export function rewindBuilderTo(
  state: BuilderExecutionState,
  nodeId: string,
): void {
  const targetIndex = state.graph.executionOrder
    .flat()
    .indexOf(nodeId);
  if (targetIndex < 0) return;

  const ordered = state.graph.executionOrder.flat();
  for (let index = targetIndex; index < ordered.length; index += 1) {
    state.completed.delete(ordered[index]);
  }
}

export function builderExecutionPrompt(
  state: BuilderExecutionState,
  task: string,
): string {
  const step = nextBuilderStep(state);
  if (!step) {
    return [
      "NEXUM EXECUTION STATE: complete",
      "All planned graph nodes are completed.",
      "Do not invent additional work. Return done only after verification evidence exists.",
    ].join("\n");
  }

  const attempt = state.attempts.get(step.node.id) ?? 0;
  if (step.exhausted) {
    return [
      "NEXUM EXECUTION STATE: blocked",
      `currentNode=${step.node.id}`,
      `attempts=${attempt}`,
      `maxAttempts=${MAX_NODE_ATTEMPTS}`,
      "This node exhausted its bounded attempts. Do not continue or invent a new path.",
    ].join("\n");
  }

  return [
    "NEXUM EXECUTION STATE",
    `rootTask=${task.slice(0, 500)}`,
    `currentNode=${step.node.id}`,
    `role=${step.node.role}`,
    `attempt=${attempt + 1}`,
    `dependencies=${step.node.dependencies.join(",") || "none"}`,
    `affectedAreas=${step.node.affectedAreas.join(",") || "none"}`,
    `verificationRequired=${step.node.verificationRequired}`,
    `risk=${step.node.risk}`,
    `instruction=${step.node.description}`,
    "Execute only this node's responsibility. Do not skip ahead to unrelated work.",
  ].join("\n");
}
