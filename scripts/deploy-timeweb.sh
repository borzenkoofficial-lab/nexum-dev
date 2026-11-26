#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "Deployment is allowed only from the main branch." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or remove local changes before deployment." >&2
  exit 1
fi

if [[ ! -f .env || ! -f .env.production ]]; then
  echo "Missing .env or .env.production. Follow docs/deployment/timeweb-vps.md first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source ./.env
set +a

if [[ -z "${KVARD_DOMAIN:-}" || -z "${KVARD_DATA_DIR:-}" ]]; then
  echo "KVARD_DOMAIN and KVARD_DATA_DIR must be set in .env." >&2
  exit 1
fi

if [[ ! -d "$KVARD_DATA_DIR" || ! -w "$KVARD_DATA_DIR" ]]; then
  echo "Persistent data directory must exist and be writable by the deploy user: $KVARD_DATA_DIR" >&2
  exit 1
fi

git fetch origin main
git pull --ff-only origin main

docker compose config --quiet
docker compose up -d --build --remove-orphans

echo "Waiting for KVARD health check at https://$KVARD_DOMAIN/api/health"
for attempt in $(seq 1 60); do
  response="$(curl --silent --show-error --fail --max-time 10 "https://$KVARD_DOMAIN/api/health" 2>/dev/null || true)"
  if [[ "$response" == *'"status":"ok"'* ]]; then
    echo "KVARD deployment is healthy."
    docker compose ps
    exit 0
  fi
  sleep 5
done

echo "KVARD did not become healthy. Recent service logs:"
docker compose logs --tail=120 api caddy || true
exit 1
