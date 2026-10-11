import test from "node:test";
import assert from "node:assert/strict";
import { createAgentIntent } from "./intent.js";
import { createExecutionPlan, evaluateCompletionGate, markPlanStepCompleted, markPlanStepSkipped, transitionAgentState } from "./executionState.js";
import type { AgentState } from "./types.js";

function snapshot(state: AgentState = "COMPLETED") {
  const intent = createAgentIntent("Измени приложение", { requestId: "r", projectId: "p", taskId: "t", agentJobId: "j" });
  return { intent, state, plan: createExecutionPlan(intent), observations: [], completedStepIds: [], repairAttempts: 0, startedAt: Date.now(), updatedAt: Date.now() };
}

test("terminal Agent states reject resurrection", () => {
  const s = snapshot();
  const diagnostics: string[] = [];
  assert.equal(transitionAgentState(s, "EXECUTING", (message) => diagnostics.push(message)), false);
  assert.equal(s.state, "COMPLETED");
  assert.match(diagnostics[0] ?? "", /Terminal Agent state/);
});

test("completion gate requires real execution evidence", () => {
  const result = evaluateCompletionGate({ hasPlan: true, hasExecuted: false, validationPassed: true, acceptanceCriteriaSatisfied: true, noCriticalErrors: true, projectStateConsistent: true });
  assert.equal(result.ok, false);
  assert.match(result.reasons.join("; "), /execution step completed/);
});

test("plan completion helpers record terminal timestamps", () => {
  const s = snapshot();
  markPlanStepSkipped(s.plan, "repair", "not required");
  markPlanStepCompleted(s.plan, "verify", "verified");
  const repair = s.plan.steps.find((step) => step.id === "repair")!;
  const verify = s.plan.steps.find((step) => step.id === "verify")!;
  assert.equal(repair.status, "SKIPPED");
  assert.equal(verify.status, "COMPLETED");
  assert.equal(typeof repair.completedAt, "number");
  assert.equal(typeof verify.completedAt, "number");
});

test("Agent state machine supports the full implement-validate-repair-verify lifecycle", () => {
  const s = snapshot("IDLE");
  const transitions: AgentState[] = [
    "UNDERSTANDING",
    "PLANNING",
    "EXECUTING",
    "OBSERVING",
    "VALIDATING",
    "REPAIRING",
    "EXECUTING",
    "OBSERVING",
    "VALIDATING",
    "VERIFYING",
    "COMPLETED",
  ];
  const diagnostics: string[] = [];

  for (const next of transitions) {
    assert.equal(
      transitionAgentState(s, next, (message) => diagnostics.push(message)),
      true,
      `Expected transition to ${next} to be allowed; diagnostics: ${diagnostics.join("; ")}`,
    );
    assert.equal(s.state, next);
  }
});

test("failed and cancelled Agent states are terminal", () => {
  for (const terminal of ["FAILED", "CANCELLED"] as const) {
    const s = snapshot(terminal);
    const diagnostics: string[] = [];
    assert.equal(transitionAgentState(s, "UNDERSTANDING", (message) => diagnostics.push(message)), false);
    assert.equal(s.state, terminal);
    assert.match(diagnostics.join("; "), /Terminal Agent state/);
  }
});

test("invalid transitions are rejected without mutating state or timestamp", () => {
  const s = snapshot("IDLE");
  const before = s.updatedAt;
  const diagnostics: string[] = [];

  assert.equal(transitionAgentState(s, "COMPLETED", (message) => diagnostics.push(message)), false);
  assert.equal(s.state, "IDLE");
  assert.equal(s.updatedAt, before);
  assert.match(diagnostics.join("; "), /Invalid Agent state transition/);
});
