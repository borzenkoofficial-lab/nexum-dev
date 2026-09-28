import type { NexumIntent } from "../ai/intentEngine.js";
import { decomposeTask, type TaskGraph, type TaskNode } from "../ai/taskDecomposer.js";

export interface BuilderExecutionState {
  graph: TaskGraph;
  completed: Set<string>;
  attempts: Map<string, number>;
}

export interface BuilderStep {
  node: TaskNode;
  remaining: string[];
  blocked: boolean;
}

/**
 * Stage 6 execution coordinator.
 *
 * It turns the static task graph into a bounded state machine. The AgentLoop
 * remains responsible for actual tools; this module decides which graph node
 * is currently allowed to drive the next AI/tool action.
 */
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

  // Preserve the graph's declared execution order. Parallel batches are
  // intentionally serialized here until the tool/runtime layer can prove that
  // two mutations are isolated from each other.
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
  };
}

export function recordBuilderNodeResult(
  state: BuilderExecutionState,
  nodeId: string,
  success: boolean,
): void {
  const attempts = (state.attempts.get(nodeId) ?? 0) + 1;
  state.attempts.set(nodeId, attempts);

  if (success) {
    state.completed.add(nodeId);
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
