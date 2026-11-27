import { createHash } from "node:crypto";

/**
 * Express "trust proxy" value. Production runs behind Caddy, which replaces
 * X-Forwarded-For with the real client address; without trusting it every
 * client shares the proxy's IP and therefore one rate-limit bucket.
 * Default: trust only loopback and private-network hops (the reverse proxy).
 * NEXUM_TRUST_PROXY=false disables it; a number or a comma list is passed through.
 */
export function resolveTrustProxy(value: string | undefined): boolean | number | string[] {
  const raw = value?.trim();
  if (!raw) return ["loopback", "linklocal", "uniquelocal"];
  if (raw === "false") return false;
  if (raw === "true") throw new Error("NEXUM_TRUST_PROXY=true would trust client-supplied X-Forwarded-For; list the proxy hops instead.");
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

/** Stable, non-reversible identifier for an email in logs and rate-limit keys. */
export function emailFingerprint(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16);
}

export type SecurityEvent =
  | "auth.register.succeeded" | "auth.register.failed"
  | "auth.login.succeeded" | "auth.login.failed" | "auth.login.rate_limited" | "auth.login.mfa_required"
  | "auth.logout";

/**
 * Structured security event log line. Never pass passwords, tokens or raw
 * emails: identities are user ids or email fingerprints only.
 */
export function logSecurityEvent(event: SecurityEvent, details: { ip?: string; userId?: string; emailFingerprint?: string; requestId?: string; reason?: string }): void {
  console.info(JSON.stringify({ type: "security", event, at: new Date().toISOString(), ...details }));
}

/** Failed-login budget per account, independent of the client IP. */
export const LOGIN_ACCOUNT_LIMIT = 10;
export const LOGIN_ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
