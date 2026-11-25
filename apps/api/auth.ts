import type { NextFunction, Request, Response } from "express";
import { createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { query } from "./db.js";

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = "nexum_session";
const MFA_CHALLENGE_COOKIE = "kvard_admin_mfa_challenge";
const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const JWT_SECRET = process.env.NEXUM_AUTH_SECRET?.trim();
const AUTH_ENABLED = process.env.NEXUM_AUTH_ENABLED === "true";

if (process.env.NODE_ENV === "production" && !AUTH_ENABLED) {
  throw new Error("NEXUM_AUTH_ENABLED must be true in production. Authentication cannot be disabled.");
}

if (process.env.NODE_ENV === "production" && AUTH_ENABLED && (!JWT_SECRET || JWT_SECRET.length < 32)) {
  throw new Error("NEXUM_AUTH_SECRET must be configured and contain at least 32 characters in production.");
}
const DEV_USER: AuthUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "dev@nexum.local",
  name: "Nexum Developer",
  createdAt: new Date(0).toISOString(),
};

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  mfaVerified?: boolean;
  sessionId?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function requireSecret(): string {
  if (!JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error("NEXUM_AUTH_SECRET must be configured and contain at least 32 characters.");
  }
  return JWT_SECRET;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function signToken(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const unsigned = header + "." + body;
  const signature = createHmac("sha256", requireSecret()).update(unsigned).digest("base64url");
  return unsigned + "." + signature;
}

function verifyToken(token: string): AuthUser | null {
  try {
    const [header, body, signature] = token.split(".");
    if (!header || !body || !signature) return null;
    const expected = createHmac("sha256", requireSecret()).update(header + "." + body).digest();
    const actual = Buffer.from(signature, "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    if (payload.exp !== undefined && Number(payload.exp) <= Math.floor(Date.now() / 1000)) return null;
    if (payload.sub === undefined || typeof payload.email !== "string" || typeof payload.name !== "string" || typeof payload.sid !== "string") return null;
    return { id: String(payload.sub), email: payload.email, name: payload.name, createdAt: String(payload.createdAt ?? ""), mfaVerified: payload.mfa === true, sessionId: payload.sid };
  } catch {
    return null;
  }
}

function getCookie(request: Request, name: string): string | null {
  const raw = request.headers.cookie;
  if (!raw) return null;
  const item = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(name + "="));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

function setSessionCookie(response: Response, token: string, ttlSeconds = TOKEN_TTL_SECONDS): void {
  response.setHeader("Set-Cookie", [
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${ttlSeconds}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  ]);
}

export function clearSessionCookie(response: Response): void {
  response.setHeader("Set-Cookie", [
    `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  ]);
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8 || password.length > 128) throw new Error("Password must contain 8-128 characters.");
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, hash] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export async function issueSession(response: Response, user: AuthUser): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = user.mfaVerified ? 8 * 60 * 60 : TOKEN_TTL_SECONDS;
  const sessionId = randomUUID();
  const expiresAt = new Date((now + ttl) * 1000).toISOString();
  if (AUTH_ENABLED) {
    await query(
      "INSERT INTO auth_sessions (id, user_id, mfa_verified, mfa_verified_at, expires_at) VALUES ($1, $2, $3, CASE WHEN $3 THEN NOW() ELSE NULL END, $4)",
      [sessionId, user.id, user.mfaVerified === true, expiresAt],
    );
  }
  const token = signToken({ sub: user.id, email: user.email, name: user.name, createdAt: user.createdAt, mfa: user.mfaVerified === true, sid: sessionId, iat: now, exp: now + ttl });
  setSessionCookie(response, token, ttl);
}

export async function revokeCurrentSession(request: Request): Promise<void> {
  const token = getCookie(request, COOKIE_NAME) ?? (request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : null);
  if (!token) return;
  const user = verifyToken(token);
  if (!user?.sessionId) return;
  await query("UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL", [user.sessionId, user.id]);
}

export function issueAdminMfaChallenge(response: Response, userId: string, nonce: string): void {
  const now = Math.floor(Date.now() / 1000);
  const token = signToken({ sub: userId, purpose: "admin_mfa_challenge", nonce, iat: now, exp: now + MFA_CHALLENGE_TTL_SECONDS });
  response.setHeader("Set-Cookie", [
    `${MFA_CHALLENGE_COOKIE}=${encodeURIComponent(token)}; Max-Age=${MFA_CHALLENGE_TTL_SECONDS}; Path=/api/auth/admin-mfa; HttpOnly; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  ]);
}

export function clearAdminMfaChallenge(response: Response): void {
  response.setHeader("Set-Cookie", [
    `${MFA_CHALLENGE_COOKIE}=; Max-Age=0; Path=/api/auth/admin-mfa; HttpOnly; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  ]);
}

export function readAdminMfaChallenge(request: Request): { userId: string; nonce: string } | null {
  try {
    const token = getCookie(request, MFA_CHALLENGE_COOKIE);
    if (!token) return null;
    const [header, body, signature] = token.split(".");
    if (!header || !body || !signature) return null;
    const expected = createHmac("sha256", requireSecret()).update(header + "." + body).digest();
    const actual = Buffer.from(signature, "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    if (payload.purpose !== "admin_mfa_challenge" || typeof payload.sub !== "string" || typeof payload.nonce !== "string" || Number(payload.exp) <= Math.floor(Date.now() / 1000)) return null;
    return { userId: payload.sub, nonce: payload.nonce };
  } catch {
    return null;
  }
}

export async function authMiddleware(request: Request, response: Response, next: NextFunction): Promise<void> {
  if (!AUTH_ENABLED) {
    request.user = DEV_USER;
    next();
    return;
  }
  const token = getCookie(request, COOKIE_NAME) ?? (request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : null);
  if (!token) {
    response.status(401).json({ success: false, error: "Authentication required" });
    return;
  }
  const user = verifyToken(token);
  if (!user?.sessionId) {
    clearSessionCookie(response);
    response.status(401).json({ success: false, error: "Session expired or invalid" });
    return;
  }
  try {
    const active = await query(
      `UPDATE auth_sessions s SET last_seen_at = NOW()
       FROM users u
       WHERE s.id = $1 AND s.user_id = $2 AND s.mfa_verified = $3
         AND s.revoked_at IS NULL AND s.expires_at > NOW()
         AND s.last_seen_at > NOW() - INTERVAL '30 minutes'
         AND u.id = s.user_id AND u.status = 'active'
       RETURNING s.id`,
      [user.sessionId, user.id, user.mfaVerified === true],
    );
    if (active.rows.length !== 1) {
      clearSessionCookie(response);
      response.status(401).json({ success: false, error: "Session revoked, expired, or idle for too long" });
      return;
    }
    request.user = user;
    next();
  } catch (error) {
    console.error("[КВАРД] Session validation failed closed", error);
    response.status(503).json({ success: false, error: "Session validation unavailable" });
  }
}

export function getAuthUser(request: Request): AuthUser {
  if (!request.user) throw new Error("Authenticated user is missing");
  return request.user;
}

export function validateEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("Enter a valid email address.");
  return normalized;
}

export function validateName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 80) throw new Error("Name must contain 1-80 characters.");
  return normalized;
}

export async function createUser(email: string, name: string, password: string): Promise<AuthUser> {
  const normalizedEmail = validateEmail(email);
  const normalizedName = validateName(name);
  const passwordHash = await hashPassword(password);
  const id = randomUUID();
  try {
    const result = await query<{ id: string; email: string; name: string; created_at: string }>(
      "INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, email, name, created_at",
      [id, normalizedEmail, normalizedName, passwordHash],
    );
    const row = result.rows[0];
    if (!row) throw new Error("User creation returned no row.");
    return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at };
  } catch (error) {
    if (String(error).includes("users_email_key")) throw new Error("An account with this email already exists.");
    throw error;
  }
}

export async function authenticateUser(email: string, password: string): Promise<AuthUser | null> {
  const normalizedEmail = validateEmail(email);
  const result = await query<{ id: string; email: string; name: string; password_hash: string; created_at: string }>(
    "SELECT id, email, name, password_hash, created_at FROM users WHERE email = $1 LIMIT 1",
    [normalizedEmail],
  );
  const row = result.rows[0];
  if (!row || !(await verifyPassword(password, row.password_hash))) return null;
  return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at };
}
