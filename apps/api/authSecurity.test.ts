import assert from "node:assert/strict";
import { test } from "node:test";
import { emailFingerprint, logSecurityEvent, resolveTrustProxy } from "./authSecurity.js";

test("trust proxy defaults to private hops and never trusts every client", () => {
  assert.deepEqual(resolveTrustProxy(undefined), ["loopback", "linklocal", "uniquelocal"]);
  assert.equal(resolveTrustProxy("false"), false);
  assert.equal(resolveTrustProxy("1"), 1);
  assert.deepEqual(resolveTrustProxy("10.0.0.1, loopback"), ["10.0.0.1", "loopback"]);
  assert.throws(() => resolveTrustProxy("true"), /X-Forwarded-For/);
});

test("email fingerprints are stable, case-insensitive and do not contain the email", () => {
  assert.equal(emailFingerprint(" User@Example.com "), emailFingerprint("user@example.com"));
  assert.notEqual(emailFingerprint("a@example.com"), emailFingerprint("b@example.com"));
  assert.equal(emailFingerprint("user@example.com").includes("example"), false);
});

test("security events are single-line JSON without secrets", () => {
  const lines: string[] = [];
  const original = console.info;
  console.info = (line: string) => { lines.push(line); };
  try {
    logSecurityEvent("auth.login.failed", { ip: "203.0.113.5", emailFingerprint: emailFingerprint("user@example.com"), reason: "invalid_credentials" });
  } finally {
    console.info = original;
  }
  const parsed = JSON.parse(lines[0]!);
  assert.equal(parsed.type, "security");
  assert.equal(parsed.event, "auth.login.failed");
  assert.equal(lines[0]!.includes("user@example.com"), false);
});
