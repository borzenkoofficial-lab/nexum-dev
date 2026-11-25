CREATE TABLE IF NOT EXISTS agent_profiles (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'Мой профиль',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_profiles_user_name_idx
  ON agent_profiles (user_id, lower(name));

CREATE INDEX IF NOT EXISTS agent_profiles_user_updated_idx
  ON agent_profiles (user_id, updated_at DESC);
