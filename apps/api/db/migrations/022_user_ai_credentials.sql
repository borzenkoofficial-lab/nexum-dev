-- Per-user AI provider keys connected through /api/ai/connect-key (additive).
-- The secret is stored only as an AES-256-GCM envelope (AI_PROVIDER_ENCRYPTION_KEY).
CREATE TABLE IF NOT EXISTS user_ai_credentials (
  user_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL CHECK (provider_id IN ('openai','openrouter','orcarouter','anymodel')),
  encrypted_secret TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
