import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "../db.js";

const here = dirname(fileURLToPath(import.meta.url));
const migration = await readFile(resolve(here, "migrations/001_auth.sql"), "utf8");
await query(migration);
console.log("[Nexum] Auth database migration applied.");
