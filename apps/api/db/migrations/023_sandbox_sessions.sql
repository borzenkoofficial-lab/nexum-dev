-- Durable record of remote sandbox environments (additive). Lets a new API
-- process find and delete sandboxes orphaned when a previous process died.
CREATE TABLE IF NOT EXISTS sandbox_sessions (
  remote_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  task_id TEXT,
  project_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  release_reason TEXT
);
CREATE INDEX IF NOT EXISTS sandbox_sessions_unreleased_idx ON sandbox_sessions (created_at) WHERE released_at IS NULL;
