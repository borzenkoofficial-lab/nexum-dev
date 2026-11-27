import { query } from "../db.js";

export interface SandboxRecord {
  remoteId: string;
  provider: string;
  taskId: string | null;
  projectId: string | null;
  createdAt: number;
}

export type ReleaseReason = "disposed" | "orphan-deleted" | "orphan-missing";

/**
 * Durable registry of remote sandboxes. A sandbox is an orphan when it is not
 * released and its runtime task belongs to no queued/running ChatJob (so a
 * session owned by another live API instance is never touched), or, for a
 * one-shot session without a task, when it is older than the one-shot limit.
 */
export interface SandboxRegistry {
  record(entry: Omit<SandboxRecord, "createdAt">): Promise<void>;
  release(remoteId: string, reason: ReleaseReason): Promise<void>;
  listOrphans(now?: number): Promise<SandboxRecord[]>;
}

/** Grace period so a session created a moment ago is never judged before its job is visible. */
export const ORPHAN_GRACE_MS = 2 * 60 * 1000;
/** One-shot sessions (no task) are bounded by command timeouts; older ones are orphans. */
export const ONE_SHOT_ORPHAN_MS = 30 * 60 * 1000;

export class MemorySandboxRegistry implements SandboxRegistry {
  private readonly items = new Map<string, SandboxRecord & { releasedAt: number | null; reason: ReleaseReason | null }>();
  constructor(private readonly isTaskActive: (taskId: string) => boolean = () => false) {}
  async record(entry: Omit<SandboxRecord, "createdAt">): Promise<void> {
    this.items.set(entry.remoteId, { ...entry, createdAt: Date.now(), releasedAt: null, reason: null });
  }
  async release(remoteId: string, reason: ReleaseReason): Promise<void> {
    const item = this.items.get(remoteId);
    if (item && item.releasedAt === null) Object.assign(item, { releasedAt: Date.now(), reason });
  }
  async listOrphans(now = Date.now()): Promise<SandboxRecord[]> {
    return [...this.items.values()]
      .filter((item) => item.releasedAt === null && now - item.createdAt >= ORPHAN_GRACE_MS)
      .filter((item) => item.taskId ? !this.isTaskActive(item.taskId) : now - item.createdAt >= ONE_SHOT_ORPHAN_MS)
      .map(({ remoteId, provider, taskId, projectId, createdAt }) => ({ remoteId, provider, taskId, projectId, createdAt }));
  }
  releaseReason(remoteId: string): ReleaseReason | null {
    return this.items.get(remoteId)?.reason ?? null;
  }
}

export class PostgresSandboxRegistry implements SandboxRegistry {
  async record(entry: Omit<SandboxRecord, "createdAt">): Promise<void> {
    await query(
      "INSERT INTO sandbox_sessions (remote_id, provider, task_id, project_id) VALUES ($1, $2, $3, $4) ON CONFLICT (remote_id) DO NOTHING",
      [entry.remoteId, entry.provider, entry.taskId, entry.projectId],
    );
  }
  async release(remoteId: string, reason: ReleaseReason): Promise<void> {
    await query("UPDATE sandbox_sessions SET released_at = NOW(), release_reason = $2 WHERE remote_id = $1 AND released_at IS NULL", [remoteId, reason]);
  }
  async listOrphans(): Promise<SandboxRecord[]> {
    const result = await query<{ remote_id: string; provider: string; task_id: string | null; project_id: string | null; created_at: Date }>(
      `SELECT s.remote_id, s.provider, s.task_id, s.project_id, s.created_at FROM sandbox_sessions s
        WHERE s.released_at IS NULL
          AND s.created_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')
          AND (
            (s.task_id IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM agent_chat_jobs j
               WHERE j.status IN ('queued','running') AND j.payload->>'runtimeTaskId' = s.task_id))
            OR (s.task_id IS NULL AND s.created_at < NOW() - ($2::bigint * INTERVAL '1 millisecond'))
          )
        ORDER BY s.created_at ASC LIMIT 100`,
      [ORPHAN_GRACE_MS, ONE_SHOT_ORPHAN_MS],
    );
    return result.rows.map((row) => ({ remoteId: row.remote_id, provider: row.provider, taskId: row.task_id, projectId: row.project_id, createdAt: new Date(row.created_at).getTime() }));
  }
}
