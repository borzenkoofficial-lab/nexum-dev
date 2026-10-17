import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_CLOCK_SKEW_MS = 30_000;

export function signSandboxWorkerRequest(secret: string, timestamp: string, body: string): string {
  if (secret.length < 32) throw new Error("Sandbox worker secret must contain at least 32 characters");
  return createHmac("sha256", secret).update(timestamp + "." + body).digest("hex");
}

export function verifySandboxWorkerRequest(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
  now = Date.now(),
): boolean {
  if (secret.length < 32 || !/^\d{13}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const requestTime = Number(timestamp);
  if (!Number.isSafeInteger(requestTime) || Math.abs(now - requestTime) > MAX_CLOCK_SKEW_MS) return false;
  const expected = Buffer.from(signSandboxWorkerRequest(secret, timestamp, body), "hex");
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
