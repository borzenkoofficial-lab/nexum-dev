import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { AgentIntent, AgentPlan, AgentToolResult, AgentExecutionPlan, ProductPlan } from "./types.js";
import type { AdaptiveTokenBudgetSnapshot } from "./tokenBudget.js";
import type { AgentExecutionSnapshot } from "./executionState.js";
import type { AgentPhase } from "./types.js";
import type { AgentTaskState } from "./taskState.js";

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
  phase: AgentPhase;
  iteration: number;
  executionSnapshot: AgentExecutionSnapshot;
  taskState: Omit<AgentTaskState, "changedFiles"> & { changedFiles: string[] };
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

export function isAgentExecutionCheckpointEncryptionConfigured(): boolean {
  try {
    checkpointKey();
    return true;
  } catch {
    return false;
  }
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
    !item.executionSnapshot || !item.taskState ||
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
  if (
    item.executionSnapshot.intent.agentJobId !== item.jobId ||
    item.executionSnapshot.plan.agentJobId !== item.jobId ||
    item.executionSnapshot.intent.projectId !== item.projectId ||
    !Array.isArray(item.executionSnapshot.observations) ||
    !Array.isArray(item.executionSnapshot.completedStepIds) ||
    !Array.isArray(item.taskState.changedFiles) ||
    !item.taskState.verified ||
    !item.taskState.verifiedAtChangeVersion
  ) {
    throw new Error("Agent checkpoint snapshot state is invalid.");
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


const FINGERPRINT_EXCLUDED_DIRS = new Set([".git", ".nexum", "node_modules", "dist", "coverage", ".cache"]);
const MAX_FINGERPRINT_FILES = 5000;
const MAX_FINGERPRINT_BYTES = 100 * 1024 * 1024;

/**
 * Computes a content fingerprint of the project tree without persisting file
 * contents. Secret environment files and private key material are excluded.
 * Symlinks are deliberately ignored so the walk cannot escape the project.
 */
export async function computeProjectRevisionFingerprint(projectRoot: string): Promise<string> {
  const root = resolve(projectRoot);
  const files: Array<{ path: string; size: number; digest: string }> = [];
  let totalBytes = 0;

  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isDirectory() && FINGERPRINT_EXCLUDED_DIRS.has(entry.name)) continue;
      if (/^\.env(?:\.|$)/i.test(entry.name) || /\.(?:pem|key|p12|pfx)$/i.test(entry.name)) continue;
      const absolute = resolve(directory, entry.name);
      const details = await lstat(absolute);
      if (details.isSymbolicLink()) continue;
      if (details.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!details.isFile()) continue;
      if (files.length >= MAX_FINGERPRINT_FILES) throw new Error("Project revision fingerprint exceeds the 5000 file limit.");
      totalBytes += details.size;
      if (totalBytes > MAX_FINGERPRINT_BYTES) throw new Error("Project revision fingerprint exceeds the 100 MB limit.");
      const content = await readFile(absolute);
      const after = await lstat(absolute);
      if (!after.isFile() || after.size !== details.size || after.mtimeMs !== details.mtimeMs) {
        throw new Error("Project changed while its revision fingerprint was being calculated.");
      }
      files.push({
        path: relative(root, absolute).split(sep).join("/"),
        size: details.size,
        digest: createHash("sha256").update(content).digest("hex"),
      });
    }
  };

  await walk(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const tree = createHash("sha256");
  for (const file of files) tree.update(file.path).update("\0").update(String(file.size)).update("\0").update(file.digest).update("\n");
  return `sha256:${tree.digest("hex")}`;
}
