import { describe, expect, it } from "vitest";
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
    expect(decision.passed).toBe(true);
    expect(decision.action).toBe("finish");
    expect(decision.attempts).toBe(0);
  });

  it("maps failed gates to bounded recovery actions", () => {
    const state = createPipelineController(2);
    const decision = decidePipelineRecovery(snapshot, gates("build"), state);
    expect(decision.passed).toBe(false);
    expect(decision.action).toBe("rebuild");
    expect(decision.attempts).toBe(1);
    expect(decision.exhausted).toBe(false);
  });

  it("stops after the configured recovery bound", () => {
    const state = createPipelineController(1);
    decidePipelineRecovery(snapshot, gates("verification"), state);
    const decision = decidePipelineRecovery(snapshot, gates("verification"), state);
    expect(decision.exhausted).toBe(true);
    expect(recoveryPromptFor(decision)).toContain("AUTONOMOUS PIPELINE RECOVERY");
  });
});
