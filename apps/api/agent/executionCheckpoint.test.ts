import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  computeProjectRevisionFingerprint,
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
    resumeState: {
      task: "Inspect and update the project",
      builderTask: true,
      repairRequested: false,
      forceCompletionNextIteration: false,
      remotePlannerRateLimited: false,
      productPlannerCreated: true,
    },
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


test("project revision fingerprint tracks source changes but excludes runtime and secret files", async () => {
  const root = await mkdtemp(join(tmpdir(), "kvard-checkpoint-fingerprint-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(root, ".nexum"), { recursive: true });
    await writeFile(join(root, "src", "App.tsx"), "export const App = 1;");
    await writeFile(join(root, ".env"), "SECRET=first");
    await writeFile(join(root, "node_modules", "pkg", "index.js"), "ignored");
    await writeFile(join(root, ".nexum", "agent-state.json"), "ignored");
    const initial = await computeProjectRevisionFingerprint(root);
    await writeFile(join(root, ".env"), "SECRET=second");
    await writeFile(join(root, "node_modules", "pkg", "index.js"), "ignored changed");
    await writeFile(join(root, ".nexum", "agent-state.json"), "ignored changed");
    assert.equal(await computeProjectRevisionFingerprint(root), initial);
    await writeFile(join(root, "src", "App.tsx"), "export const App = 2;");
    assert.notEqual(await computeProjectRevisionFingerprint(root), initial);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("project revision fingerprint excludes credential files and never follows symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "kvard-checkpoint-secrets-"));
  const outside = await mkdtemp(join(tmpdir(), "kvard-checkpoint-outside-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "index.ts"), "export const safe = true;");
    await writeFile(join(root, ".npmrc"), "//registry.example/:_authToken=secret-one");
    await writeFile(join(root, "credentials.json"), "{\"token\":\"secret-one\"}");
    await writeFile(join(root, "service-account-prod.json"), "{\"private_key\":\"secret-one\"}");
    await writeFile(join(root, "id_ed25519"), "PRIVATE KEY ONE");
    await writeFile(join(outside, "outside-secret.txt"), "outside-one");
    await symlink(outside, join(root, "linked-outside"), "dir");
    const initial = await computeProjectRevisionFingerprint(root);
    await writeFile(join(root, ".npmrc"), "//registry.example/:_authToken=secret-two");
    await writeFile(join(root, "credentials.json"), "{\"token\":\"secret-two\"}");
    await writeFile(join(root, "service-account-prod.json"), "{\"private_key\":\"secret-two\"}");
    await writeFile(join(root, "id_ed25519"), "PRIVATE KEY TWO");
    await writeFile(join(outside, "outside-secret.txt"), "outside-two");
    assert.equal(await computeProjectRevisionFingerprint(root), initial);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});


test("Agent execution checkpoints reject malformed loop continuation state", () => {
  const previous = process.env.KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY;
  process.env.KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const invalid = {
      ...fixture(),
      resumeState: {
        ...fixture().resumeState!,
        task: "",
        forceCompletionNextIteration: "yes",
      },
    };
    assert.throws(() => encryptAgentExecutionCheckpoint(invalid as unknown as AgentExecutionCheckpoint), /loop-control state is invalid/);
  } finally {
    if (previous === undefined) delete process.env.KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY;
    else process.env.KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY = previous;
  }
});
