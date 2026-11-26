import { getToolSecurityPolicy, type ToolRisk } from "./toolPolicy.js";

export type ChatJobRecoveryDisposition =
  | "safe_to_restart"
  | "inspect_before_retry"
  | "manual_review_required";

export interface ChatJobRecoveryAssessment {
  version: 2;
  disposition: ChatJobRecoveryDisposition;
  automaticResumeAllowed: false;
  reason:
    | "queued_before_execution"
    | "execution_checkpoint_not_durable"
    | "side_effect_may_have_started"
    | "tool_outcome_unknown"
    | "approval_was_pending"
    | "unrecognized_tool_activity"
    | "execution_evidence_missing";
  startedTools: string[];
  completedTools: string[];
  startedActionIds: string[];
  completedActionIds: string[];
  sideEffectActionIds: string[];
  assessedAt: number;
}

type RecoveryEvent = {
  type?: unknown;
  tool?: unknown;
  iteration?: unknown;
};

type RecoveryStep = { tool?: unknown };
type RecoveryToolAction = {
  actionId?: unknown;
  tool?: unknown;
  risk?: unknown;
  status?: unknown;
};
type RecoveryJobLike = {
  status?: "queued" | "running" | "completed" | "failed" | "cancelled";
  events?: unknown[];
  steps?: unknown[];
  pendingApproval?: { status?: unknown } | null;
  toolActions?: unknown[];
};

const riskOrder: Record<ToolRisk, number> = {
  READ: 0,
  WRITE: 1,
  EXECUTE: 2,
  DESTRUCTIVE: 3,
};

export function assessChatJobRecovery(
  job: RecoveryJobLike,
  assessedAt = Date.now(),
): ChatJobRecoveryAssessment {
  const events = Array.isArray(job.events) ? job.events : [];
  const started = new Map<string, string>();
  const completed = new Set<string>();
  const startedTools = new Set<string>();
  const completedTools = new Set<string>();
  let unknownActivity = false;
  let sideEffectMayHaveStarted = false;
  let journalHasUnfinishedAction = false;
  const startedActionIds = new Set<string>();
  const completedActionIds = new Set<string>();
  const sideEffectActionIds = new Set<string>();

  for (const raw of events) {
    if (!raw || typeof raw !== "object") continue;
    const event = raw as RecoveryEvent;
    if (event.type !== "tool-start" && event.type !== "tool-success" && event.type !== "tool-error") continue;
    if (typeof event.tool !== "string" || !event.tool.trim()) {
      unknownActivity = true;
      continue;
    }
    const tool = event.tool.trim();
    let risk: ToolRisk;
    try {
      risk = getToolSecurityPolicy(tool).risk;
    } catch {
      unknownActivity = true;
      continue;
    }
    const key = `${typeof event.iteration === "number" ? event.iteration : "?"}:${tool}`;
    if (event.type === "tool-start") {
      started.set(key, tool);
      startedTools.add(tool);
      if (riskOrder[risk] > riskOrder.READ) sideEffectMayHaveStarted = true;
    } else {
      completed.add(key);
      completedTools.add(tool);
      if (riskOrder[risk] > riskOrder.READ) sideEffectMayHaveStarted = true;
    }
  }

  // Older AgentLoop paths may persist a completed step without a matching
  // tool-start event. Completed step records are also evidence of side effects.
  for (const raw of Array.isArray(job.steps) ? job.steps : []) {
    if (!raw || typeof raw !== "object") continue;
    const step = raw as RecoveryStep;
    if (typeof step.tool !== "string" || !step.tool.trim()) {
      unknownActivity = true;
      continue;
    }
    const tool = step.tool.trim();
    let risk: ToolRisk;
    try {
      risk = getToolSecurityPolicy(tool).risk;
    } catch {
      unknownActivity = true;
      continue;
    }
    completedTools.add(tool);
    if (riskOrder[risk] > riskOrder.READ) sideEffectMayHaveStarted = true;
  }

  // The dedicated action journal is written synchronously before every tool
  // invocation and finalized only after its result is known. It takes
  // precedence over best-effort UI event/step snapshots.
  for (const raw of Array.isArray(job.toolActions) ? job.toolActions : []) {
    if (!raw || typeof raw !== "object") {
      unknownActivity = true;
      continue;
    }
    const action = raw as RecoveryToolAction;
    if (typeof action.actionId !== "string" || typeof action.tool !== "string" || !action.tool.trim()) {
      unknownActivity = true;
      continue;
    }
    if (!["READ", "WRITE", "EXECUTE", "DESTRUCTIVE"].includes(String(action.risk))) {
      unknownActivity = true;
      continue;
    }
    startedTools.add(action.tool);
    startedActionIds.add(action.actionId);
    if (action.status === "started") {
      journalHasUnfinishedAction = true;
      if (action.risk !== "READ") sideEffectActionIds.add(action.actionId);
    } else if (action.status === "succeeded" || action.status === "failed") {
      completedActionIds.add(action.actionId);
      completedTools.add(action.tool);
      if (action.risk !== "READ") {
        sideEffectMayHaveStarted = true;
        sideEffectActionIds.add(action.actionId);
      }
    } else {
      unknownActivity = true;
    }
  }

  const unmatchedStart = journalHasUnfinishedAction || [...started.keys()].some((key) => !completed.has(key));
  const pendingApproval = job.pendingApproval?.status === "pending";
  let disposition: ChatJobRecoveryDisposition;
  let reason: ChatJobRecoveryAssessment["reason"];

  if (pendingApproval) {
    disposition = "manual_review_required";
    reason = "approval_was_pending";
  } else if (unknownActivity) {
    disposition = "manual_review_required";
    reason = "unrecognized_tool_activity";
  } else if (unmatchedStart) {
    disposition = "inspect_before_retry";
    reason = "tool_outcome_unknown";
  } else if (sideEffectMayHaveStarted) {
    disposition = "inspect_before_retry";
    reason = "side_effect_may_have_started";
  } else if (job.status === "queued" && startedTools.size === 0 && completedTools.size === 0) {
    disposition = "safe_to_restart";
    reason = "queued_before_execution";
  } else if (job.status === "running" && startedTools.size === 0 && completedTools.size === 0) {
    // A running job without durable tool evidence may have crossed a tool
    // boundary whose event write was not committed before the process died.
    disposition = "inspect_before_retry";
    reason = "execution_evidence_missing";
  } else {
    // Current AgentLoop callbacks persist asynchronously. Even a read-only
    // event stream is not yet a commit-confirmed execution checkpoint.
    disposition = "inspect_before_retry";
    reason = "execution_checkpoint_not_durable";
  }

  return {
    version: 2,
    disposition,
    automaticResumeAllowed: false,
    reason,
    startedTools: [...startedTools].sort(),
    completedTools: [...completedTools].sort(),
    startedActionIds: [...startedActionIds].sort(),
    completedActionIds: [...completedActionIds].sort(),
    sideEffectActionIds: [...sideEffectActionIds].sort(),
    assessedAt,
  };
}


export type AgentCheckpointRecoveryDisposition =
  | "checkpoint_compatible"
  | "inspect_before_resume"
  | "manual_review_required";

export interface AgentCheckpointRecoveryAssessment {
  version: 1;
  disposition: AgentCheckpointRecoveryDisposition;
  automaticResumeAllowed: false;
  reason:
    | "checkpoint_and_sandbox_match"
    | "checkpoint_missing"
    | "checkpoint_revision_mismatch"
    | "checkpoint_ownership_mismatch"
    | "checkpoint_action_journal_mismatch"
    | "checkpoint_action_outcome_unknown"
    | "approval_was_pending"
    | "checkpoint_state_invalid";
  checkpointSequence?: number;
  checkpointActionIds: string[];
  journalActionIds: string[];
  assessedAt: number;
}

/**
 * A checkpoint is eligible for a future resume implementation only when it
 * represents exactly the durable action journal and the current project tree.
 * This deliberately does not authorize automatic execution by itself.
 */
export function assessAgentCheckpointRecovery(input: {
  checkpoint?: {
    version?: unknown;
    jobId?: unknown;
    userId?: unknown;
    projectId?: unknown;
    sequence?: unknown;
    sandboxRevisionFingerprint?: unknown;
    toolActionIds?: unknown;
    resumeState?: {
      task?: unknown;
      builderTask?: unknown;
      repairRequested?: unknown;
      forceCompletionNextIteration?: unknown;
      remotePlannerRateLimited?: unknown;
      productPlannerCreated?: unknown;
    } | null;
  } | null;
  job: { id: string; userId: string; projectId?: string; pendingApproval?: { status?: unknown } | null };
  currentSandboxRevisionFingerprint?: string | null;
  toolActions: Array<{ actionId?: unknown; status?: unknown }>;
  assessedAt?: number;
}): AgentCheckpointRecoveryAssessment {
  const checkpoint = input.checkpoint;
  const checkpointActionIds = Array.isArray(checkpoint?.toolActionIds)
    ? checkpoint.toolActionIds.filter((id): id is string => typeof id === "string").sort()
    : [];
  const journalActionIds = input.toolActions
    .map((action) => action.actionId)
    .filter((id): id is string => typeof id === "string")
    .sort();
  const base = {
    version: 1 as const,
    automaticResumeAllowed: false as const,
    ...(Number.isSafeInteger(checkpoint?.sequence) ? { checkpointSequence: checkpoint.sequence as number } : {}),
    checkpointActionIds,
    journalActionIds,
    assessedAt: input.assessedAt ?? Date.now(),
  };
  const result = (
    disposition: AgentCheckpointRecoveryDisposition,
    reason: AgentCheckpointRecoveryAssessment["reason"],
  ): AgentCheckpointRecoveryAssessment => ({ ...base, disposition, reason });

  if (input.job.pendingApproval?.status === "pending") {
    return result("manual_review_required", "approval_was_pending");
  }
  if (!checkpoint) return result("inspect_before_resume", "checkpoint_missing");
  if (
    checkpoint.version !== 1 ||
    checkpoint.jobId !== input.job.id ||
    checkpoint.userId !== input.job.userId ||
    checkpoint.projectId !== input.job.projectId ||
    typeof checkpoint.sandboxRevisionFingerprint !== "string" ||
    !Number.isSafeInteger(checkpoint.sequence) ||
    (checkpoint.sequence as number) < 1 ||
    !Array.isArray(checkpoint.toolActionIds) ||
    checkpointActionIds.length !== checkpoint.toolActionIds.length
  ) {
    return result("manual_review_required", "checkpoint_ownership_mismatch");
  }
  const resumeState = checkpoint.resumeState;
  if (
    !resumeState ||
    typeof resumeState.task !== "string" || resumeState.task.length === 0 || resumeState.task.length > 100_000 ||
    typeof resumeState.builderTask !== "boolean" ||
    typeof resumeState.repairRequested !== "boolean" ||
    typeof resumeState.forceCompletionNextIteration !== "boolean" ||
    typeof resumeState.remotePlannerRateLimited !== "boolean" ||
    typeof resumeState.productPlannerCreated !== "boolean"
  ) {
    return result("manual_review_required", "checkpoint_state_invalid");
  }
  if (
    !input.currentSandboxRevisionFingerprint ||
    checkpoint.sandboxRevisionFingerprint !== input.currentSandboxRevisionFingerprint
  ) {
    return result("inspect_before_resume", "checkpoint_revision_mismatch");
  }
  if (input.toolActions.some((action) => typeof action.actionId !== "string" || !action.actionId.trim())) {
    return result("manual_review_required", "checkpoint_state_invalid");
  }
  if (input.toolActions.some((action) => action.status === "started")) {
    return result("inspect_before_resume", "checkpoint_action_outcome_unknown");
  }
  if (input.toolActions.some((action) => action.status !== "succeeded" && action.status !== "failed")) {
    return result("manual_review_required", "checkpoint_state_invalid");
  }
  if (
    new Set(checkpointActionIds).size !== checkpointActionIds.length ||
    new Set(journalActionIds).size !== journalActionIds.length ||
    checkpointActionIds.length !== journalActionIds.length ||
    checkpointActionIds.some((id, index) => id !== journalActionIds[index])
  ) {
    return result("inspect_before_resume", "checkpoint_action_journal_mismatch");
  }
  return result("checkpoint_compatible", "checkpoint_and_sandbox_match");
}
