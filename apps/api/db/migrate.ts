import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "../db.js";

const here = dirname(fileURLToPath(import.meta.url));
for (const file of ["001_auth.sql", "002_agent_profiles.sql", "003_agent_definitions.sql", "004_project_storage.sql"]) {
  const migration = await readFile(resolve(here, "migrations", file), "utf8");
  await query(migration);
  console.log(`[КВАРД] Database migration applied: ${file}`);
}
