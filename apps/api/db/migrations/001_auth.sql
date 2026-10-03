CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

-- Development/E2E identity used when authentication is intentionally disabled.
-- The production path always requires real authentication.
INSERT INTO users (id, email, name, password_hash)
VALUES ('00000000-0000-4000-8000-000000000001', 'dev@nexum.local', 'Nexum Developer', 'disabled')
ON CONFLICT (id) DO NOTHING;
