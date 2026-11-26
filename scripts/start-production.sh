#!/bin/sh
set -eu

if [ -n "\${NEXUM_DATABASE_URL:-}" ]; then
  echo "[KVARD] Applying pending PostgreSQL migrations..."
  node /app/apps/api/dist/db/migrate.js
else
  echo "[KVARD] WARNING: NEXUM_DATABASE_URL is empty; database migrations are skipped."
fi

exec node /app/apps/api/dist/server.js
