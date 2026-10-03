import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentStateMachine, canTransitionAgentState } from "./stateMachine.js";

test("agent state machine accepts the canonical execution path", () => {
  const machine = new AgentStateMachine();
  for (const state of ["UNDERSTANDING", "PLANNING", "EXECUTING", "OBSERVING", "VALIDATING", "VERIFYING", "COMPLETED"] as const) {
    machine.transition(state);
  }
  assert.equal(machine.state, "COMPLETED");
});

test("terminal states cannot resurrect", () => {
  assert.equal(canTransitionAgentState("CANCELLED", "EXECUTING"), false);
  assert.equal(canTransitionAgentState("CANCELLED", "COMPLETED"), false);
  assert.equal(canTransitionAgentState("COMPLETED", "EXECUTING"), false);
  assert.equal(canTransitionAgentState("FAILED", "READY" as never), false);
});

test("invalid transitions fail closed", () => {
  const machine = new AgentStateMachine();
  assert.throws(() => machine.transition("COMPLETED"));
  machine.transition("UNDERSTANDING");
  assert.throws(() => machine.transition("EXECUTING"));
});

test("cancellation is terminal and idempotent at the execution boundary", () => {
  const machine = new AgentStateMachine();
  machine.transition("UNDERSTANDING");
  machine.transition("CANCELLED");
  assert.equal(machine.state, "CANCELLED");
  assert.equal(canTransitionAgentState(machine.state, "CANCELLED"), true);
  assert.equal(canTransitionAgentState(machine.state, "RUNNING" as never), false);
});
