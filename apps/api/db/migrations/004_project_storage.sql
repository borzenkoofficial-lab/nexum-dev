-- Durable project workspace metadata.
-- Object bytes live in an S3-compatible bucket; PostgreSQL is the metadata and
-- committed-manifest source of truth. This migration does not move existing
-- local workspaces or switch runtime storage providers.

CREATE TABLE IF NOT EXISTS project_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL CHECK (project_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  project_type TEXT NOT NULL DEFAULT 'Веб-приложение',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  storage_provider TEXT NOT NULL DEFAULT 's3',
  storage_bucket TEXT NOT NULL,
  storage_prefix TEXT NOT NULL,
  committed_revision BIGINT NOT NULL DEFAULT 0 CHECK (committed_revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, project_id),
  UNIQUE (storage_provider, storage_bucket, storage_prefix)
);

CREATE INDEX IF NOT EXISTS project_workspaces_user_updated_idx
  ON project_workspaces (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_workspace_files (
  workspace_id UUID NOT NULL REFERENCES project_workspaces(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL CHECK (
    relative_path <> '' AND
    relative_path !~ '(^/|(^|/)\.\.(/|$)|\\|(^|/)\.($|/))'
  ),
  object_key TEXT NOT NULL UNIQUE,
  sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  revision BIGINT NOT NULL CHECK (revision > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, relative_path)
);

CREATE INDEX IF NOT EXISTS project_workspace_files_revision_idx
  ON project_workspace_files (workspace_id, revision);

CREATE TABLE IF NOT EXISTS project_workspace_commits (
  workspace_id UUID NOT NULL REFERENCES project_workspaces(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL CHECK (revision > 0),
  manifest_object_key TEXT NOT NULL UNIQUE,
  manifest_sha256 CHAR(64) NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  file_count INTEGER NOT NULL CHECK (file_count >= 0),
  total_bytes BIGINT NOT NULL CHECK (total_bytes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, revision)
);

CREATE TABLE IF NOT EXISTS user_project_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active_project_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
