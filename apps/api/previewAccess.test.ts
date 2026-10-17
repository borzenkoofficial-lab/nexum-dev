import assert from "node:assert/strict";
import test from "node:test";
import { createPreviewAccessToken, verifyPreviewAccessToken } from "./previewAccess.js";

test("preview access token preserves project-scoped claims", () => {
  const expiresAt = Date.now() + 60_000;
  const token = createPreviewAccessToken("user-123", "project-456", expiresAt);
  assert.deepEqual(verifyPreviewAccessToken(token), {
    userId: "user-123",
    projectId: "project-456",
    expiresAt,
  });
});

test("preview access token rejects tampered payloads and signatures", () => {
  const token = createPreviewAccessToken("user-123", "project-456");
  const [payload, signature] = token.split(".");
  const changedPayload = (payload.startsWith("A") ? "B" : "A") + payload.slice(1);
  const changedSignature = (signature.startsWith("A") ? "B" : "A") + signature.slice(1);
  assert.equal(verifyPreviewAccessToken(changedPayload + "." + signature), null);
  assert.equal(verifyPreviewAccessToken(payload + "." + changedSignature), null);
});

test("preview access token rejects expired grants and malformed tokens", () => {
  const expired = createPreviewAccessToken("user-123", "project-456", Date.now() - 1);
  assert.equal(verifyPreviewAccessToken(expired), null);
  assert.equal(verifyPreviewAccessToken("not-a-token"), null);
});
