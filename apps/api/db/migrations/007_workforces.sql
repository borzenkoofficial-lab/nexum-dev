CREATE TABLE IF NOT EXISTS workforces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'paused', 'archived')),
  current_version_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS workforces_org_updated_idx ON workforces(organization_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS workforce_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workforce_id UUID NOT NULL REFERENCES workforces(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  graph JSONB NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workforce_id, version_number),
  UNIQUE (workforce_id, id)
);
ALTER TABLE workforces DROP CONSTRAINT IF EXISTS workforces_current_version_fk;
ALTER TABLE workforces ADD CONSTRAINT workforces_current_version_fk
  FOREIGN KEY (id, current_version_id) REFERENCES workforce_versions(workforce_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS workforce_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workforce_id UUID NOT NULL REFERENCES workforces(id) ON DELETE CASCADE,
  workforce_version_id UUID NOT NULL REFERENCES workforce_versions(id),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled', 'timed_out')),
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS workforce_runs_org_created_idx ON workforce_runs(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workforce_node_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workforce_run_id UUID NOT NULL REFERENCES workforce_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  agent_run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  UNIQUE (workforce_run_id, node_id)
);
