-- Track the last successful MFA verification independently from session creation.
ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS mfa_verified_at TIMESTAMPTZ;

UPDATE auth_sessions
SET mfa_verified_at = created_at
WHERE mfa_verified = TRUE AND mfa_verified_at IS NULL;

CREATE INDEX IF NOT EXISTS auth_sessions_recent_mfa_idx
  ON auth_sessions(user_id, mfa_verified_at DESC)
  WHERE revoked_at IS NULL AND mfa_verified = TRUE;
