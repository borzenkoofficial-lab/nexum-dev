import { Router } from "express";
import { getAuthUser } from "../auth.js";
import { query, withDatabaseTransaction } from "../db.js";
import { encryptMfaSecret } from "../mfaEncryption.js";
import { generateTotpSecret, generateRecoveryCodes, verifyTotpCode } from "../totp.js";

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

adminMfaRouter.post("/setup", async (req, res) => {
  const user = getAuthUser(req);
  try {
    if (!(await ensureAdminUser(user.id))) return res.status(403).json({ success: false, error: "Admin role required for MFA enrollment." });
    const key = getEncryptionKey();
    const secret = generateTotpSecret();
    const encrypted = encryptMfaSecret(secret, key);
    await query(
      `INSERT INTO admin_mfa (user_id, pending_encrypted_secret, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         pending_encrypted_secret = EXCLUDED.pending_encrypted_secret,
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

adminMfaRouter.post("/confirm", async (req, res) => {
  const user = getAuthUser(req);
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ success: false, error: "Enter the 6-digit authenticator code." });
  try {
    const key = getEncryptionKey();
    const pending = await query<{ pending_encrypted_secret: string | null }>(
      "SELECT pending_encrypted_secret FROM admin_mfa WHERE user_id = $1",
      [user.id],
    );
    const encryptedSecret = pending.rows[0]?.pending_encrypted_secret;
    if (!encryptedSecret) return res.status(409).json({ success: false, error: "MFA setup was not started or has expired. Start setup again." });
    const { decryptMfaSecret } = await import("../mfaEncryption.js");
    const secret = decryptMfaSecret(encryptedSecret, key);
    if (!verifyTotpCode(secret, code)) return res.status(401).json({ success: false, error: "Invalid authenticator code." });
    const recovery = generateRecoveryCodes();
    const currentCounter = Math.floor(Date.now() / 30_000);
    const enabled = await withDatabaseTransaction(async (client) => {
      const result = await client.query(
        `UPDATE admin_mfa SET enabled = TRUE, encrypted_secret = pending_encrypted_secret,
           pending_encrypted_secret = NULL, recovery_code_hashes = $2, last_accepted_totp_counter = $3,
           failed_attempts = 0, locked_until = NULL, enrolled_at = NOW(), updated_at = NOW()
         WHERE user_id = $1 AND pending_encrypted_secret = $4
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

adminMfaRouter.get("/status", async (req, res) => {
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
