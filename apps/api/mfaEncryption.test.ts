import test from "node:test";
import assert from "node:assert/strict";
import { decryptMfaSecret, encryptMfaSecret } from "./mfaEncryption.js";

const key = "test-key-material-at-least-32-characters-long";

test("MFA encrypted secret round-trips with AES-GCM", () => {
  const value = "JBSWY3DPEHPK3PXP";
  const encrypted = encryptMfaSecret(value, key);
  assert.notEqual(encrypted, value);
  assert.equal(decryptMfaSecret(encrypted, key), value);
});

test("MFA encryption uses randomized IVs", () => {
  const a = encryptMfaSecret("secret", key);
  const b = encryptMfaSecret("secret", key);
  assert.notEqual(a, b);
});

test("MFA ciphertext tampering is rejected", () => {
  const encrypted = encryptMfaSecret("secret", key);
  const parts = encrypted.split(".");
  parts[3] = (parts[3] ?? "") + "x";
  assert.throws(() => decryptMfaSecret(parts.join("."), key));
});

test("invalid ciphertext and weak key material are rejected", () => {
  assert.throws(() => decryptMfaSecret("invalid", key));
  assert.throws(() => encryptMfaSecret("secret", "short"));
  assert.throws(() => decryptMfaSecret(encryptMfaSecret("secret", key), "short"));
});
