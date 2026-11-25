import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function deriveKey(secret: string): Buffer {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("MFA encryption key must contain at least 32 characters.");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

/** Encrypt sensitive MFA data using AES-256-GCM. Format: v1.iv.tag.ciphertext (base64url). */
export function encryptMfaSecret(plaintext: string, keyMaterial: string): string {
  if (!plaintext) throw new Error("MFA plaintext must not be empty.");
  const key = deriveKey(keyMaterial);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptMfaSecret(envelope: string, keyMaterial: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("Invalid MFA ciphertext format.");
  const [, ivText, tagText, ciphertextText] = parts;
  const iv = Buffer.from(ivText!, "base64url");
  const tag = Buffer.from(tagText!, "base64url");
  const ciphertext = Buffer.from(ciphertextText!, "base64url");
  // Node base64url decoding accepts non-canonical trailing bits; reject alternate encodings.
  if (iv.toString("base64url") !== ivText || tag.toString("base64url") !== tagText || ciphertext.toString("base64url") !== ciphertextText) {
    throw new Error("Invalid MFA ciphertext encoding.");
  }
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error("Invalid MFA ciphertext format.");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(keyMaterial), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
