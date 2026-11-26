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


import { assessAgentCheckpointRecovery } from "./recovery.js";

function checkpointRecoveryFixture() {
  return {
    checkpoint: {
      version: 1,
      jobId: "job-1",
      userId: "user-1",
      projectId: "project-1",
      sequence: 4,
      sandboxRevisionFingerprint: "sha256:revision-a",
      toolActionIds: ["action-1", "action-2"],
    },
    job: { id: "job-1", userId: "user-1", projectId: "project-1" },
    currentSandboxRevisionFingerprint: "sha256:revision-a",
    toolActions: [
      { actionId: "action-1", status: "succeeded" },
      { actionId: "action-2", status: "failed" },
    ],
    assessedAt: 456,
  };
}

test("checkpoint recovery gate accepts only an exact sandbox and journal match", () => {
  const assessment = assessAgentCheckpointRecovery(checkpointRecoveryFixture());
  assert.equal(assessment.disposition, "checkpoint_compatible");
  assert.equal(assessment.reason, "checkpoint_and_sandbox_match");
  assert.equal(assessment.automaticResumeAllowed, false);
  assert.equal(assessment.checkpointSequence, 4);
  assert.deepEqual(assessment.checkpointActionIds, ["action-1", "action-2"]);
  assert.deepEqual(assessment.journalActionIds, ["action-1", "action-2"]);
  assert.equal(assessment.assessedAt, 456);
});

test("checkpoint recovery refuses a changed project revision", () => {
  const assessment = assessAgentCheckpointRecovery({
    ...checkpointRecoveryFixture(),
    currentSandboxRevisionFingerprint: "sha256:revision-b",
  });
  assert.equal(assessment.disposition, "inspect_before_resume");
  assert.equal(assessment.reason, "checkpoint_revision_mismatch");
});

test("checkpoint recovery refuses journal actions that happened after the checkpoint", () => {
  const fixture = checkpointRecoveryFixture();
  const assessment = assessAgentCheckpointRecovery({
    ...fixture,
    toolActions: [...fixture.toolActions, { actionId: "action-after-checkpoint", status: "succeeded" }],
  });
  assert.equal(assessment.disposition, "inspect_before_resume");
  assert.equal(assessment.reason, "checkpoint_action_journal_mismatch");
});

test("checkpoint recovery refuses unfinished tool actions and pending approvals", () => {
  const fixture = checkpointRecoveryFixture();
  const unfinished = assessAgentCheckpointRecovery({
    ...fixture,
    toolActions: [...fixture.toolActions, { actionId: "action-in-flight", status: "started" }],
  });
  assert.equal(unfinished.disposition, "inspect_before_resume");
  assert.equal(unfinished.reason, "checkpoint_action_outcome_unknown");

  const approval = assessAgentCheckpointRecovery({
    ...fixture,
    job: { ...fixture.job, pendingApproval: { status: "pending" } },
  });
  assert.equal(approval.disposition, "manual_review_required");
  assert.equal(approval.reason, "approval_was_pending");
});

test("checkpoint recovery fails closed on ownership substitution", () => {
  const fixture = checkpointRecoveryFixture();
  const assessment = assessAgentCheckpointRecovery({
    ...fixture,
    job: { ...fixture.job, userId: "another-user" },
  });
  assert.equal(assessment.disposition, "manual_review_required");
  assert.equal(assessment.reason, "checkpoint_ownership_mismatch");
});


test("checkpoint recovery rejects malformed journal entries instead of dropping them", () => {
  const fixture = checkpointRecoveryFixture();
  const assessment = assessAgentCheckpointRecovery({
    ...fixture,
    toolActions: [...fixture.toolActions, { status: "succeeded" }],
  });
  assert.equal(assessment.disposition, "manual_review_required");
  assert.equal(assessment.reason, "checkpoint_state_invalid");
});
