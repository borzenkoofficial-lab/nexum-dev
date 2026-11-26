import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  decryptAgentExecutionCheckpoint,
  encryptAgentExecutionCheckpoint,
  type AgentExecutionCheckpoint,
} from "./executionCheckpoint.js";

function fixture(): AgentExecutionCheckpoint {
  const intent = {
    requestId: "request-1",
    projectId: "project-1",
    taskId: "task-1",
    agentJobId: "job-1",
    type: "modify" as const,
    objective: "Inspect and update the project",
    requirements: [],
    constraints: [],
    acceptanceCriteria: [],
    unknowns: [],
    createdAt: 100,
  };
  return {
    version: 1,
    jobId: "job-1",
    userId: "user-1",
    projectId: "project-1",
    sequence: 1,
    createdAt: 200,
    phase: "implement",
    iteration: 2,
    executionSnapshot: {
      intent,
      state: "EXECUTING",
      plan: {
        planId: "plan-1",
        taskId: "task-1",
        agentJobId: "job-1",
        goal: intent.objective,
        steps: [],
        acceptanceCriteria: [],
        risks: [],
        createdAt: 100,
      },
      observations: ["Observed initial state."],
      completedStepIds: ["understand"],
      repairAttempts: 0,
      startedAt: 100,
      updatedAt: 200,
    },
    taskState: {
      phase: "implement",
      goal: intent.objective,
      startedAt: 100,
      changeVersion: 0,
      changedFiles: ["src/App.tsx"],
      verified: { build: false, tests: false, staticValidation: false, domain: false, review: false },
      verifiedAtChangeVersion: { build: -1, tests: -1, staticValidation: -1, domain: -1, review: -1, reviewAttempted: -1 },
    },

    intent,
    executionPlan: {
      planId: "plan-1",
      taskId: "task-1",
      agentJobId: "job-1",
      goal: intent.objective,
      steps: [],
      acceptanceCriteria: [],
      risks: [],
      createdAt: 100,
    },
    previousResults: [{
      iteration: 1,
      tool: "readFile",
      input: "src/App.tsx",
      result: { success: true, output: "private project source" },
      toolCallId: "action-1",
    }],
    counters: {
      modelTurns: 1,
      aiPlannerCalls: 1,
      productPlannerAttempts: 0,
      productReviewAttempts: 0,
      repairAttempts: 0,
      eventId: 3,
    },
    tokenBudget: { tier: "small", hardCap: 7000, reserved: 1000, remaining: 6000, calls: 1 },
    seenActions: [],
    actionAttempts: [],
    seenPlannerContexts: [],
    actionSequence: [],
    toolActionIds: ["action-1"],
    sandboxRevisionFingerprint: "sha256:project-revision",
  };
}

test("Agent execution checkpoints are encrypted and round-trip with ownership", () => {
  const previous = process.env.KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY;
  process.env.KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const source = fixture();
    const encrypted = encryptAgentExecutionCheckpoint(source);
    assert.equal(encrypted.algorithm, "aes-256-gcm");
    assert.equal(encrypted.ciphertext.includes("private project source"), false);
    assert.deepEqual(decryptAgentExecutionCheckpoint(encrypted), source);
  } finally {
    if (previous === undefined) delete process.env.KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY;
    else process.env.KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY = previous;
  }
});

test("Agent execution checkpoints fail closed when encryption key is missing or malformed", () => {
  const previous = process.env.KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY;
  delete process.env.KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY;
  try {
    assert.throws(() => encryptAgentExecutionCheckpoint(fixture()), /durable Agent checkpoints are disabled/);
    process.env.KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY = "not-a-32-byte-key";
    assert.throws(() => encryptAgentExecutionCheckpoint(fixture()), /base64-encoded 32-byte key/);
  } finally {
    if (previous === undefined) delete process.env.KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY;
    else process.env.KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY = previous;
  }
});

test("Agent execution checkpoints reject ciphertext tampering and metadata substitution", () => {
  const previous = process.env.KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY;
  process.env.KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const encrypted = encryptAgentExecutionCheckpoint(fixture());
    assert.throws(() => decryptAgentExecutionCheckpoint({ ...encrypted, userId: "other-user" }));
    assert.throws(() => decryptAgentExecutionCheckpoint({ ...encrypted, ciphertext: Buffer.from("tampered").toString("base64") }));
  } finally {
    if (previous === undefined) delete process.env.KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY;
    else process.env.KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY = previous;
  }
});
