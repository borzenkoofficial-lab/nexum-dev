import assert from "node:assert/strict";
import test from "node:test";
import { signSandboxWorkerRequest, verifySandboxWorkerRequest } from "./workerAuth.js";

const secret = "nexum-test-worker-secret-which-is-long-enough-0000000000";
const timestamp = String(Date.now());
const body = JSON.stringify({ projectPath: "users/test/projects/demo", command: "node --version" });

test("sandbox worker signature accepts an untampered recent request", () => {
  const signature = signSandboxWorkerRequest(secret, timestamp, body);
  assert.equal(verifySandboxWorkerRequest(secret, timestamp, body, signature), true);
});

test("sandbox worker signature rejects body or secret tampering", () => {
  const signature = signSandboxWorkerRequest(secret, timestamp, body);
  assert.equal(verifySandboxWorkerRequest(secret, timestamp, body + " ", signature), false);
  assert.equal(verifySandboxWorkerRequest(secret + "wrong", timestamp, body, signature), false);
});

test("sandbox worker signature rejects stale timestamps and malformed signatures", () => {
  const stale = String(Date.now() - 60_000);
  assert.equal(verifySandboxWorkerRequest(secret, stale, body, signSandboxWorkerRequest(secret, stale, body)), false);
  assert.equal(verifySandboxWorkerRequest(secret, timestamp, body, "not-a-signature"), false);
});
