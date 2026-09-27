import { Pool, type QueryResultRow } from "pg";

const databaseUrl = process.env.NEXUM_DATABASE_URL?.trim();

let pool: Pool | null = null;

function getPool(): Pool {
  if (!databaseUrl) {
    throw new Error("NEXUM_DATABASE_URL is not configured. Connect Nexum API to Yandex Managed PostgreSQL first.");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: Number(process.env.NEXUM_DB_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: process.env.NEXUM_DB_SSL === "false" ? false : {
        rejectUnauthorized: true,
        ...(process.env.NEXUM_DB_CA ? { ca: process.env.NEXUM_DB_CA } : {}),
      },
    });
    pool.on("error", (error) => console.error("[Nexum] PostgreSQL pool error", error));
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
