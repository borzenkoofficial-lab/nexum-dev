-- Idempotent Builder task submission (additive). A client retry of POST /api/chat
-- with the same Idempotency-Key returns the original job instead of a duplicate.
CREATE TABLE IF NOT EXISTS chat_job_idempotency_keys (
  user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  job_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS chat_job_idempotency_keys_created_idx ON chat_job_idempotency_keys (created_at);
