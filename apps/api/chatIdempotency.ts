import { query } from "./db.js";

/** Keys are honoured for 24 hours; older keys may be reused. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export class InvalidIdempotencyKeyError extends Error {}

/** Returns the normalized key, undefined when absent, or throws for a malformed key. */
export function parseIdempotencyKey(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !KEY_PATTERN.test(value)) {
    throw new InvalidIdempotencyKeyError("Idempotency-Key must be 8-128 characters of [A-Za-z0-9._:-].");
  }
  return value;
}

export interface IdempotencyStore {
  /** Atomically binds key -> jobId. Returns the job id that owns the key (the new one if it won). */
  claim(userId: string, key: string, jobId: string, now?: number): Promise<string>;
  /** Frees a claim whose job was never created, so the client can retry. */
  forget(userId: string, key: string, jobId: string): Promise<void>;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly claims = new Map<string, { jobId: string; createdAt: number }>();
  async claim(userId: string, key: string, jobId: string, now = Date.now()): Promise<string> {
    const id = `${userId}\u0000${key}`;
    const existing = this.claims.get(id);
    if (existing && now - existing.createdAt < IDEMPOTENCY_TTL_MS) return existing.jobId;
    this.claims.set(id, { jobId, createdAt: now });
    return jobId;
  }
  async forget(userId: string, key: string, jobId: string): Promise<void> {
    const id = `${userId}\u0000${key}`;
    if (this.claims.get(id)?.jobId === jobId) this.claims.delete(id);
  }
}

export class PostgresIdempotencyStore implements IdempotencyStore {
  async claim(userId: string, key: string, jobId: string): Promise<string> {
    // Expired keys are replaced in the same statement; a live key keeps its job.
    const result = await query<{ job_id: string }>(
      `INSERT INTO chat_job_idempotency_keys (user_id, idempotency_key, job_id) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, idempotency_key) DO UPDATE
         SET job_id = EXCLUDED.job_id, created_at = NOW()
         WHERE chat_job_idempotency_keys.created_at < NOW() - ($4::bigint * INTERVAL '1 millisecond')
       RETURNING job_id`,
      [userId, key, jobId, IDEMPOTENCY_TTL_MS],
    );
    if (result.rows[0]) return result.rows[0].job_id;
    const existing = await query<{ job_id: string }>(
      "SELECT job_id FROM chat_job_idempotency_keys WHERE user_id = $1 AND idempotency_key = $2",
      [userId, key],
    );
    if (!existing.rows[0]) throw new Error("Idempotency key claim could not be resolved.");
    return existing.rows[0].job_id;
  }
  async forget(userId: string, key: string, jobId: string): Promise<void> {
    await query("DELETE FROM chat_job_idempotency_keys WHERE user_id = $1 AND idempotency_key = $2 AND job_id = $3", [userId, key, jobId]);
  }
}

let defaultStore: IdempotencyStore | null = null;
export function getIdempotencyStore(): IdempotencyStore {
  if (!defaultStore) defaultStore = process.env.NEXUM_DATABASE_URL?.trim() ? new PostgresIdempotencyStore() : new MemoryIdempotencyStore();
  return defaultStore;
}
