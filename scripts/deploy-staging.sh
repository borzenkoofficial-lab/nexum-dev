#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.staging ]; then
  echo "Missing .env.staging. Copy .env.staging.example and replace all placeholders."
  exit 1
fi

DOMAIN="$(sed -n 's/^NEXUM_DOMAIN=//p' .env.staging | head -n 1 | tr -d '\r')"
if [ -z "$DOMAIN" ] || [[ "$DOMAIN" == *REPLACE* ]] || [[ "$DOMAIN" == *" "* ]]; then
  echo "NEXUM_DOMAIN must be a real DNS name in .env.staging."
  exit 1
fi
for key in NEXUM_DATABASE_URL NEXUM_AUTH_SECRET NEXUM_SANDBOX_WORKER_SECRET ANYMODEL_API_KEY; do
  value="$(sed -n "s/^${key}=//p" .env.staging | head -n 1 | tr -d '\r')"
  if [ -z "$value" ] || [[ "$value" == *REPLACE* ]] || [[ "$value" == *DB_HOST_REACHABLE_FROM_DOCKER* ]]; then
    echo "$key is missing or still contains a placeholder in .env.staging."
    exit 1
  fi
done
for key in NEXUM_AUTH_SECRET NEXUM_SANDBOX_WORKER_SECRET; do
  value="$(sed -n "s/^${key}=//p" .env.staging | head -n 1 | tr -d '\r')"
  if [ "${#value}" -lt 32 ]; then
    echo "$key must contain at least 32 characters."
    exit 1
  fi
done

docker compose --env-file .env.staging -f docker-compose.staging.yml config --quiet
docker compose --env-file .env.staging -f docker-compose.staging.yml pull caddy
docker compose --env-file .env.staging -f docker-compose.staging.yml build --pull
# The worker uses this image inside isolated child containers; pulling it on the
# host avoids an implicit network pull from a production sandbox request.
docker pull node:22-bookworm-slim
# Apply database migrations before routing traffic to the new application.
docker compose --env-file .env.staging -f docker-compose.staging.yml run --rm --no-deps api node apps/api/dist/db/migrate.js
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d

echo
echo "NEXUM staging containers:"
docker compose --env-file .env.staging -f docker-compose.staging.yml ps
echo
echo "Health:"
curl --retry 10 --retry-connrefused --retry-delay 3 -fsS "https://$DOMAIN/api/ready"
echo
