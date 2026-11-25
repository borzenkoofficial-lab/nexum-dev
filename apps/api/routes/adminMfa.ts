import { Router } from "express";
import { authMiddleware, clearAdminMfaChallenge, getAuthUser, issueSession, readAdminMfaChallenge } from "../auth.js";
import { query, withDatabaseTransaction } from "../db.js";
import { encryptMfaSecret } from "../mfaEncryption.js";
import { generateTotpSecret, generateRecoveryCodes, matchTotpCounter, verifyRecoveryCode, verifyTotpCode } from "../totp.js";

export const adminMfaRouter = Router();

function getEncryptionKey(): string {
  const key = process.env.KVARD_MFA_ENCRYPTION_KEY?.trim() ?? "";
  if (key.length < 32) throw new Error("KVARD_MFA_ENCRYPTION_KEY must be configured with at least 32 characters.");
  return key;
}

async function ensureAdminUser(userId: string): Promise<boolean> {
  const result = await query<{ role: string }>("SELECT role FROM admin_role_assignments WHERE user_id = $1 LIMIT 1", [userId]);
  return Boolean(result.rows[0]?.role);
}

adminMfaRouter.post("/challenge/verify", async (req, res) => {
  const challenge = readAdminMfaChallenge(req);
  if (!challenge) {
    clearAdminMfaChallenge(res);
    return res.status(401).json({ success: false, error: "MFA challenge is missing or expired. Sign in again." });
  }
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!/^\d{6}$/.test(code) && !/^[0-9a-fA-F-]{20,24}$/.test(code)) {
    return res.status(400).json({ success: false, error: "Enter a 6-digit authenticator code or an unused recovery code." });
  }
  try {
    const key = getEncryptionKey();
    const outcome = await withDatabaseTransaction(async (client) => {
      const result = await client.query<{
        enabled: boolean; encrypted_secret: string | null; login_challenge_nonce: string | null;
        login_challenge_expires_at: string | null; last_accepted_totp_counter: string | number | null;
        failed_attempts: number; locked_until: string | null; recovery_code_hashes: string[];
      }>(
        `SELECT enabled, encrypted_secret, login_challenge_nonce, login_challenge_expires_at,
                last_accepted_totp_counter, failed_attempts, locked_until, recovery_code_hashes
         FROM admin_mfa WHERE user_id = $1 FOR UPDATE`,
        [challenge.userId],
      );
      const row = result.rows[0];
      if (!row?.enabled || !row.encrypted_secret || row.login_challenge_nonce !== challenge.nonce ||
          !row.login_challenge_expires_at || new Date(row.login_challenge_expires_at).getTime() <= Date.now()) {
        return { ok: false as const, status: 401, error: "MFA challenge is invalid or expired." };
      }
      if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
        return { ok: false as const, status: 429, error: "MFA verification is temporarily locked. Try again later." };
      }
      let acceptedCounter: number | null = null;
      let recoveryHashes = row.recovery_code_hashes ?? [];
      if (/^\d{6}$/.test(code)) {
        const { decryptMfaSecret } = await import("../mfaEncryption.js");
        const secret = decryptMfaSecret(row.encrypted_secret, key);
        const matched = matchTotpCounter(secret, code);
        const last = row.last_accepted_totp_counter === null ? -1 : Number(row.last_accepted_totp_counter);
        if (matched !== null && matched > last) acceptedCounter = matched;
      } else {
        const index = recoveryHashes.findIndex((hash) => verifyRecoveryCode(code, hash));
        if (index >= 0) recoveryHashes = recoveryHashes.filter((_, itemIndex) => itemIndex !== index);
      }
      const accepted = acceptedCounter !== null || recoveryHashes.length !== (row.recovery_code_hashes ?? []).length;
      if (!accepted) {
        const failures = (row.failed_attempts ?? 0) + 1;
        await client.query(
          `UPDATE admin_mfa SET failed_attempts = $2,
             locked_until = CASE WHEN $2 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END,
             updated_at = NOW() WHERE user_id = $1`,
          [challenge.userId, failures],
        );
        return { ok: false as const, status: failures >= 5 ? 429 : 401, error: "Invalid or already used MFA code." };
      }
      const consumed = await client.query(
        `UPDATE admin_mfa SET
           last_accepted_totp_counter = CASE WHEN $2::bigint IS NULL THEN last_accepted_totp_counter ELSE $2::bigint END,
           recovery_code_hashes = $3, failed_attempts = 0, locked_until = NULL,
           login_challenge_nonce = NULL, login_challenge_expires_at = NULL, updated_at = NOW()
         WHERE user_id = $1 AND login_challenge_nonce = $4
         RETURNING user_id`,
        [challenge.userId, acceptedCounter, recoveryHashes, challenge.nonce],
      );
      if (consumed.rowCount !== 1) return { ok: false as const, status: 409, error: "MFA challenge was already consumed." };
      const userResult = await client.query<{ id: string; email: string; name: string; created_at: string }>(
        "SELECT u.id, u.email, u.name, u.created_at FROM users u INNER JOIN admin_role_assignments r ON r.user_id = u.id WHERE u.id = $1",
        [challenge.userId],
      );
      const user = userResult.rows[0];
      if (!user) return { ok: false as const, status: 401, error: "Account is unavailable." };
      return { ok: true as const, user: { id: user.id, email: user.email, name: user.name, createdAt: user.created_at, mfaVerified: true } };
    });
    if (!outcome.ok) return res.status(outcome.status).json({ success: false, error: outcome.error });
    clearAdminMfaChallenge(res);
    issueSession(res, outcome.user);
    return res.json({ success: true, mfaVerified: true, user: { id: outcome.user.id, email: outcome.user.email, name: outcome.user.name, createdAt: outcome.user.createdAt } });
  } catch (error) {
    return res.status(503).json({ success: false, error: error instanceof Error ? error.message : "MFA verification unavailable." });
  }
});

adminMfaRouter.post("/setup", authMiddleware, async (req, res) => {
  const user = getAuthUser(req);
  try {
    if (!(await ensureAdminUser(user.id))) return res.status(403).json({ success: false, error: "Admin role required for MFA enrollment." });
    const existing = await query<{ enabled: boolean }>("SELECT enabled FROM admin_mfa WHERE user_id = $1", [user.id]);
    if (existing.rows[0]?.enabled) return res.status(409).json({ success: false, error: "MFA is already enabled. Use a separate verified rotation flow." });
    const key = getEncryptionKey();
    const secret = generateTotpSecret();
    const encrypted = encryptMfaSecret(secret, key);
    await query(
      `INSERT INTO admin_mfa (user_id, pending_encrypted_secret, pending_expires_at, enrollment_failed_attempts, updated_at)
       VALUES ($1, $2, NOW() + INTERVAL '10 minutes', 0, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         pending_encrypted_secret = EXCLUDED.pending_encrypted_secret,
         pending_expires_at = EXCLUDED.pending_expires_at,
         enrollment_failed_attempts = 0,
         updated_at = NOW()`,
      [user.id, encrypted],
    );
    const issuer = "КВАРД";
    const label = encodeURIComponent(`${issuer}:${user.email}`);
    const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    return res.json({ success: true, secret, otpauthUri: uri, instructions: "Add this secret to your authenticator app, then confirm with the current 6-digit code. This pending secret is replaced when setup is restarted." });
  } catch (error) {
    return res.status(503).json({ success: false, error: error instanceof Error ? error.message : "MFA setup unavailable." });
  }
});

adminMfaRouter.post("/confirm", authMiddleware, async (req, res) => {
  const user = getAuthUser(req);
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ success: false, error: "Enter the 6-digit authenticator code." });
  try {
    const key = getEncryptionKey();
    const pending = await query<{ pending_encrypted_secret: string | null; pending_expires_at: string | null; enrollment_failed_attempts: number }>(
      "SELECT pending_encrypted_secret, pending_expires_at, enrollment_failed_attempts FROM admin_mfa WHERE user_id = $1",
      [user.id],
    );
    const pendingRow = pending.rows[0];
    const encryptedSecret = pendingRow?.pending_encrypted_secret;
    if (!encryptedSecret || !pendingRow?.pending_expires_at || new Date(pendingRow.pending_expires_at).getTime() <= Date.now()) {
      return res.status(409).json({ success: false, error: "MFA setup was not started or has expired. Start setup again." });
    }
    if ((pendingRow.enrollment_failed_attempts ?? 0) >= 5) {
      return res.status(429).json({ success: false, error: "MFA enrollment confirmation is locked. Start a new setup after cooldown." });
    }
    const { decryptMfaSecret } = await import("../mfaEncryption.js");
    const secret = decryptMfaSecret(encryptedSecret, key);
    if (!verifyTotpCode(secret, code)) {
      await query("UPDATE admin_mfa SET enrollment_failed_attempts = enrollment_failed_attempts + 1, updated_at = NOW() WHERE user_id = $1", [user.id]);
      return res.status(401).json({ success: false, error: "Invalid authenticator code." });
    }
    const recovery = generateRecoveryCodes();
    const currentCounter = Math.floor(Date.now() / 30_000);
    const enabled = await withDatabaseTransaction(async (client) => {
      const result = await client.query(
        `UPDATE admin_mfa SET enabled = TRUE, encrypted_secret = pending_encrypted_secret,
           pending_encrypted_secret = NULL, pending_expires_at = NULL, enrollment_failed_attempts = 0,
           recovery_code_hashes = $2, last_accepted_totp_counter = $3,
           failed_attempts = 0, locked_until = NULL, enrolled_at = NOW(), updated_at = NOW()
         WHERE user_id = $1 AND pending_encrypted_secret = $4 AND pending_expires_at > NOW()
         RETURNING user_id`,
        [user.id, recovery.hashes, currentCounter, encryptedSecret],
      );
      return result.rowCount === 1;
    });
    if (!enabled) return res.status(409).json({ success: false, error: "MFA setup state changed; please retry." });
    return res.json({ success: true, enabled: true, recoveryCodes: recovery.codes, warning: "Recovery codes are shown once. Save them securely now; they will not be shown again." });
  } catch (error) {
    return res.status(503).json({ success: false, error: error instanceof Error ? error.message : "MFA confirmation unavailable." });
  }
});

adminMfaRouter.get("/status", authMiddleware, async (req, res) => {
  const user = getAuthUser(req);
  try {
    if (!(await ensureAdminUser(user.id))) return res.status(403).json({ success: false, error: "Admin role required." });
    const result = await query<{ enabled: boolean; enrolled_at: string | null; recovery_count: number }>(
      "SELECT enabled, enrolled_at, cardinality(recovery_code_hashes) AS recovery_count FROM admin_mfa WHERE user_id = $1",
      [user.id],
    );
    const row = result.rows[0];
    return res.json({ success: true, enabled: row?.enabled ?? false, enrolledAt: row?.enrolled_at ?? null, recoveryCodesRemaining: row?.recovery_count ?? 0 });
  } catch {
    return res.status(503).json({ success: false, error: "MFA status unavailable." });
  }
});
