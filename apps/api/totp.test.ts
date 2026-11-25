import test from "node:test";
import assert from "node:assert/strict";
import { decodeBase32, encodeBase32, generateRecoveryCodes, generateTotpCode, generateTotpSecret, hashRecoveryCode, matchTotpCounter, verifyRecoveryCode, verifyTotpCode } from "./totp.js";

test("Base32 encoding and decoding round-trip", () => {
  const input = Buffer.from("hello world");
  assert.deepEqual(decodeBase32(encodeBase32(input)), input);
  assert.throws(() => decodeBase32("not valid!"));
});

test("TOTP follows RFC 6238 test vector at 59 seconds (8 digits)", () => {
  const secret = encodeBase32(Buffer.from("12345678901234567890"));
  assert.equal(generateTotpCode(secret, 59_000, 8), "94287082");
});

test("TOTP 6-digit verification accepts current and adjacent step, rejects malformed codes", () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;
  const current = generateTotpCode(secret, now);
  assert.equal(verifyTotpCode(secret, current, now), true);
  assert.equal(verifyTotpCode(secret, generateTotpCode(secret, now + 30_000), now), true);
  assert.equal(verifyTotpCode(secret, "abc123", now), false);
  assert.equal(verifyTotpCode(secret, "12345", now), false);
  assert.equal(verifyTotpCode(secret, "000000", now, 0), false);
});


test("TOTP exposes the matched time counter so callers can reject replay", () => {
  const secret = encodeBase32(Buffer.from("12345678901234567890"));
  const now = 1_700_000_000_000;
  const currentCounter = Math.floor(now / 30_000);
  const currentCode = generateTotpCode(secret, now);
  const previousCode = generateTotpCode(secret, now - 30_000);
  assert.equal(matchTotpCounter(secret, currentCode, now), currentCounter);
  assert.equal(matchTotpCounter(secret, previousCode, now), currentCounter - 1);
  assert.equal(matchTotpCounter(secret, "abc123", now), null);
  assert.equal(matchTotpCounter(secret, currentCode, now, 0), currentCounter);
});

test("recovery codes are random, one-time-ready, hashed, and verified", () => {
  const generated = generateRecoveryCodes(5);
  assert.equal(generated.codes.length, 5);
  assert.equal(generated.hashes.length, 5);
  assert.equal(new Set(generated.codes).size, 5);
  generated.codes.forEach((code, index) => {
    assert.equal(verifyRecoveryCode(code, generated.hashes[index]!), true);
    assert.equal(verifyRecoveryCode(code.toLowerCase(), generated.hashes[index]!), true);
    assert.equal(verifyRecoveryCode("AAAAAAAAAAAAAAAAAAAA", generated.hashes[index]!), false);
  });
  assert.throws(() => hashRecoveryCode("bad"));
  assert.throws(() => generateRecoveryCodes(0));
});
