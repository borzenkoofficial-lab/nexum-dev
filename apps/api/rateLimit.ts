import { query } from "./db.js";

let initialized: Promise<void> | null = null;
let callsSinceCleanup = 0;
const memoryWindows = new Map<string, { startedAt: number; hits: number }>();

async function ensureTable(): Promise<void> {
  if (!initialized) {
    initialized = query(`
      CREATE TABLE IF NOT EXISTS api_rate_limits (
        key TEXT PRIMARY KEY,
        window_started_at TIMESTAMPTZ NOT NULL,
        hits INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS api_rate_limits_window_idx
        ON api_rate_limits(window_started_at);
    `).then(() => undefined).catch((error) => {
      initialized = null;
      throw error;
    });
  }
  await initialized;
}

function checkMemoryRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; remaining: number; retryAfterSeconds?: number } {
  const now = Date.now();
  const existing = memoryWindows.get(key);
  const window = existing && now - existing.startedAt < windowMs
    ? existing
    : { startedAt: now, hits: 0 };

  window.hits += 1;
  memoryWindows.set(key, window);

  if (window.hits <= limit) {
    return { allowed: true, remaining: Math.max(0, limit - window.hits) };
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - window.startedAt)) / 1000));
  return { allowed: false, remaining: 0, retryAfterSeconds };
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds?: number }> {
  // Project files and local development can operate without PostgreSQL.
  // Keep the persistent database-backed limiter when DB is configured, but do
  // not turn an optional local database absence into an HTTP 503 for the whole API.
  if (!process.env.NEXUM_DATABASE_URL?.trim()) {
    return checkMemoryRateLimit(key, limit, windowMs);
  }

  try {
    await ensureTable();
  } catch (error) {
    console.warn("[Nexum] PostgreSQL rate-limit unavailable; using in-memory limiter.", error);
    return checkMemoryRateLimit(key, limit, windowMs);
  }

  const windowStart = new Date(Date.now() - windowMs);
  const result = await query<{ hits: number; started_at: string; elapsed_seconds: number }>(
    `
      INSERT INTO api_rate_limits (key, window_started_at, hits)
      VALUES ($1, NOW(), 1)
      ON CONFLICT (key) DO UPDATE
      SET
        window_started_at = CASE
          WHEN api_rate_limits.window_started_at <= $2::timestamptz THEN NOW()
          ELSE api_rate_limits.window_started_at
        END,
        hits = CASE
          WHEN api_rate_limits.window_started_at <= $2::timestamptz THEN 1
          ELSE api_rate_limits.hits + 1
        END
      RETURNING
        hits,
        window_started_at AS started_at,
        EXTRACT(EPOCH FROM (NOW() - window_started_at))::float8 AS elapsed_seconds
    `,
    [key, windowStart.toISOString()],
  );

  callsSinceCleanup += 1;
  if (callsSinceCleanup >= 100) {
    callsSinceCleanup = 0;
    void query(
      "DELETE FROM api_rate_limits WHERE window_started_at < $1::timestamptz",
      [new Date(Date.now() - Math.max(windowMs, 3_600_000) * 2).toISOString()],
    ).catch(() => undefined);
  }

  const row = result.rows[0];
  if (!row) return { allowed: true, remaining: limit - 1 };
  const hits = Number(row.hits);
  if (hits <= limit) return { allowed: true, remaining: Math.max(0, limit - hits) };

  const elapsedMs = Math.max(0, Number(row.elapsed_seconds) * 1000);
  const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - elapsedMs) / 1000));
  return { allowed: false, remaining: 0, retryAfterSeconds };
}

export function getRateLimitKey(prefix: string, identity: string): string {
  return prefix + ":" + identity.trim().slice(0, 240);
}