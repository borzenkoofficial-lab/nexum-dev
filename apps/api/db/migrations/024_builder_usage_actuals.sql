-- Provider-reported token actuals per Builder job (additive). Kept separately
-- from billed_tokens: provider cost analysis vs what the user is charged.
ALTER TABLE builder_usage_ledger ADD COLUMN IF NOT EXISTS input_tokens BIGINT CHECK (input_tokens IS NULL OR input_tokens >= 0);
ALTER TABLE builder_usage_ledger ADD COLUMN IF NOT EXISTS output_tokens BIGINT CHECK (output_tokens IS NULL OR output_tokens >= 0);
