-- One-time, short-lived MFA challenge state. The signed challenge cookie is not a user session.
ALTER TABLE admin_mfa
  ADD COLUMN IF NOT EXISTS login_challenge_nonce TEXT,
  ADD COLUMN IF NOT EXISTS login_challenge_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS admin_mfa_login_challenge_expiry_idx
  ON admin_mfa(login_challenge_expires_at)
  WHERE login_challenge_expires_at IS NOT NULL;
