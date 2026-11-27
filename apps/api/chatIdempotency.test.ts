import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { IDEMPOTENCY_TTL_MS, InvalidIdempotencyKeyError, MemoryIdempotencyStore, PostgresIdempotencyStore, parseIdempotencyKey } from "./chatIdempotency.js";

test("idempotency keys are optional but must be well formed", () => {
  assert.equal(parseIdempotencyKey(undefined), undefined);
  assert.equal(parseIdempotencyKey(""), undefined);
  assert.equal(parseIdempotencyKey("3f2b9c1e-aaaa-4bbb-8ccc-123456789abc"), "3f2b9c1e-aaaa-4bbb-8ccc-123456789abc");
  assert.throws(() => parseIdempotencyKey("short"), InvalidIdempotencyKeyError);
  assert.throws(() => parseIdempotencyKey("bad key with spaces"), InvalidIdempotencyKeyError);
  assert.throws(() => parseIdempotencyKey(["array"]), InvalidIdempotencyKeyError);
});

test("a retried submission resolves to the original job; keys are per user and expire", async () => {
  const store = new MemoryIdempotencyStore();
  assert.equal(await store.claim("u1", "key-00000001", "job-a", 0), "job-a");
  assert.equal(await store.claim("u1", "key-00000001", "job-b", 1), "job-a");
  assert.equal(await store.claim("u2", "key-00000001", "job-c", 1), "job-c", "another user's key is independent");
  assert.equal(await store.claim("u1", "key-00000001", "job-d", IDEMPOTENCY_TTL_MS + 1), "job-d", "expired key is reusable");
});

test("forget only releases the claim of the job that was never created", async () => {
  const store = new MemoryIdempotencyStore();
  await store.claim("u1", "key-00000002", "job-a", 0);
  await store.forget("u1", "key-00000002", "job-other");
  assert.equal(await store.claim("u1", "key-00000002", "job-b", 1), "job-a");
  await store.forget("u1", "key-00000002", "job-a");
  assert.equal(await store.claim("u1", "key-00000002", "job-b", 2), "job-b");
});

const databaseUrl = process.env.KVARD_TEST_DATABASE_URL;
test("PostgreSQL: concurrent claims of one key bind every request to a single job", { skip: !databaseUrl && "set KVARD_TEST_DATABASE_URL to run against PostgreSQL" }, async () => {
  const previous = process.env.NEXUM_DATABASE_URL;
  const previousSsl = process.env.NEXUM_DB_SSL;
  process.env.NEXUM_DATABASE_URL = databaseUrl;
  process.env.NEXUM_DB_SSL = "false";
  const { closeDatabase } = await import("./db.js");
  try {
    const store = new PostgresIdempotencyStore();
    const userId = `idem-${randomUUID()}`;
    const winners = await Promise.all(Array.from({ length: 6 }, () => store.claim(userId, "key-concurrent", randomUUID())));
    assert.equal(new Set(winners).size, 1);
    await store.forget(userId, "key-concurrent", winners[0]!);
    const fresh = randomUUID();
    assert.equal(await store.claim(userId, "key-concurrent", fresh), fresh);
  } finally {
    await closeDatabase();
    if (previous === undefined) delete process.env.NEXUM_DATABASE_URL; else process.env.NEXUM_DATABASE_URL = previous;
    if (previousSsl === undefined) delete process.env.NEXUM_DB_SSL; else process.env.NEXUM_DB_SSL = previousSsl;
  }
});
