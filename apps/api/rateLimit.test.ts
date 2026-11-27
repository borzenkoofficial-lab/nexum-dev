import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRateLimit } from "./rateLimit.js";

test("in-memory rate limit enforces bounded windows without a database", async () => {
  const key = "test-regression-" + Math.random().toString(36).slice(2);
  const first = await checkRateLimit(key, 2, 1000);
  const second = await checkRateLimit(key, 2, 1000);
  const third = await checkRateLimit(key, 2, 1000);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);
  assert.ok((third.retryAfterSeconds ?? 0) >= 1);
});

test("reads and writes are limited by separate budgets", async () => {
  const { rateLimitByMethod } = await import("./rateLimit.js");
  const calls: string[] = [];
  const limiter = rateLimitByMethod(
    (req: { method: string }) => { calls.push(`read:${req.method}`); },
    (req: { method: string }) => { calls.push(`write:${req.method}`); },
  );
  for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH"]) limiter({ method }, undefined, undefined);
  assert.deepEqual(calls, ["read:GET", "read:HEAD", "write:POST", "write:PUT", "write:DELETE", "write:PATCH"]);
});
