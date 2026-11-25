-- Account suspension is enforced by the authentication middleware, not only the admin UI.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT;

ALTER TABLE users
  ADD CONSTRAINT users_suspension_state_consistent
  CHECK (
    (status = 'active' AND suspended_at IS NULL AND suspended_by IS NULL AND suspension_reason IS NULL)
    OR
    (status = 'suspended' AND suspended_at IS NOT NULL AND suspension_reason IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS users_status_created_idx ON users(status, created_at DESC);
