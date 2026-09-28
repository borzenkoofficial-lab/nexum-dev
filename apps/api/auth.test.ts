import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, validateEmail, validateName, verifyPassword } from "./auth.js";

test("validateEmail accepts normal addresses and rejects whitespace", () => {
  assert.equal(validateEmail(" User@example.com "), "user@example.com");
  assert.throws(() => validateEmail("user @example.com"));
  assert.throws(() => validateEmail("user@example"));
});

test("validateName collapses repeated whitespace", () => {
  assert.equal(validateName("  Semen   Borzenko  "), "Semen Borzenko");
  assert.throws(() => validateName("   "));
});

test("password hash round-trip works", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPassword("wrong password", hash), false);
});
