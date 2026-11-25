import test from "node:test";
import assert from "node:assert/strict";
import { createApprovalPreview, shouldRequireToolApproval } from "./approval.js";

test("always policy requires approval for every risk class", () => {
  for (const risk of ["READ", "WRITE", "EXECUTE", "DESTRUCTIVE"] as const) {
    assert.equal(shouldRequireToolApproval("always", risk), true);
  }
});

test("writes policy requires approval for every non-read action", () => {
  assert.equal(shouldRequireToolApproval("writes", "READ"), false);
  assert.equal(shouldRequireToolApproval("writes", "WRITE"), true);
  assert.equal(shouldRequireToolApproval("writes", "EXECUTE"), true);
  assert.equal(shouldRequireToolApproval("writes", "DESTRUCTIVE"), true);
});

test("autonomous policy never requests approval", () => {
  for (const risk of ["READ", "WRITE", "EXECUTE", "DESTRUCTIVE"] as const) {
    assert.equal(shouldRequireToolApproval("autonomous", risk), false);
  }
});

test("approval preview redacts credential fields and bearer tokens", () => {
  const preview = createApprovalPreview(JSON.stringify({
    path: "src/app.ts",
    apiKey: "sk-live-super-secret-value",
    nested: { password: "hunter2", access_token: "token-value" },
    authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.secret",
    content: "safe source code",
  }));
  assert.match(preview, /src\/app\.ts/);
  assert.match(preview, /REDACTED/i);
  assert.match(preview, /safe source code/);
  for (const secret of ["sk-live-super-secret-value", "hunter2", "token-value", "eyJhbGciOiJIUzI1NiJ9.secret"]) {
    assert.equal(preview.includes(secret), false);
  }
});

test("approval preview is bounded for large tool inputs", () => {
  const preview = createApprovalPreview("x".repeat(20_000));
  assert.ok(preview.length <= 8_000);
  assert.match(preview, /truncated/i);
});
