import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const PREVIEW_TOKEN_TTL_MS = 10 * 60 * 1000;
const configuredSecret = process.env.NEXUM_AUTH_SECRET?.trim();
const previewTokenSecret = configuredSecret && configuredSecret.length >= 32
  ? configuredSecret
  : randomBytes(32).toString("hex");

export type PreviewGrant = { userId: string; projectId: string; expiresAt: number };

export function createPreviewAccessToken(userId: string, projectId: string, expiresAt = Date.now() + PREVIEW_TOKEN_TTL_MS): string {
  if (!userId || !projectId || !Number.isSafeInteger(expiresAt)) {
    throw new Error("Preview token claims are invalid");
  }
  const payload = Buffer.from(JSON.stringify({ userId, projectId, expiresAt })).toString("base64url");
  const signature = createHmac("sha256", previewTokenSecret).update(payload).digest("base64url");
  return payload + "." + signature;
}

export function verifyPreviewAccessToken(token: string, now = Date.now()): PreviewGrant | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = createHmac("sha256", previewTokenSecret).update(payload).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const grant = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<PreviewGrant>;
    if (typeof grant.userId !== "string" || !grant.userId || typeof grant.projectId !== "string" || !grant.projectId || typeof grant.expiresAt !== "number" || grant.expiresAt <= now) return null;
    return grant as PreviewGrant;
  } catch { return null; }
}
