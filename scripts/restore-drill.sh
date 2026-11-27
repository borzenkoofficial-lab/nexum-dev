#!/usr/bin/env bash
# Restore drill: proves a backup made by scripts/backup-timeweb.sh is usable,
# WITHOUT touching production. It verifies checksums, restores the database
# into a throwaway PostgreSQL container, checks the migration journal and key
# tables, and unpacks the workspace archive into a temporary directory.
#
#   scripts/restore-drill.sh /srv/kvard/backups/20261127T030000Z
#
# A real restore (replacing production data) is a manual, owner-approved
# procedure described in docs/deployment/timeweb-vps.md.
set -Eeuo pipefail

BACKUP="${1:?usage: restore-drill.sh <backup-directory>}"
PG_IMAGE="${KVARD_BACKUP_PG_IMAGE:-postgres:16}"
[[ -f "$BACKUP/SHA256SUMS" ]] || { echo "Not a KVARD backup directory: $BACKUP" >&2; exit 1; }

container="kvard-restore-drill-$$"
workdir="$(mktemp -d)"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$workdir"
}
trap cleanup EXIT

echo "[1/4] Checksums"
(cd "$BACKUP" && sha256sum --check --quiet SHA256SUMS)
echo "      ok"

echo "[2/4] Restore database into a throwaway PostgreSQL ($PG_IMAGE)"
docker run -d --name "$container" -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=kvard "$PG_IMAGE" >/dev/null
# The image starts a temporary server for initialisation, stops it, then starts
# the real one: pg_isready alone can answer during that window. Wait for the
# second "ready to accept connections" (the final server).
ready=0
for _ in $(seq 1 90); do
  if [[ "$(docker logs "$container" 2>&1 | grep -c 'ready to accept connections')" -ge 2 ]] \
    && docker exec "$container" pg_isready -U postgres -d kvard >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
(( ready )) || { echo "Throwaway PostgreSQL did not become ready." >&2; docker logs --tail 30 "$container" >&2; exit 1; }
docker exec -i "$container" pg_restore --exit-on-error --no-owner --no-privileges -U postgres -d kvard < "$BACKUP/database.dump"

echo "[3/4] Verify restored database"
psql_value() { docker exec "$container" psql -U postgres -d kvard -tAc "$1"; }
migrations="$(psql_value "SELECT COUNT(*) FROM schema_migrations")"
latest="$(psql_value "SELECT MAX(version) FROM schema_migrations")"
users="$(psql_value "SELECT COUNT(*) FROM users")"
(( migrations > 0 )) || { echo "No applied migrations in the restored database." >&2; exit 1; }
echo "      migrations applied: $migrations (latest version $latest), users: $users"
for table in users auth_sessions builder_usage_ledger; do
  [[ "$(psql_value "SELECT to_regclass('public.$table') IS NOT NULL")" == "t" ]] || { echo "Missing table $table" >&2; exit 1; }
done
echo "      key tables present"

echo "[4/4] Unpack workspace archive"
tar --extract --gzip --file "$BACKUP/data.tar.gz" --directory "$workdir"
files="$(find "$workdir" -type f | wc -l)"
echo "      files restored: $files"

echo "Restore drill passed for $BACKUP"
