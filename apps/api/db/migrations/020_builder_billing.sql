-- KVARD Builder metering (additive; no existing data is changed).
-- user_id is TEXT without a foreign key on purpose: Builder jobs also run for the
-- fixed local/E2E user when authentication is disabled outside production.
CREATE TABLE IF NOT EXISTS builder_billing_accounts (
  user_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS builder_usage_ledger (
  job_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'released')),
  reserved_tokens BIGINT NOT NULL CHECK (reserved_tokens >= 0),
  billed_tokens BIGINT NOT NULL DEFAULT 0 CHECK (billed_tokens >= 0 AND billed_tokens <= reserved_tokens),
  metering_basis TEXT CHECK (metering_basis IN ('token_budget_upper_bound', 'provider_reported')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  CHECK ((status = 'reserved') = (settled_at IS NULL))
);

CREATE INDEX IF NOT EXISTS builder_usage_ledger_user_period_idx
  ON builder_usage_ledger (user_id, period_start, status);
