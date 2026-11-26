import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { AgentIntent, AgentPlan, AgentToolResult, AgentExecutionPlan, ProductPlan } from "./types.js";
import type { AdaptiveTokenBudgetSnapshot } from "./tokenBudget.js";
import type { AgentExecutionSnapshot } from "./executionState.js";
import type { AgentPhase } from "./types.js";
import type { AgentTaskState } from "./taskState.js";
import { restoreAdaptiveTokenBudget, type AdaptiveTokenBudget } from "./tokenBudget.js";

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
  /** Original task and loop-control flags required to reconstruct the next iteration. */
  resumeState?: {
    task: string;
    builderTask: boolean;
    repairRequested: boolean;
    forceCompletionNextIteration: boolean;
    remotePlannerRateLimited: boolean;
    productPlannerCreated: boolean;
  };
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
    !["micro", "small", "medium", "large"].includes(item.tokenBudget.tier) ||
    !Number.isSafeInteger(item.tokenBudget.calls) || item.tokenBudget.calls < 0 ||
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
  const boundedArrays = [
    [item.previousResults, 40, "previousResults"],
    [item.toolActionIds, 40, "toolActionIds"],
    [item.seenActions, 1000, "seenActions"],
    [item.actionAttempts, 1000, "actionAttempts"],
    [item.seenPlannerContexts, 100, "seenPlannerContexts"],
    [item.actionSequence, 1000, "actionSequence"],
    [item.executionSnapshot.observations, 12, "observations"],
    [item.executionSnapshot.completedStepIds, 100, "completedStepIds"],
    [item.taskState.changedFiles, 500, "changedFiles"],
  ] as const;
  for (const [array, limit, label] of boundedArrays) {
    if (!Array.isArray(array) || array.length > limit) {
      throw new Error(`Agent checkpoint ${label} exceeds its safety limit.`);
    }
  }
  if (
    item.toolActionIds.some((id) => typeof id !== "string" || id.length === 0 || id.length > 128) ||
    new Set(item.toolActionIds).size !== item.toolActionIds.length
  ) {
    throw new Error("Agent checkpoint tool-action identifiers are invalid.");
  }
  const recordedToolActionIds = new Set(
    item.previousResults
      .map((result) => result && typeof result === "object" ? result.toolCallId : undefined)
      .filter((id): id is string => typeof id === "string"),
  );
  if (item.toolActionIds.some((id) => !recordedToolActionIds.has(id))) {
    throw new Error("Agent checkpoint tool-action journal references do not match tool history.");
  }
  if (item.previousResults.some((result) =>
    !result || typeof result !== "object" ||
    !Number.isSafeInteger(result.iteration) || result.iteration < 0 ||
    typeof result.tool !== "string" || result.tool.length === 0 || result.tool.length > 128 ||
    typeof result.input !== "string" || result.input.length > 100_000 ||
    !result.result || typeof result.result !== "object" ||
    typeof result.result.success !== "boolean" ||
    typeof result.result.output !== "string" || result.result.output.length > 100_000 ||
    (result.toolCallId !== undefined && (typeof result.toolCallId !== "string" || result.toolCallId.length > 128))
  )) {
    throw new Error("Agent checkpoint tool history is malformed or exceeds safety limits.");
  }
  if (
    item.seenActions.some((value) => typeof value !== "string" || value.length > 1800) ||
    item.seenPlannerContexts.some((value) => typeof value !== "string" || value.length > 5000) ||
    item.actionSequence.some((value) => typeof value !== "string" || value.length > 1800) ||
    item.actionAttempts.some((entry) => !Array.isArray(entry) || entry.length !== 2 ||
      typeof entry[0] !== "string" || entry[0].length > 1800 ||
      !Number.isSafeInteger(entry[1]) || entry[1] < 0)
  ) {
    throw new Error("Agent checkpoint planner/action history is malformed.");
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
  if (item.resumeState !== undefined) {
    const resume = item.resumeState;
    if (
      !resume || typeof resume.task !== "string" || resume.task.length === 0 || resume.task.length > 100_000 ||
      typeof resume.builderTask !== "boolean" ||
      typeof resume.repairRequested !== "boolean" ||
      typeof resume.forceCompletionNextIteration !== "boolean" ||
      typeof resume.remotePlannerRateLimited !== "boolean" ||
      typeof resume.productPlannerCreated !== "boolean"
    ) {
      throw new Error("Agent checkpoint loop-control state is invalid.");
    }
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


const FINGERPRINT_EXCLUDED_DIRS = new Set([".git", ".nexum", "node_modules", "dist", "coverage", ".cache", ".next", ".turbo", ".vercel", ".terraform", ".ssh", ".aws", ".azure"]);
const MAX_FINGERPRINT_FILES = 5000;

const MAX_FINGERPRINT_BYTES = 100 * 1024 * 1024;

function isSensitiveFingerprintPath(name: string): boolean {
  return /^\.env(?:\.|$)/i.test(name) ||
    /^(?:\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.dockerconfigjson)$/i.test(name) ||
    /^(?:credentials|service-account)(?:[-_.].*)?\.json$/i.test(name) ||
    /^(?:id_rsa|id_ed25519|id_ecdsa)(?:\..*)?$/i.test(name) ||
    /\.(?:pem|key|p12|pfx|keystore)$/i.test(name);
}

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
      if (isSensitiveFingerprintPath(entry.name)) continue;
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


export interface HydratedAgentCheckpoint {
  checkpoint: AgentExecutionCheckpoint;
  adaptiveBudget: AdaptiveTokenBudget;
  task: string;
  builderTask: boolean;
  repairRequested: boolean;
  forceCompletionNextIteration: boolean;
  remotePlannerRateLimited: boolean;
  productPlannerCreated: boolean;
}

/** Rehydrates validated planner/runtime continuation data without executing or replaying tools. */
export function hydrateAgentExecutionCheckpoint(value: unknown): HydratedAgentCheckpoint {
  validateAgentExecutionCheckpoint(value);
  const checkpoint = structuredClone(value);
  if (!checkpoint.resumeState) throw new Error("Agent checkpoint continuation state is incomplete.");
  const adaptiveBudget = restoreAdaptiveTokenBudget(checkpoint.resumeState.task, checkpoint.tokenBudget, {
    legacyHardCap: checkpoint.resumeState.builderTask ? 30_000 : 18_000,
    builderLifecycle: checkpoint.resumeState.builderTask,
  });
  return {
    checkpoint,
    adaptiveBudget,
    task: checkpoint.resumeState.task,
    builderTask: checkpoint.resumeState.builderTask,
    repairRequested: checkpoint.resumeState.repairRequested,
    forceCompletionNextIteration: checkpoint.resumeState.forceCompletionNextIteration,
    remotePlannerRateLimited: checkpoint.resumeState.remotePlannerRateLimited,
    productPlannerCreated: checkpoint.resumeState.productPlannerCreated,
  };
}
