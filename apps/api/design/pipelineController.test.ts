import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPipelineController, decidePipelineRecovery, recoveryPromptFor } from "./pipelineController.js";
import type { PipelineGate } from "./autonomousPipeline.js";

const gates = (failed?: string): PipelineGate[] =>
  ["design", "components", "interactions", "verification", "build", "live"].map((name) => ({
    name,
    passed: name !== failed,
    detail: name === failed ? "failed gate" : "passed",
  }));

const snapshot = {
  design: { version: 1, components: [], interactions: [] } as never,
  componentCount: 1,
  interactionCount: 1,
  verification: { passed: true } as never,
  live: { buildReady: true } as never,
  buildVerified: true,
};

describe("pipelineController", () => {
  it("finishes when every gate passes", () => {
    const state = createPipelineController();
    const decision = decidePipelineRecovery(snapshot, gates(), state);
    assert.equal(decision.passed, true);
    assert.equal(decision.action, "finish");
    assert.equal(decision.attempts, 0);
  });

  it("maps failed gates to bounded recovery actions", () => {
    const state = createPipelineController(2);
    const decision = decidePipelineRecovery(snapshot, gates("build"), state);
    assert.equal(decision.passed, false);
    assert.equal(decision.action, "rebuild");
    assert.equal(decision.attempts, 1);
    assert.equal(decision.exhausted, false);
  });

  it("stops after the configured recovery bound", () => {
    const state = createPipelineController(1);
    decidePipelineRecovery(snapshot, gates("verification"), state);
    const decision = decidePipelineRecovery(snapshot, gates("verification"), state);
    assert.equal(decision.exhausted, true);
    assert.match(recoveryPromptFor(decision), /AUTONOMOUS PIPELINE RECOVERY/);
  });
});
