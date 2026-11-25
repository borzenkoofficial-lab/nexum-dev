ALTER TABLE admin_mfa
  ADD COLUMN IF NOT EXISTS pending_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enrollment_failed_attempts INTEGER NOT NULL DEFAULT 0
    CHECK (enrollment_failed_attempts >= 0);
