import { Pool, type QueryResultRow } from "pg";

let pool: Pool | null = null;

function getDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.NEXUM_DATABASE_URL?.trim() || "";
}

export function assertPersistentDatabaseConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (env.VERCEL === "1" && !getDatabaseUrl(env)) {
    throw new Error("NEXUM_DATABASE_URL is required on Vercel. Configure PostgreSQL before starting the API.");
  }
}

export function getDatabasePoolMax(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.NEXUM_DB_POOL_MAX);
  if (Number.isInteger(configured) && configured >= 1 && configured <= 20) return configured;
  return env.VERCEL === "1" ? 2 : 10;
}

function getPool(): Pool {
  assertPersistentDatabaseConfigured();
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("NEXUM_DATABASE_URL is not configured. Connect Nexum API to Yandex Managed PostgreSQL first.");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: getDatabasePoolMax(),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: process.env.NEXUM_DB_SSL === "false" ? false : {
        rejectUnauthorized: true,
        ...(process.env.NEXUM_DB_CA ? { ca: process.env.NEXUM_DB_CA } : {}),
      },
    });
    pool.on("error", (error: unknown) => console.error("[Nexum] PostgreSQL pool error", error));
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []): Promise<{ rows: T[] }> {
  const result = await getPool().query<T>(text, values);
  return { rows: result.rows };
}

export async function pingDatabase(): Promise<{ ok: boolean; error?: string }> {
  try {
    await query("SELECT 1 AS ok");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "PostgreSQL connection failed" };
  }
}

export async function closeDatabase(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}
