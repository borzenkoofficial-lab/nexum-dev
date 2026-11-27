import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createUserCredentialStore, MemoryUserCredentialStore, PostgresUserCredentialStore } from "./userCredentials.js";

const KEY = "k".repeat(40);

test("credentials are never persisted without a valid encryption key", () => {
  assert.equal(createUserCredentialStore({ NEXUM_DATABASE_URL: "postgres://x", AI_PROVIDER_ENCRYPTION_KEY: "short" }).durable, false);
  assert.equal(createUserCredentialStore({ AI_PROVIDER_ENCRYPTION_KEY: KEY }).durable, false);
  assert.equal(createUserCredentialStore({ NEXUM_DATABASE_URL: "postgres://x", AI_PROVIDER_ENCRYPTION_KEY: KEY }).durable, true);
  assert.throws(() => new PostgresUserCredentialStore("short"), /at least 32/);
});

test("memory store returns copies", async () => {
  const store = new MemoryUserCredentialStore();
  await store.save("u", { providerId: "openai", secret: "sk-1" });
  const loaded = await store.load("u");
  assert.deepEqual(loaded, { providerId: "openai", secret: "sk-1" });
  assert.equal(await store.load("other"), null);
});

const databaseUrl = process.env.KVARD_TEST_DATABASE_URL;
test("PostgreSQL: the secret is stored encrypted and survives a new store instance", { skip: !databaseUrl && "set KVARD_TEST_DATABASE_URL to run against PostgreSQL" }, async () => {
  const previous = process.env.NEXUM_DATABASE_URL;
  const previousSsl = process.env.NEXUM_DB_SSL;
  process.env.NEXUM_DATABASE_URL = databaseUrl;
  process.env.NEXUM_DB_SSL = "false";
  const { closeDatabase, query } = await import("../db.js");
  try {
    const userId = `cred-${randomUUID()}`;
    const secret = `sk-or-v1-${randomUUID()}`;
    await new PostgresUserCredentialStore(KEY).save(userId, { providerId: "openrouter", secret });
    const raw = await query<{ encrypted_secret: string }>("SELECT encrypted_secret FROM user_ai_credentials WHERE user_id = $1", [userId]);
    assert.ok(raw.rows[0]);
    assert.equal(raw.rows[0]!.encrypted_secret.includes(secret), false, "secret must not be stored in plaintext");
    assert.deepEqual(await new PostgresUserCredentialStore(KEY).load(userId), { providerId: "openrouter", secret });
    await new PostgresUserCredentialStore(KEY).save(userId, { providerId: "openai", secret: "sk-replaced" });
    assert.deepEqual(await new PostgresUserCredentialStore(KEY).load(userId), { providerId: "openai", secret: "sk-replaced" });
    await assert.rejects(new PostgresUserCredentialStore("x".repeat(40)).load(userId), "a different key must not decrypt");
  } finally {
    await closeDatabase();
    if (previous === undefined) delete process.env.NEXUM_DATABASE_URL; else process.env.NEXUM_DATABASE_URL = previous;
    if (previousSsl === undefined) delete process.env.NEXUM_DB_SSL; else process.env.NEXUM_DB_SSL = previousSsl;
  }
});
