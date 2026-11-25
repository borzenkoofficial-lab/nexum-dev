-- Durable lease-based queue for business-agent runs.
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_org_idempotency_idx
  ON agent_runs (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_runs_queue_ready_idx
  ON agent_runs (available_at, created_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS agent_runs_queue_expired_lease_idx
  ON agent_runs (lease_expires_at, created_at)
  WHERE status IN ('initializing', 'planning', 'running');

CREATE INDEX IF NOT EXISTS agent_runs_worker_owner_idx
  ON agent_runs (lease_owner, lease_expires_at)
  WHERE lease_owner IS NOT NULL;

COMMENT ON COLUMN agent_runs.attempts IS 'Number of times a worker has acquired this run; lease-expiry recovery is at-least-once.';
COMMENT ON COLUMN agent_runs.idempotency_key IS 'Optional tenant-scoped key preventing duplicate enqueue requests.';
