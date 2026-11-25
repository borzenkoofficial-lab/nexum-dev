CREATE TABLE IF NOT EXISTS agent_definitions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  allowed_tools TEXT[] NOT NULL DEFAULT '{}',
  approval_policy TEXT NOT NULL DEFAULT 'always' CHECK (approval_policy IN ('always', 'writes', 'autonomous')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_definitions_user_name_idx
  ON agent_definitions (user_id, lower(name));

CREATE INDEX IF NOT EXISTS agent_definitions_user_updated_idx
  ON agent_definitions (user_id, updated_at DESC);
