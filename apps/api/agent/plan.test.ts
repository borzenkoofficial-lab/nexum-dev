import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlanDocument, planIsComplete, transitionPlanStep } from "./plan.js";
import { createAgentIntent } from "./intent.js";

test("plan steps become ready only after dependencies complete", () => {
  const intent = createAgentIntent("Build and verify the project", { taskId: "task-1" });
  let plan = createPlanDocument(intent, [
    { id: "inspect", description: "Inspect project", dependencies: [] },
    { id: "build", description: "Build project", dependencies: ["inspect"] },
    { id: "verify", description: "Verify result", dependencies: ["build"] },
  ]);

  assert.equal(plan.steps[0]?.status, "READY");
  assert.equal(plan.steps[1]?.status, "PENDING");
  plan = transitionPlanStep(plan, "inspect", "RUNNING");
  plan = transitionPlanStep(plan, "inspect", "COMPLETED", "project inspected");
  assert.equal(plan.steps[1]?.status, "READY");
  assert.equal(planIsComplete(plan), false);
});

test("completed plan is explicit", () => {
  const intent = createAgentIntent("Verify", { taskId: "task-2" });
  let plan = createPlanDocument(intent, [{ id: "verify", description: "Verify", dependencies: [] }]);
  plan = transitionPlanStep(plan, "verify", "RUNNING");
  plan = transitionPlanStep(plan, "verify", "COMPLETED", "passed");
  assert.equal(planIsComplete(plan), true);
});
