import test from "node:test";
import assert from "node:assert/strict";
import { assessChatJobRecovery } from "./recovery.js";

test("read-only completed activity is classified as safe to restart, never auto-resume", () => {
  const assessment = assessChatJobRecovery({
    events: [
      { type: "tool-start", tool: "listFiles", iteration: 1 },
      { type: "tool-success", tool: "listFiles", iteration: 1 },
      { type: "tool-start", tool: "readFile", iteration: 2 },
      { type: "tool-success", tool: "readFile", iteration: 2 },
    ],
  }, 123);
  assert.equal(assessment.disposition, "safe_to_restart");
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
