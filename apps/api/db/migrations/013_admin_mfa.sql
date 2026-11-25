CREATE TABLE IF NOT EXISTS admin_mfa (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  encrypted_secret TEXT,
  pending_encrypted_secret TEXT,
  recovery_code_hashes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  last_accepted_totp_counter BIGINT,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TIMESTAMPTZ,
  enrolled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (enabled = FALSE AND encrypted_secret IS NULL AND enrolled_at IS NULL)
    OR
    (enabled = TRUE AND encrypted_secret IS NOT NULL AND enrolled_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS admin_mfa_locked_until_idx
  ON admin_mfa(locked_until) WHERE locked_until IS NOT NULL;
