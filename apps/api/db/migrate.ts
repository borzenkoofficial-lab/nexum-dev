import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { query, withDatabaseTransaction } from "../db.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = resolve(here, "migrations");
const migrationPattern = /^(\\d{3,})_[a-z0-9_]+\\.sql$/i;

interface MigrationFile {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

async function loadMigrations(): Promise<MigrationFile[]> {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const names = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  const migrations: MigrationFile[] = [];
  const seenVersions = new Set<number>();

  for (const name of names) {
    const match = migrationPattern.exec(name);
    if (!match) continue;
    const version = Number(match[1]);
    if (seenVersions.has(version)) throw new Error(`Duplicate migration version: ${version}`);
    seenVersions.add(version);
    const sql = await readFile(resolve(migrationsDirectory, name), "utf8");
    migrations.push({ version, name, sql, checksum: createHash("sha256").update(sql).digest("hex") });
  }
  return migrations.sort((a, b) => a.version - b.version);
}

await query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version BIGINT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

const migrations = await loadMigrations();
for (const migration of migrations) {
  const applied = await query<{ checksum: string; name: string }>(
    "SELECT checksum, name FROM schema_migrations WHERE version = $1",
    [migration.version],
  );
  const previous = applied.rows[0];
  if (previous) {
    if (previous.name !== migration.name || previous.checksum !== migration.checksum) {
      throw new Error(`Applied migration ${migration.version} (${previous.name}) was modified. Add a new migration instead.`);
    }
    console.log(`[КВАРД] Migration ${migration.name} already applied.`);
    continue;
  }

  await withDatabaseTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('nexum_schema_migrations'))");
    const concurrent = await client.query<{ checksum: string; name: string }>(
      "SELECT checksum, name FROM schema_migrations WHERE version = $1",
      [migration.version],
    );
    const existing = concurrent.rows[0];
    if (existing) {
      if (existing.name !== migration.name || existing.checksum !== migration.checksum) {
        throw new Error(`Migration ${migration.version} changed while applying.`);
      }
      return;
    }
    await client.query(migration.sql);
    await client.query(
      "INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
      [migration.version, migration.name, migration.checksum],
    );
  });
  console.log(`[КВАРД] Applied migration ${migration.name}.`);
}

console.log(`[КВАРД] Database migrations complete (${migrations.length} files discovered).`);
