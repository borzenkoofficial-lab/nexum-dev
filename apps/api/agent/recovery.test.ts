import test from "node:test";
import assert from "node:assert/strict";
import { assessChatJobRecovery } from "./recovery.js";

test("running job with completed read-only events still requires a durable checkpoint before retry", () => {
  const assessment = assessChatJobRecovery({
    status: "running",
    events: [
      { type: "tool-start", tool: "listFiles", iteration: 1 },
      { type: "tool-success", tool: "listFiles", iteration: 1 },
      { type: "tool-start", tool: "readFile", iteration: 2 },
      { type: "tool-success", tool: "readFile", iteration: 2 },
    ],
  }, 123);
  assert.equal(assessment.disposition, "inspect_before_retry");
  assert.equal(assessment.reason, "execution_checkpoint_not_durable");
  assert.equal(assessment.automaticResumeAllowed, false);
  assert.deepEqual(assessment.startedTools, ["listFiles", "readFile"]);
  assert.deepEqual(assessment.completedTools, ["listFiles", "readFile"]);
  assert.equal(assessment.assessedAt, 123);
});

test("write and execute activity requires project inspection before retry", () => {
  for (const tool of ["writeFile", "patchFile", "scaffoldProject", "runCommand", "runSandbox", "testProject"]) {
    const assessment = assessChatJobRecovery({
      events: [{ type: "tool-success", tool, iteration: 1 }],
    });
    assert.equal(assessment.disposition, "inspect_before_retry", tool);
    assert.equal(assessment.reason, "side_effect_may_have_started", tool);
    assert.equal(assessment.automaticResumeAllowed, false, tool);
  }
});

test("a tool start without a terminal result is treated as an unknown outcome", () => {
  const assessment = assessChatJobRecovery({
    events: [{ type: "tool-start", tool: "writeFile", iteration: 4 }],
  });
  assert.equal(assessment.disposition, "inspect_before_retry");
  assert.equal(assessment.reason, "tool_outcome_unknown");
});

test("interrupted pending approval requires manual review", () => {
  const assessment = assessChatJobRecovery({
    pendingApproval: { status: "pending" },
    events: [{ type: "tool-start", tool: "writeFile", iteration: 3 }],
  });
  assert.equal(assessment.disposition, "manual_review_required");
  assert.equal(assessment.reason, "approval_was_pending");
});

test("unknown tool activity fails closed to manual review", () => {
  const assessment = assessChatJobRecovery({
    events: [{ type: "tool-success", tool: "unregisteredTool", iteration: 1 }],
  });
  assert.equal(assessment.disposition, "manual_review_required");
  assert.equal(assessment.reason, "unrecognized_tool_activity");
});

test("persisted write steps remain unsafe even when their event stream is incomplete", () => {
  const assessment = assessChatJobRecovery({
    steps: [{ tool: "writeFile", success: true }, { tool: "patchFile", success: true }],
    events: [],
  });
  assert.equal(assessment.disposition, "inspect_before_retry");
  assert.equal(assessment.reason, "side_effect_may_have_started");
  assert.deepEqual(assessment.completedTools, ["patchFile", "writeFile"]);
});

test("running job without durable tool evidence is not considered safe to restart", () => {
  const assessment = assessChatJobRecovery({ status: "running", events: [], steps: [] });
  assert.equal(assessment.disposition, "inspect_before_retry");
  assert.equal(assessment.reason, "execution_evidence_missing");
});

test("queued job with no execution activity can safely be started", () => {
  const assessment = assessChatJobRecovery({ status: "queued", events: [], steps: [] });
  assert.equal(assessment.disposition, "safe_to_restart");
  assert.equal(assessment.reason, "queued_before_execution");
});

test("durable journal records an unfinished write even when UI events are missing", () => {
  const assessment = assessChatJobRecovery({
    status: "running",
    events: [],
    steps: [],
    toolActions: [{
      actionId: "action-unfinished-write",
      tool: "writeFile",
      risk: "WRITE",
      status: "started",
    }],
  });
  assert.equal(assessment.disposition, "inspect_before_retry");
  assert.equal(assessment.reason, "tool_outcome_unknown");
  assert.deepEqual(assessment.startedActionIds, ["action-unfinished-write"]);
  assert.deepEqual(assessment.completedActionIds, []);
  assert.deepEqual(assessment.sideEffectActionIds, ["action-unfinished-write"]);
});

test("durable journal records completed side effects even if UI snapshots were lost", () => {
  const assessment = assessChatJobRecovery({
    status: "running",
    events: [],
    steps: [],
    toolActions: [{
      actionId: "action-completed-command",
      tool: "runCommand",
      risk: "EXECUTE",
      status: "succeeded",
    }],
  });
  assert.equal(assessment.disposition, "inspect_before_retry");
  assert.equal(assessment.reason, "side_effect_may_have_started");
  assert.deepEqual(assessment.completedActionIds, ["action-completed-command"]);
  assert.deepEqual(assessment.sideEffectActionIds, ["action-completed-command"]);
});

test("durable journal rejects malformed or unknown action metadata", () => {
  const assessment = assessChatJobRecovery({
    status: "running",
    toolActions: [{ actionId: "bad-action", tool: "unknown", risk: "UNKNOWN", status: "started" }],
  });
  assert.equal(assessment.disposition, "manual_review_required");
  assert.equal(assessment.reason, "unrecognized_tool_activity");
});
