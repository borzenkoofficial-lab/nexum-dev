#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.staging ]; then
  echo "Missing .env.staging. Copy .env.staging.example and fill the values."
  exit 1
fi

docker compose -f docker-compose.staging.yml pull caddy
docker compose -f docker-compose.staging.yml build --pull
docker compose -f docker-compose.staging.yml up -d

echo
echo "NEXUM staging containers:"
docker compose -f docker-compose.staging.yml ps
echo
echo "Health:"
curl -fsS "https://$(grep '^NEXUM_DOMAIN=' .env.staging | cut -d= -f2)/api/health" || true
echo
