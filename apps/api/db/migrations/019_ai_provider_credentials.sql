CREATE TABLE IF NOT EXISTS ai_provider_credentials (
  provider_id TEXT PRIMARY KEY CHECK (provider_id IN ('openai','anthropic','openrouter','orcarouter','anymodel')),
  encrypted_secret TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'configured'
    CHECK (status IN ('configured','verified','invalid')),
  configured_by UUID REFERENCES users(id) ON DELETE SET NULL,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_provider_credentials_status_idx
  ON ai_provider_credentials(status, updated_at DESC);
