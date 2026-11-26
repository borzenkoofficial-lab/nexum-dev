import { query } from "./db.js";
import { createHash, randomUUID } from "node:crypto";
import { getToolSecurityPolicy, type ToolRisk } from "./agent/toolPolicy.js";
import { assessChatJobRecovery, type ChatJobRecoveryAssessment } from "./agent/recovery.js";

export type ChatJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type ChatJobStage = "queued" | "analyzing" | "planning" | "reading" | "editing" | "building" | "testing" | "awaiting_approval" | "completed" | "cancelled" | "error";

export type ChatJobApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled";

export interface ChatJobApproval {
  id: string;
  toolName: string;
  risk: ToolRisk;
  inputPreview: string;
  status: ChatJobApprovalStatus;
  createdAt: number;
  expiresAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  resumeStage?: ChatJobStage;
}

export interface ChatJob {
  id: string;
  status: ChatJobStatus;
  createdAt: number;
  updatedAt: number;
  reply?: string;
  steps?: unknown[];
  events?: unknown[];
  problems?: Array<{ message: string; source?: string }>;
  currentMessage?: string;
  commandOutput?: { command: string; stdout: string; stderr: string; exitCode: number | null };
  error?: string;
  errorCode?: string;
  errorInfo?: {
    code: string;
    message: string;
    retryable: boolean;
    category?: string;
    recoveryStrategy?: string;
  };
  stage?: ChatJobStage;
  attachments?: string[];
  productPlan?: unknown;
  checkpointId?: string;
  agentIntent?: unknown;
  executionPlan?: unknown;
  executionState?: unknown;
  validation?: unknown;
  telemetry?: unknown;
  userId: string;
  projectId?: string;
  runtimeTaskId?: string;
  requestId?: string;
  pendingApproval?: ChatJobApproval;
  recoveryAssessment?: ChatJobRecoveryAssessment;
}

let initialized: Promise<void> | null = null;
export interface ChatJobToolAction {
  actionId: string;
  jobId: string;
  userId: string;
  tool: string;
  risk: ToolRisk;
  inputSha256: string;
  status: "started" | "succeeded" | "failed";
  startedAt: number;
  completedAt?: number;
  resultSuccess?: boolean;
  resultSha256?: string;
}

const memoryJobs = new Map<string, ChatJob>();
const memoryLocks = new Map<string, { projectId: string; userId: string; jobId: string; expiresAt: number }>();
const memoryToolActions = new Map<string, ChatJobToolAction>();

function databaseAvailable(): boolean {
  return Boolean(process.env.NEXUM_DATABASE_URL?.trim());
}

function cloneJob(job: ChatJob): ChatJob {
  return JSON.parse(JSON.stringify(job)) as ChatJob;
}

async function ensureTable(): Promise<void> {
  if (!initialized) {
    initialized = query(`
      CREATE TABLE IF NOT EXISTS agent_chat_jobs (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id TEXT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE TABLE IF NOT EXISTS agent_project_locks (
        project_id TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_id UUID NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_chat_job_tool_actions (
        action_id UUID PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES agent_chat_jobs(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        risk TEXT NOT NULL CHECK (risk IN ('READ','WRITE','EXECUTE','DESTRUCTIVE')),
        input_sha256 TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('started','succeeded','failed')),
        started_at BIGINT NOT NULL,
        completed_at BIGINT NULL,
        result_success BOOLEAN NULL,
        result_sha256 TEXT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_chat_job_tool_actions_job_idx
        ON agent_chat_job_tool_actions(job_id, started_at ASC);
      -- Existing installations may have UUID project IDs; normalize only after each table exists.
      ALTER TABLE agent_chat_jobs DROP CONSTRAINT IF EXISTS agent_chat_jobs_status_check;
      ALTER TABLE agent_chat_jobs ADD CONSTRAINT agent_chat_jobs_status_check CHECK (status IN ('queued','running','completed','failed','cancelled'));
      CREATE INDEX IF NOT EXISTS agent_chat_jobs_user_updated_idx
        ON agent_chat_jobs(user_id, updated_at DESC);
      ALTER TABLE agent_chat_jobs ALTER COLUMN project_id TYPE TEXT USING project_id::text;
      ALTER TABLE agent_project_locks ALTER COLUMN project_id TYPE TEXT USING project_id::text;
      CREATE INDEX IF NOT EXISTS agent_project_locks_expiry_idx
        ON agent_project_locks(expires_at);
    `).then(() => undefined).catch((error) => {
      initialized = null;
      throw error;
    });
  }
  await initialized;
}

function encode(job: ChatJob): Record<string, unknown> {
  const { id, userId, projectId, status, createdAt, updatedAt, ...payload } = job;
  return { id, userId, projectId: projectId ?? null, status, createdAt, updatedAt, payload };
}

function decode(row: any): ChatJob {
  return { id: row.id, userId: row.user_id, projectId: row.project_id ?? undefined, status: row.status, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), ...(row.payload ?? {}) };
}


export async function acquireProjectLock(projectId: string, userId: string, jobId: string, ttlMs = 15 * 60 * 1000): Promise<boolean> {
  if (!databaseAvailable()) {
    const now = Date.now();
    const existing = memoryLocks.get(projectId);
    if (existing && existing.expiresAt >= now) return false;
    memoryLocks.set(projectId, { projectId, userId, jobId, expiresAt: now + ttlMs });
    return true;
  }
  await ensureTable();
  const result = await query(
    `INSERT INTO agent_project_locks (project_id,user_id,job_id,expires_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (project_id) DO UPDATE
       SET user_id=EXCLUDED.user_id, job_id=EXCLUDED.job_id, expires_at=EXCLUDED.expires_at
     WHERE agent_project_locks.expires_at < NOW()
     RETURNING project_id`,
    [projectId, userId, jobId, new Date(Date.now() + ttlMs).toISOString()],
  );
  return result.rows.length > 0;
}

export async function heartbeatProjectLock(projectId: string, jobId: string, ttlMs = 15 * 60 * 1000): Promise<boolean> {
  if (!databaseAvailable()) {
    const existing = memoryLocks.get(projectId);
    if (!existing || existing.jobId !== jobId) return false;
    existing.expiresAt = Date.now() + ttlMs;
    memoryLocks.set(projectId, existing);
    return true;
  }
  await ensureTable();
  const result = await query(
    `UPDATE agent_project_locks SET expires_at=$3
      WHERE project_id=$1 AND job_id=$2 RETURNING project_id`,
    [projectId, jobId, new Date(Date.now() + ttlMs).toISOString()],
  );
  return result.rows.length > 0;
}

export async function releaseProjectLock(projectId: string, jobId: string): Promise<void> {
  if (!databaseAvailable()) {
    const existing = memoryLocks.get(projectId);
    if (existing?.jobId === jobId) memoryLocks.delete(projectId);
    return;
  }
  await ensureTable();
  await query(`DELETE FROM agent_project_locks WHERE project_id=$1 AND job_id=$2`, [projectId, jobId]);
}

export async function createChatJob(job: ChatJob): Promise<void> {
  if (!databaseAvailable()) {
    memoryJobs.set(job.id, cloneJob(job));
    return;
  }
  await ensureTable();
  const data = encode(job);
  await query(
    `INSERT INTO agent_chat_jobs (id,user_id,project_id,status,created_at,updated_at,payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [data.id, data.userId, data.projectId, data.status, data.createdAt, data.updatedAt, JSON.stringify(data.payload)],
  );
}

export async function getChatJob(id: string, userId: string): Promise<ChatJob | null> {
  if (!databaseAvailable()) {
    const job = memoryJobs.get(id);
    return job && job.userId === userId ? cloneJob(job) : null;
  }
  await ensureTable();
  const result = await query(`SELECT * FROM agent_chat_jobs WHERE id=$1 AND user_id=$2 LIMIT 1`, [id, userId]);
  return result.rows[0] ? decode(result.rows[0]) : null;
}

export async function updateChatJob(id: string, userId: string, patch: Partial<ChatJob>): Promise<ChatJob | null> {
  if (!databaseAvailable()) {
    const current = memoryJobs.get(id);
    if (!current || current.userId !== userId || !["queued", "running"].includes(current.status)) return current ? cloneJob(current) : null;
    const next = cloneJob({ ...current, ...patch, id: current.id, userId: current.userId, updatedAt: patch.updatedAt ?? Date.now() });
    memoryJobs.set(id, next);
    return cloneJob(next);
  }
  await ensureTable();
  const current = await getChatJob(id, userId);
  if (!current) return null;
  const next: ChatJob = { ...current, ...patch, id: current.id, userId: current.userId, updatedAt: patch.updatedAt ?? Date.now() };
  const data = encode(next);
  const result = await query(
    `UPDATE agent_chat_jobs
        SET project_id=$3,status=$4,updated_at=$5,payload=$6::jsonb
      WHERE id=$1 AND user_id=$2 AND status IN ('queued','running')
      RETURNING *`,
    [id, userId, data.projectId, data.status, data.updatedAt, JSON.stringify(data.payload)],
  );
  return result.rows[0] ? decode(result.rows[0]) : null;
}



export async function requestChatJobApproval(
  id: string,
  userId: string,
  approval: ChatJobApproval,
): Promise<ChatJob | null> {
  if (approval.status !== "pending") throw new Error("A new chat job approval must be pending.");
  const useDatabase = databaseAvailable();
  const current = useDatabase ? await getChatJob(id, userId) : memoryJobs.get(id) ?? null;
  if (!current || current.userId !== userId || current.status !== "running" || current.pendingApproval?.status === "pending") return null;
  const now = Date.now();
  const event = {
    id: now,
    timestamp: now,
    iteration: current.steps?.length ?? 0,
    type: "approval",
    name: "agent.approval.requested",
    tool: approval.toolName,
    message: `Требуется подтверждение действия: ${approval.toolName} (${approval.risk}).`,
  };
  const next: ChatJob = {
    ...current,
    pendingApproval: { ...approval },
    stage: "awaiting_approval",
    currentMessage: `Ожидается подтверждение действия ${approval.toolName}.`,
    events: [...(current.events ?? []), event].slice(-100),
    updatedAt: now,
  };
  if (!useDatabase) {
    memoryJobs.set(id, cloneJob(next));
    return cloneJob(next);
  }
  await ensureTable();
  const data = encode(next);
  const result = await query(
    `UPDATE agent_chat_jobs
        SET updated_at=$3,payload=$4::jsonb
      WHERE id=$1 AND user_id=$2 AND status='running'
        AND (payload->'pendingApproval' IS NULL OR payload->'pendingApproval'->>'status' <> 'pending')
      RETURNING *`,
    [id, userId, next.updatedAt, JSON.stringify(data.payload)],
  );
  return result.rows[0] ? decode(result.rows[0]) : null;
}

export async function resolveChatJobApproval(
  id: string,
  userId: string,
  approvalId: string,
  decision: "approved" | "rejected" | "expired",
  resolvedBy: string,
): Promise<ChatJob | null> {
  const useDatabase = databaseAvailable();
  const current = useDatabase ? await getChatJob(id, userId) : memoryJobs.get(id) ?? null;
  const pending = current?.pendingApproval;
  if (!current || current.userId !== userId || current.status !== "running" || !pending || pending.id !== approvalId || pending.status !== "pending") return null;
  const now = Date.now();
  const message = decision === "approved"
    ? `Действие ${pending.toolName} подтверждено.`
    : decision === "expired"
      ? `Время ожидания подтверждения ${pending.toolName} истекло; действие отклонено.`
      : `Действие ${pending.toolName} отклонено пользователем.`;
  const event = {
    id: now,
    timestamp: now,
    iteration: current.steps?.length ?? 0,
    type: "approval",
    name: `agent.approval.${decision}`,
    tool: pending.toolName,
    message,
  };
  const next: ChatJob = {
    ...current,
    pendingApproval: { ...pending, status: decision, resolvedAt: now, resolvedBy },
    stage: pending.resumeStage ?? "analyzing",
    currentMessage: message,
    events: [...(current.events ?? []), event].slice(-100),
    updatedAt: now,
  };
  if (!useDatabase) {
    memoryJobs.set(id, cloneJob(next));
    return cloneJob(next);
  }
  await ensureTable();
  const data = encode(next);
  const result = await query(
    `UPDATE agent_chat_jobs
        SET updated_at=$3,payload=$4::jsonb
      WHERE id=$1 AND user_id=$2 AND status='running'
        AND payload->'pendingApproval'->>'id'=$5
        AND payload->'pendingApproval'->>'status'='pending'
      RETURNING *`,
    [id, userId, next.updatedAt, JSON.stringify(data.payload), approvalId],
  );
  return result.rows[0] ? decode(result.rows[0]) : null;
}

export async function claimChatJob(id: string, userId: string): Promise<ChatJob | null> {
  if (!databaseAvailable()) {
    const current = memoryJobs.get(id);
    if (!current || current.userId !== userId) return null;
    if (current.status !== "queued") return cloneJob(current);
    const next = cloneJob({ ...current, status: "running", stage: "analyzing", updatedAt: Date.now() });
    memoryJobs.set(id, next);
    return cloneJob(next);
  }
  await ensureTable();
  const current = await getChatJob(id, userId);
  if (!current || current.status !== "queued") return current;
  const next: ChatJob = { ...current, status: "running", stage: "analyzing", updatedAt: Date.now() };
  const data = encode(next);
  const result = await query(
    `UPDATE agent_chat_jobs
        SET status='running',updated_at=$3,payload=$4::jsonb
      WHERE id=$1 AND user_id=$2 AND status='queued'
      RETURNING *`,
    [id, userId, next.updatedAt, JSON.stringify(data.payload)],
  );
  return result.rows[0] ? decode(result.rows[0]) : await getChatJob(id, userId);
}

export async function completeChatJob(id: string, userId: string, patch: Partial<ChatJob>): Promise<ChatJob | null> {
  if (!databaseAvailable()) {
    const current = memoryJobs.get(id);
    if (!current || current.userId !== userId || !["queued", "running"].includes(current.status)) return current ? cloneJob(current) : null;
    const next = cloneJob({ ...current, ...patch, status: "completed", updatedAt: Date.now() });
    memoryJobs.set(id, next);
    return cloneJob(next);
  }
  await ensureTable();
  const current = await getChatJob(id, userId);
  if (!current || !["queued", "running"].includes(current.status)) return current;
  const next: ChatJob = { ...current, ...patch, status: "completed", updatedAt: Date.now() };
  const data = encode(next);
  const result = await query(
    `UPDATE agent_chat_jobs
        SET project_id=$3,status='completed',updated_at=$4,payload=$5::jsonb
      WHERE id=$1 AND user_id=$2 AND status IN ('queued','running')
      RETURNING *`,
    [id, userId, data.projectId, data.updatedAt, JSON.stringify(data.payload)],
  );
  return result.rows[0] ? decode(result.rows[0]) : await getChatJob(id, userId);
}

export async function failChatJob(id: string, userId: string, patch: Partial<ChatJob>): Promise<ChatJob | null> {
  if (!databaseAvailable()) {
    const current = memoryJobs.get(id);
    if (!current || current.userId !== userId || !["queued", "running"].includes(current.status)) return current ? cloneJob(current) : null;
    const next = cloneJob({ ...current, ...patch, status: "failed", updatedAt: Date.now() });
    memoryJobs.set(id, next);
    return cloneJob(next);
  }
  await ensureTable();
  const current = await getChatJob(id, userId);
  if (!current || !["queued", "running"].includes(current.status)) return current;
  const next: ChatJob = { ...current, ...patch, status: "failed", updatedAt: Date.now() };
  const data = encode(next);
  const result = await query(
    `UPDATE agent_chat_jobs
        SET project_id=$3,status='failed',updated_at=$4,payload=$5::jsonb
      WHERE id=$1 AND user_id=$2 AND status IN ('queued','running')
      RETURNING *`,
    [id, userId, data.projectId, data.updatedAt, JSON.stringify(data.payload)],
  );
  return result.rows[0] ? decode(result.rows[0]) : await getChatJob(id, userId);
}

export async function cancelChatJob(id: string, userId: string, message = "Agent task cancelled by user."): Promise<ChatJob | null> {
  if (!databaseAvailable()) {
    const current = memoryJobs.get(id);
    if (!current || current.userId !== userId || !["queued", "running"].includes(current.status)) return null;
    const events = Array.isArray(current.events) ? current.events : [];
    const now = Date.now();
    const approvalWasPending = current.pendingApproval?.status === "pending";
    const approvalEvent = approvalWasPending ? {
      id: now,
      timestamp: now,
      iteration: current.steps?.length ?? 0,
      type: "approval",
      name: "agent.approval.cancelled",
      tool: current.pendingApproval?.toolName,
      message: `Ожидающее действие ${current.pendingApproval?.toolName ?? "агента"} отменено вместе с заданием.`,
    } : null;
    const withApprovalEvent = approvalEvent && !events.some((event) => event && typeof event === "object" && (event as { name?: unknown }).name === "agent.approval.cancelled")
      ? [...events, approvalEvent]
      : events;
    const next = cloneJob({
      ...current,
      status: "cancelled",
      stage: "cancelled",
      error: message,
      pendingApproval: approvalWasPending
        ? { ...current.pendingApproval!, status: "cancelled", resolvedAt: now, resolvedBy: "system" }
        : current.pendingApproval,
      updatedAt: now,
      events: withApprovalEvent.some((event) => event && typeof event === "object" && (event as { name?: unknown }).name === "agent.cancelled")
        ? withApprovalEvent
        : [...withApprovalEvent, { id: now + 1, timestamp: now, type: "cancelled", name: "agent.cancelled", message }].slice(-100),
    });
    memoryJobs.set(id, next);
    if (next.projectId) {
      const lock = memoryLocks.get(next.projectId);
      if (lock?.jobId === id) memoryLocks.delete(next.projectId);
    }
    return cloneJob(next);
  }
  await ensureTable();
  const result = await query(
    `UPDATE agent_chat_jobs
        SET status='cancelled',
            updated_at=$3,
            payload=CASE
              WHEN payload->'pendingApproval'->>'status'='pending' THEN
                jsonb_set(
                  jsonb_set(
                    jsonb_set(payload, '{stage}', '"cancelled"'::jsonb, true),
                    '{error}', to_jsonb($4::text), true
                  ),
                  '{pendingApproval}',
                  jsonb_set(
                    jsonb_set(
                      jsonb_set(payload->'pendingApproval', '{status}', '"cancelled"'::jsonb, true),
                      '{resolvedAt}', to_jsonb($5::bigint), true
                    ),
                    '{resolvedBy}', '"system"'::jsonb, true
                  ),
                  true
                )
              ELSE jsonb_set(
                jsonb_set(payload, '{stage}', '"cancelled"'::jsonb, true),
                '{error}', to_jsonb($4::text), true
              )
            END
      WHERE id=$1 AND user_id=$2 AND status IN ('queued','running')
      RETURNING *`,
    [id, userId, Date.now(), message, Date.now()],
  );
  if (!result.rows[0]) return null;
  const cancelled = decode(result.rows[0]);
  const events = Array.isArray(cancelled.events) ? cancelled.events : [];
  const nextEvents = [...events];
  if (cancelled.pendingApproval?.status === "cancelled" && !events.some((event) => event && typeof event === "object" && (event as { name?: unknown }).name === "agent.approval.cancelled")) {
    nextEvents.push({
      id: Date.now(),
      timestamp: Date.now(),
      iteration: cancelled.steps?.length ?? 0,
      type: "approval",
      name: "agent.approval.cancelled",
      tool: cancelled.pendingApproval.toolName,
      message: `Ожидающее действие ${cancelled.pendingApproval.toolName} отменено вместе с заданием.`,
    });
  }
  if (!events.some((event) => event && typeof event === "object" && (event as { name?: unknown }).name === "agent.cancelled")) {
    nextEvents.push({
      id: Date.now() + 1,
      timestamp: Date.now(),
      type: "cancelled",
      name: "agent.cancelled",
      message,
    });
  }
  if (nextEvents.length !== events.length) {
    cancelled.events = nextEvents.slice(-100);
    await query(
      `UPDATE agent_chat_jobs SET updated_at=$2, payload=jsonb_set(payload, '{events}', $3::jsonb, true) WHERE id=$1 AND user_id=$4`,
      [id, cancelled.updatedAt, JSON.stringify(cancelled.events), userId],
    );
  }
  return cancelled;
}

export async function listChatJobs(userId?: string, limit = 20): Promise<ChatJob[]> {
  if (!databaseAvailable()) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    return [...memoryJobs.values()]
      .filter((job) => !userId || job.userId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, safeLimit)
      .map(cloneJob);
  }
  await ensureTable();
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const result = userId
    ? await query(`SELECT * FROM agent_chat_jobs WHERE user_id=$1 ORDER BY updated_at DESC LIMIT $2`, [userId, safeLimit])
    : await query(`SELECT * FROM agent_chat_jobs ORDER BY updated_at DESC LIMIT $1`, [safeLimit]);
  return result.rows.map(decode);
}

export async function cleanupChatJobs(ttlMs = 30 * 60 * 1000): Promise<void> {
  if (!databaseAvailable()) {
    const cutoff = Date.now() - ttlMs;
    for (const [id, job] of memoryJobs) {
      if (job.updatedAt < cutoff && ["completed", "failed", "cancelled"].includes(job.status)) {
        memoryJobs.delete(id);
        for (const [actionId, action] of memoryToolActions) {
          if (action.jobId === id) memoryToolActions.delete(actionId);
        }
      }
    }
    return;
  }
  await ensureTable();
  await query(
    `DELETE FROM agent_chat_jobs WHERE updated_at < $1 AND status IN ('completed','failed','cancelled')`,
    [Date.now() - ttlMs],
  );
}


export async function startChatJobToolAction(
  jobId: string,
  userId: string,
  tool: string,
  input: string,
): Promise<string> {
  const policy = getToolSecurityPolicy(tool);
  const actionId = randomUUID();
  const startedAt = Date.now();
  const inputSha256 = createHash("sha256").update(input).digest("hex");
  const action: ChatJobToolAction = {
    actionId, jobId, userId, tool, risk: policy.risk, inputSha256,
    status: "started", startedAt,
  };
  if (!databaseAvailable()) {
    const job = memoryJobs.get(jobId);
    if (!job || job.userId !== userId || job.status !== "running") {
      throw new Error("Cannot journal a tool action for a non-running or inaccessible Agent Run.");
    }
    memoryToolActions.set(actionId, action);
    return actionId;
  }
  await ensureTable();
  const inserted = await query(
    `INSERT INTO agent_chat_job_tool_actions
      (action_id,job_id,user_id,tool_name,risk,input_sha256,status,started_at)
     SELECT $1,$2,$3,$4,$5,$6,'started',$7
      WHERE EXISTS (SELECT 1 FROM agent_chat_jobs WHERE id=$2 AND user_id=$3 AND status='running')
     RETURNING action_id`,
    [actionId, jobId, userId, tool, policy.risk, inputSha256, startedAt],
  );
  if (!inserted.rows.length) {
    throw new Error("Cannot journal a tool action for a non-running or inaccessible Agent Run.");
  }
  return actionId;
}

export async function finishChatJobToolAction(
  jobId: string,
  userId: string,
  actionId: string,
  result: { success: boolean; output: string },
): Promise<void> {
  const completedAt = Date.now();
  const resultSha256 = createHash("sha256").update(result.output).digest("hex");
  if (!databaseAvailable()) {
    const action = memoryToolActions.get(actionId);
    if (!action || action.jobId !== jobId || action.userId !== userId || action.status !== "started") {
      throw new Error("Tool action journal entry is missing, foreign, or already finalized.");
    }
    memoryToolActions.set(actionId, {
      ...action,
      status: result.success ? "succeeded" : "failed",
      completedAt,
      resultSuccess: result.success,
      resultSha256,
    });
    return;
  }
  await ensureTable();
  const updated = await query(
    `UPDATE agent_chat_job_tool_actions
        SET status=$4,completed_at=$5,result_success=$6,result_sha256=$7
      WHERE action_id=$1 AND job_id=$2 AND user_id=$3 AND status='started'
      RETURNING action_id`,
    [actionId, jobId, userId, result.success ? "succeeded" : "failed", completedAt, result.success, resultSha256],
  );
  if (!updated.rows.length) {
    throw new Error("Tool action journal entry is missing, foreign, or already finalized.");
  }
}

export async function listChatJobToolActions(jobId: string, userId: string): Promise<ChatJobToolAction[]> {
  if (!databaseAvailable()) {
    return [...memoryToolActions.values()]
      .filter((action) => action.jobId === jobId && action.userId === userId)
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((action) => ({ ...action }));
  }
  await ensureTable();
  const result = await query(
    `SELECT action_id,job_id,user_id,tool_name,risk,input_sha256,status,started_at,
            completed_at,result_success,result_sha256
       FROM agent_chat_job_tool_actions
      WHERE job_id=$1 AND user_id=$2
      ORDER BY started_at ASC`,
    [jobId, userId],
  );
  return result.rows.map((row) => ({
    actionId: row.action_id,
    jobId: row.job_id,
    userId: row.user_id,
    tool: row.tool_name,
    risk: row.risk,
    inputSha256: row.input_sha256,
    status: row.status,
    startedAt: Number(row.started_at),
    ...(row.completed_at === null ? {} : { completedAt: Number(row.completed_at) }),
    ...(row.result_success === null ? {} : { resultSuccess: row.result_success }),
    ...(row.result_sha256 ? { resultSha256: row.result_sha256 } : {}),
  }));
}

export async function recoverStaleChatJobs(maxRunningMs = 10 * 60 * 1000): Promise<number> {
  const cutoff = Date.now() - maxRunningMs;
  const recoveryError = "API process restarted before this Agent Run finished.";
  if (!databaseAvailable()) {
    let recovered = 0;
    for (const [id, job] of memoryJobs) {
      if ((job.status === "queued" || job.status === "running") && job.updatedAt < cutoff) {
        const updatedAt = Date.now();
        const toolActions = await listChatJobToolActions(id, job.userId);
        memoryJobs.set(id, cloneJob({
          ...job,
          status: "failed",
          stage: "error",
          error: recoveryError,
          recoveryAssessment: assessChatJobRecovery({ ...job, toolActions }, updatedAt),
          updatedAt,
        }));
        if (job.projectId) {
          const lock = memoryLocks.get(job.projectId);
          if (lock?.jobId === id) memoryLocks.delete(job.projectId);
        }
        recovered += 1;
      }
    }
    return recovered;
  }
  await ensureTable();
  const staleJobs = await query(
    `SELECT * FROM agent_chat_jobs
      WHERE status IN ('queued','running') AND updated_at < $1
      ORDER BY updated_at ASC`,
    [cutoff],
  );
  let recoveredCount = 0;
  for (const row of staleJobs.rows) {
    const job = decode(row);
    const updatedAt = Date.now();
    const toolActions = await listChatJobToolActions(job.id, job.userId);
    const assessment = assessChatJobRecovery({ ...job, toolActions }, updatedAt);
    const updated = await query(
      `UPDATE agent_chat_jobs
          SET status='failed',
              updated_at=$3,
              payload=jsonb_set(
                jsonb_set(
                  jsonb_set(payload, '{stage}', '"error"'::jsonb, true),
                  '{error}', to_jsonb($4::text), true
                ),
                '{recoveryAssessment}', $5::jsonb, true
              )
        WHERE id=$1 AND status=$2 AND updated_at=$6
        RETURNING id`,
      [row.id, job.status, updatedAt, recoveryError, JSON.stringify(assessment), job.updatedAt],
    );
    if (!updated.rows.length) continue;
    await query(`DELETE FROM agent_project_locks WHERE job_id=$1`, [row.id]);
    recoveredCount += 1;
  }
  return recoveredCount;
}
