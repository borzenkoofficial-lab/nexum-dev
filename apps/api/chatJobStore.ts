import { query } from "./db.js";

export type ChatJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type ChatJobStage = "queued" | "analyzing" | "planning" | "reading" | "editing" | "building" | "testing" | "completed" | "error";

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
}

let initialized: Promise<void> | null = null;

async function ensureTable(): Promise<void> {
  if (!initialized) {
    initialized = query(`
      CREATE TABLE IF NOT EXISTS agent_chat_jobs (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id UUID NULL,
        status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb
      );
      ALTER TABLE agent_chat_jobs DROP CONSTRAINT IF EXISTS agent_chat_jobs_status_check;
      ALTER TABLE agent_chat_jobs ADD CONSTRAINT agent_chat_jobs_status_check CHECK (status IN ('queued','running','completed','failed','cancelled'));
      CREATE INDEX IF NOT EXISTS agent_chat_jobs_user_updated_idx
        ON agent_chat_jobs(user_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS agent_project_locks (
        project_id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_id UUID NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      );
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
  await ensureTable();
  const result = await query(
    `UPDATE agent_project_locks SET expires_at=$3
      WHERE project_id=$1 AND job_id=$2 RETURNING project_id`,
    [projectId, jobId, new Date(Date.now() + ttlMs).toISOString()],
  );
  return result.rows.length > 0;
}

export async function releaseProjectLock(projectId: string, jobId: string): Promise<void> {
  await ensureTable();
  await query(`DELETE FROM agent_project_locks WHERE project_id=$1 AND job_id=$2`, [projectId, jobId]);
}

export async function createChatJob(job: ChatJob): Promise<void> {
  await ensureTable();
  const data = encode(job);
  await query(
    `INSERT INTO agent_chat_jobs (id,user_id,project_id,status,created_at,updated_at,payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [data.id, data.userId, data.projectId, data.status, data.createdAt, data.updatedAt, JSON.stringify(data.payload)],
  );
}

export async function getChatJob(id: string, userId: string): Promise<ChatJob | null> {
  await ensureTable();
  const result = await query(`SELECT * FROM agent_chat_jobs WHERE id=$1 AND user_id=$2 LIMIT 1`, [id, userId]);
  return result.rows[0] ? decode(result.rows[0]) : null;
}

export async function updateChatJob(id: string, userId: string, patch: Partial<ChatJob>): Promise<ChatJob | null> {
  await ensureTable();
  const current = await getChatJob(id, userId);
  if (!current) return null;
  const next: ChatJob = { ...current, ...patch, id: current.id, userId: current.userId, updatedAt: patch.updatedAt ?? Date.now() };
  const data = encode(next);
  const result = await query(
    `UPDATE agent_chat_jobs
        SET project_id=$3,status=$4,updated_at=$5,payload=$6::jsonb
      WHERE id=$1 AND user_id=$2
      RETURNING *`,
    [id, userId, data.projectId, data.status, data.updatedAt, JSON.stringify(data.payload)],
  );
  return result.rows[0] ? decode(result.rows[0]) : null;
}

export async function completeChatJob(id: string, userId: string, patch: Partial<ChatJob>): Promise<ChatJob | null> {
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
  await ensureTable();
  const result = await query(
    `UPDATE agent_chat_jobs
        SET status='cancelled',
            updated_at=$3,
            payload=jsonb_set(
              jsonb_set(payload, '{stage}', '"error"'::jsonb, true),
              '{error}', to_jsonb($4::text), true
            )
      WHERE id=$1 AND user_id=$2 AND status IN ('queued','running')
      RETURNING *`,
    [id, userId, Date.now(), message],
  );
  return result.rows[0] ? decode(result.rows[0]) : null;
}

export async function listChatJobs(userId?: string, limit = 20): Promise<ChatJob[]> {
  await ensureTable();
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const result = userId
    ? await query(`SELECT * FROM agent_chat_jobs WHERE user_id=$1 ORDER BY updated_at DESC LIMIT $2`, [userId, safeLimit])
    : await query(`SELECT * FROM agent_chat_jobs ORDER BY updated_at DESC LIMIT $1`, [safeLimit]);
  return result.rows.map(decode);
}

export async function cleanupChatJobs(ttlMs = 30 * 60 * 1000): Promise<void> {
  await ensureTable();
  await query(
    `DELETE FROM agent_chat_jobs WHERE updated_at < $1 AND status IN ('completed','failed','cancelled')`,
    [Date.now() - ttlMs],
  );
}


export async function recoverStaleChatJobs(maxRunningMs = 10 * 60 * 1000): Promise<number> {
  await ensureTable();
  const result = await query(
    `UPDATE agent_chat_jobs
        SET status='failed',
            updated_at=$1,
            payload=jsonb_set(
              jsonb_set(payload, '{stage}', '"error"'::jsonb, true),
              '{error}', '"API process restarted while this Agent Run was active."'::jsonb, true
            )
      WHERE status='running' AND updated_at < $2
      RETURNING id`,
    [Date.now(), Date.now() - maxRunningMs],
  );
  return result.rows.length;
}
