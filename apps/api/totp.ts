import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/[=\s-]/g, "");
  if (!normalized || /[^A-Z2-7]/.test(normalized)) throw new Error("Invalid Base32 secret");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of normalized) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function generateTotpCode(secret: string, timestampMs = Date.now(), digits = 6, periodSeconds = 30): string {
  if (![6, 8].includes(digits) || !Number.isInteger(periodSeconds) || periodSeconds < 1) throw new Error("Invalid TOTP parameters");
  const key = decodeBase32(secret);
  const counter = Math.floor(timestampMs / 1000 / periodSeconds);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24) | ((digest[offset + 1]! & 0xff) << 16) | ((digest[offset + 2]! & 0xff) << 8) | (digest[offset + 3]! & 0xff);
  return String(binary % (10 ** digits)).padStart(digits, "0");
}

export function verifyTotpCode(secret: string, code: string, timestampMs = Date.now(), windowSteps = 1): boolean {
  if (!/^\d{6}$/.test(code) || !Number.isInteger(windowSteps) || windowSteps < 0 || windowSteps > 2) return false;
  for (let step = -windowSteps; step <= windowSteps; step += 1) {
    const expected = generateTotpCode(secret, timestampMs + step * 30_000);
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(code);
    if (expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer)) return true;
  }
  return false;
}

export function generateRecoveryCodes(count = 10): { codes: string[]; hashes: string[] } {
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("Recovery code count must be between 1 and 20");
  const codes = Array.from({ length: count }, () => randomBytes(10).toString("hex").toUpperCase());
  return { codes, hashes: codes.map((code) => hashRecoveryCode(code)) };
}

export function hashRecoveryCode(code: string): string {
  const normalized = code.replace(/[-\s]/g, "").toUpperCase();
  if (!/^[0-9A-F]{20}$/.test(normalized)) throw new Error("Invalid recovery code");
  return createHmac("sha256", normalized).update("kvard-admin-recovery-code").digest("hex");
}

export function verifyRecoveryCode(code: string, storedHash: string): boolean {
  try {
    const expected = Buffer.from(storedHash, "hex");
    const actual = Buffer.from(hashRecoveryCode(code), "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
