import { query } from "./db.js";

export type ChatJobStatus = "queued" | "running" | "completed" | "failed";
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
  stage?: ChatJobStage;
  attachments?: string[];
  productPlan?: unknown;
  checkpointId?: string;
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
        status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed')),
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE INDEX IF NOT EXISTS agent_chat_jobs_user_updated_idx
        ON agent_chat_jobs(user_id, updated_at DESC);
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
    `DELETE FROM agent_chat_jobs WHERE updated_at < $1 AND status IN ('completed','failed')`,
    [Date.now() - ttlMs],
  );
}
