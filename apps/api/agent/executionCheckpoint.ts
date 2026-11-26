import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { AgentIntent, AgentPlan, AgentToolResult, AgentExecutionPlan, ProductPlan } from "./types.js";
import type { AdaptiveTokenBudgetSnapshot } from "./tokenBudget.js";

export const AGENT_EXECUTION_CHECKPOINT_VERSION = 1 as const;
const KEY_ENV = "KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY";
const MAX_CHECKPOINT_BYTES = 2 * 1024 * 1024;

export interface AgentExecutionCheckpoint {
  version: typeof AGENT_EXECUTION_CHECKPOINT_VERSION;
  jobId: string;
  userId: string;
  projectId: string;
  sequence: number;
  createdAt: number;
  phase: string;
  iteration: number;
  intent: AgentIntent;
  executionPlan: AgentExecutionPlan;
  productPlan?: ProductPlan;
  previousResults: AgentToolResult[];
  pendingPlan?: AgentPlan;
  counters: {
    modelTurns: number;
    aiPlannerCalls: number;
    productPlannerAttempts: number;
    productReviewAttempts: number;
    repairAttempts: number;
    eventId: number;
  };
  tokenBudget: AdaptiveTokenBudgetSnapshot;
  seenActions: string[];
  actionAttempts: Array<[string, number]>;
  seenPlannerContexts: string[];
  actionSequence: string[];
  toolActionIds: string[];
  sandboxRevisionFingerprint: string;
}

export interface EncryptedAgentCheckpoint {
  version: typeof AGENT_EXECUTION_CHECKPOINT_VERSION;
  jobId: string;
  userId: string;
  projectId: string;
  sequence: number;
  createdAt: number;
  algorithm: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
}

function checkpointKey(): Buffer {
  const encoded = process.env[KEY_ENV]?.trim();
  if (!encoded) throw new Error(`${KEY_ENV} is not configured; durable Agent checkpoints are disabled.`);
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error(`${KEY_ENV} must be a base64-encoded 32-byte key.`);
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) throw new Error(`${KEY_ENV} must be a base64-encoded 32-byte key.`);
  return key;
}

function associatedData(checkpoint: Pick<AgentExecutionCheckpoint, "version" | "jobId" | "userId" | "projectId" | "sequence">): Buffer {
  return Buffer.from([
    "kvard-agent-checkpoint",
    String(checkpoint.version),
    checkpoint.jobId,
    checkpoint.userId,
    checkpoint.projectId,
    String(checkpoint.sequence),
  ].join(":"), "utf8");
}

export function validateAgentExecutionCheckpoint(value: unknown): asserts value is AgentExecutionCheckpoint {
  if (!value || typeof value !== "object") throw new Error("Agent checkpoint payload must be an object.");
  const item = value as Partial<AgentExecutionCheckpoint>;
  if (item.version !== AGENT_EXECUTION_CHECKPOINT_VERSION) throw new Error("Unsupported Agent checkpoint version.");
  if (![item.jobId, item.userId, item.projectId, item.sandboxRevisionFingerprint].every((part) => typeof part === "string" && part.length > 0)) {
    throw new Error("Agent checkpoint ownership or sandbox revision metadata is missing.");
  }
  if (!Number.isSafeInteger(item.sequence) || (item.sequence ?? 0) < 1) throw new Error("Agent checkpoint sequence is invalid.");
  if (!Number.isSafeInteger(item.iteration) || (item.iteration ?? -1) < 0) throw new Error("Agent checkpoint iteration is invalid.");
  if (
    !Number.isFinite(item.createdAt) ||
    !["analyze", "plan", "implement", "validate", "repair", "verify", "finish"].includes(String(item.phase)) ||
    !Array.isArray(item.previousResults) ||
    !Array.isArray(item.toolActionIds) ||
    !Array.isArray(item.seenActions) ||
    !Array.isArray(item.actionAttempts) ||
    !Array.isArray(item.seenPlannerContexts) ||
    !Array.isArray(item.actionSequence)
  ) {
    throw new Error("Agent checkpoint execution state is incomplete.");
  }
  if (!item.intent || !item.executionPlan || !item.counters || !item.tokenBudget) {
    throw new Error("Agent checkpoint is missing required execution state.");
  }
  if (
    ![item.counters.modelTurns, item.counters.aiPlannerCalls, item.counters.productPlannerAttempts,
      item.counters.productReviewAttempts, item.counters.repairAttempts, item.counters.eventId]
      .every((count) => Number.isSafeInteger(count) && count >= 0) ||
    !Number.isSafeInteger(item.tokenBudget.hardCap) ||
    !Number.isSafeInteger(item.tokenBudget.reserved) ||
    item.tokenBudget.hardCap < 0 ||
    item.tokenBudget.reserved < 0 ||
    item.tokenBudget.reserved > item.tokenBudget.hardCap ||
    item.tokenBudget.remaining !== item.tokenBudget.hardCap - item.tokenBudget.reserved
  ) {
    throw new Error("Agent checkpoint counters or token budget are invalid.");
  }
  if (item.executionPlan.agentJobId !== item.jobId || item.intent.agentJobId !== item.jobId || item.intent.projectId !== item.projectId) {
    throw new Error("Agent checkpoint ownership does not match its execution state.");
  }
}

export function encryptAgentExecutionCheckpoint(checkpoint: AgentExecutionCheckpoint): EncryptedAgentCheckpoint {
  validateAgentExecutionCheckpoint(checkpoint);
  const plaintext = Buffer.from(JSON.stringify(checkpoint), "utf8");
  if (plaintext.length > MAX_CHECKPOINT_BYTES) throw new Error("Agent checkpoint exceeds the maximum encrypted payload size.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", checkpointKey(), iv);
  cipher.setAAD(associatedData(checkpoint));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: checkpoint.version,
    jobId: checkpoint.jobId,
    userId: checkpoint.userId,
    projectId: checkpoint.projectId,
    sequence: checkpoint.sequence,
    createdAt: checkpoint.createdAt,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptAgentExecutionCheckpoint(envelope: EncryptedAgentCheckpoint): AgentExecutionCheckpoint {
  if (envelope.algorithm !== "aes-256-gcm" || envelope.version !== AGENT_EXECUTION_CHECKPOINT_VERSION) {
    throw new Error("Unsupported encrypted Agent checkpoint envelope.");
  }
  const iv = Buffer.from(envelope.iv, "base64");
  const authTag = Buffer.from(envelope.authTag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
    throw new Error("Encrypted Agent checkpoint envelope is malformed.");
  }
  const decipher = createDecipheriv("aes-256-gcm", checkpointKey(), iv);
  decipher.setAAD(associatedData(envelope));
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  if (plaintext.length > MAX_CHECKPOINT_BYTES) throw new Error("Decrypted Agent checkpoint exceeds the maximum payload size.");
  const checkpoint = JSON.parse(plaintext.toString("utf8")) as unknown;
  validateAgentExecutionCheckpoint(checkpoint);
  if (
    checkpoint.jobId !== envelope.jobId ||
    checkpoint.userId !== envelope.userId ||
    checkpoint.projectId !== envelope.projectId ||
    checkpoint.sequence !== envelope.sequence ||
    checkpoint.createdAt !== envelope.createdAt
  ) throw new Error("Encrypted Agent checkpoint metadata does not match its payload.");
  return checkpoint;
}
