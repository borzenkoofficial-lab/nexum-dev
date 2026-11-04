import assert from "node:assert/strict";
import { test } from "node:test";
import * as database from "./db.js";

const config = database as typeof database & {
  assertPersistentDatabaseConfigured?: (env?: NodeJS.ProcessEnv) => void;
  getDatabasePoolMax?: (env?: NodeJS.ProcessEnv) => number;
};

test("Vercel runtime fails closed when persistent PostgreSQL is not configured", () => {
  assert.equal(typeof config.assertPersistentDatabaseConfigured, "function");
  if (typeof config.assertPersistentDatabaseConfigured !== "function") return;

  assert.throws(
    () => config.assertPersistentDatabaseConfigured({ VERCEL: "1" }),
    /NEXUM_DATABASE_URL.*required.*Vercel/i,
  );
  assert.doesNotThrow(() => config.assertPersistentDatabaseConfigured({
    VERCEL: "1",
    NEXUM_DATABASE_URL: "postgres://configured",
  }));
  assert.doesNotThrow(() => config.assertPersistentDatabaseConfigured({}));
});

test("serverless PostgreSQL pool defaults to two connections while local defaults remain unchanged", () => {
  assert.equal(typeof config.getDatabasePoolMax, "function");
  if (typeof config.getDatabasePoolMax !== "function") return;

  assert.equal(config.getDatabasePoolMax({ VERCEL: "1" }), 2);
  assert.equal(config.getDatabasePoolMax({}), 10);
  assert.equal(config.getDatabasePoolMax({ VERCEL: "1", NEXUM_DB_POOL_MAX: "4" }), 4);
  assert.equal(config.getDatabasePoolMax({ VERCEL: "1", NEXUM_DB_POOL_MAX: "0" }), 2);
});
