#!/usr/bin/env bash
# Consistent backup of KVARD production data on the VPS:
#   - PostgreSQL: pg_dump custom format (all schema + data) of NEXUM_DATABASE_URL;
#   - workspace files: tar of KVARD_DATA_DIR (projects, checkpoints), without
#     regenerable dependency folders.
# Writes into $KVARD_BACKUP_DIR/<UTC timestamp>/ with a SHA-256 manifest and
# removes backups older than $KVARD_BACKUP_RETENTION_DAYS (default 14).
# Optional off-site copy: set KVARD_BACKUP_RCLONE_REMOTE (e.g. "timeweb-s3:kvard-backups")
# to an rclone remote configured on the VPS (Timeweb S3 is S3-compatible).
#
#   scripts/backup-timeweb.sh            # uses ./.env and ./.env.production
#
# Verify every backup with scripts/restore-drill.sh before relying on it.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

for file in .env .env.production; do
  [[ -f "$file" ]] || { echo "Missing $file (see docs/deployment/timeweb-vps.md)." >&2; exit 1; }
done
set -a
# shellcheck disable=SC1091
source ./.env
# shellcheck disable=SC1091
source ./.env.production
set +a

: "${NEXUM_DATABASE_URL:?NEXUM_DATABASE_URL must be set in .env.production}"
: "${KVARD_DATA_DIR:?KVARD_DATA_DIR must be set in .env}"
BACKUP_ROOT="${KVARD_BACKUP_DIR:-/srv/kvard/backups}"
RETENTION_DAYS="${KVARD_BACKUP_RETENTION_DAYS:-14}"
PG_IMAGE="${KVARD_BACKUP_PG_IMAGE:-postgres:16}"

[[ -d "$KVARD_DATA_DIR" ]] || { echo "Data directory not found: $KVARD_DATA_DIR" >&2; exit 1; }
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || { echo "KVARD_BACKUP_RETENTION_DAYS must be a number." >&2; exit 1; }

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_ROOT/$stamp"
mkdir -p "$target"
chmod 700 "$BACKUP_ROOT" "$target"
trap 'echo "Backup FAILED; incomplete directory left at $target for inspection." >&2' ERR

echo "[1/3] PostgreSQL dump -> $target/database.dump"
# The client runs in a container so the VPS needs no PostgreSQL packages. The
# connection string is passed through the environment, never on the command line.
# Managed PostgreSQL requires TLS: require it unless the URL says otherwise.
docker run --rm --network host \
  -e PGSSLMODE="${KVARD_BACKUP_PGSSLMODE:-$([[ "${NEXUM_DB_SSL:-true}" == "false" ]] && echo disable || echo require)}" \
  -e NEXUM_DATABASE_URL \
  "$PG_IMAGE" sh -c 'pg_dump --format=custom --no-owner --no-privileges --dbname="$NEXUM_DATABASE_URL"' \
  > "$target/database.dump"
[[ -s "$target/database.dump" ]] || { echo "pg_dump produced an empty file." >&2; exit 1; }

echo "[2/3] Workspace files -> $target/data.tar.gz"
tar --create --gzip --file "$target/data.tar.gz" \
  --directory "$KVARD_DATA_DIR" \
  --exclude='*/node_modules' --exclude='*/dist' \
  .

echo "[3/3] Manifest"
(
  cd "$target"
  {
    echo "created_at=$stamp"
    echo "release=$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
    echo "data_dir=$KVARD_DATA_DIR"
  } > backup.info
  sha256sum database.dump data.tar.gz backup.info > SHA256SUMS
)
chmod 600 "$target"/*
trap - ERR

if [[ -n "${KVARD_BACKUP_RCLONE_REMOTE:-}" ]]; then
  echo "Off-site copy -> $KVARD_BACKUP_RCLONE_REMOTE/$stamp"
  rclone copy "$target" "$KVARD_BACKUP_RCLONE_REMOTE/$stamp"
fi

if (( RETENTION_DAYS > 0 )); then
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*Z' -mtime +"$RETENTION_DAYS" -print -exec rm -rf {} +
fi

du -sh "$target"
echo "Backup complete: $target"
