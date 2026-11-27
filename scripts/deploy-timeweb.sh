#!/usr/bin/env bash
# Deploy the latest `main` to the Timeweb VPS with an automatic rollback.
#
#   ./scripts/deploy-timeweb.sh
#
# 1. requires a clean checkout of `main` (or of a release left by a rollback);
# 2. fast-forwards to origin/main and builds the image tagged with the commit;
# 3. starts it and runs scripts/smoke-production.sh against the public domain;
# 4. on failure restarts the previously deployed release from its existing image
#    (no rebuild) and exits non-zero.
#
# Migrations are forward-only and applied at startup. A rollback runs the
# previous code on the newer schema, which is safe because KVARD migrations are
# additive (see docs/deployment/timeweb-vps.md, "Откат").
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
STATE_DIR="$ROOT_DIR/.deploy"
CURRENT_FILE="$STATE_DIR/current-release"
KEEP_IMAGES="${KVARD_KEEP_IMAGES:-3}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or remove local changes before deployment." >&2
  exit 1
fi
for file in .env .env.production; do
  [[ -f "$file" ]] || { echo "Missing $file. Follow docs/deployment/timeweb-vps.md first." >&2; exit 1; }
done

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

mkdir -p "$STATE_DIR"
previous_release="$(cat "$CURRENT_FILE" 2>/dev/null || true)"

# A previous rollback leaves the checkout detached at the restored release.
current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "main" ]]; then
  if [[ -z "$current_branch" ]]; then
    git checkout main
  else
    echo "Deployment is allowed only from main (current branch: $current_branch)." >&2
    exit 1
  fi
fi

git fetch origin main
git pull --ff-only origin main
new_release="$(git rev-parse --short=12 HEAD)"
echo "Deploying release $new_release (previous: ${previous_release:-none})"

compose() { KVARD_RELEASE="$1" docker compose "${@:2}"; }

wait_and_smoke() {
  local release="$1"
  echo "Waiting for https://$KVARD_DOMAIN to serve release $release"
  for _ in $(seq 1 60); do
    if curl --silent --fail --max-time 10 "https://$KVARD_DOMAIN/api/build-info" 2>/dev/null | grep -q "\"release\":\"$release\""; then
      "$ROOT_DIR/scripts/smoke-production.sh" "https://$KVARD_DOMAIN" "$release"
      return $?
    fi
    sleep 5
  done
  echo "Release $release did not come up within 5 minutes." >&2
  return 1
}

compose "$new_release" config --quiet
compose "$new_release" build api
compose "$new_release" up -d --remove-orphans

if wait_and_smoke "$new_release"; then
  printf '%s\n' "$new_release" > "$CURRENT_FILE"
  compose "$new_release" ps
  # Keep the newest images for future rollbacks, remove older release images.
  docker image ls kvard-api --format '{{.CreatedAt}}\t{{.Tag}}' | sort -r | tail -n +"$((KEEP_IMAGES + 1))" | cut -f2 \
    | while read -r tag; do [[ "$tag" != "$new_release" ]] && docker image rm "kvard-api:$tag" >/dev/null 2>&1 || true; done
  echo "KVARD $new_release is deployed and healthy."
  exit 0
fi

echo "Deployment of $new_release FAILED. Recent logs:" >&2
compose "$new_release" logs --tail=120 api caddy >&2 || true

if [[ -z "$previous_release" ]] || ! docker image inspect "kvard-api:$previous_release" >/dev/null 2>&1; then
  echo "No previous release image to roll back to. Production needs manual attention." >&2
  exit 1
fi

echo "Rolling back to $previous_release (existing image, no rebuild)" >&2
git checkout --detach "$previous_release"
compose "$previous_release" up -d --no-build --remove-orphans
if wait_and_smoke "$previous_release"; then
  echo "Rolled back to $previous_release. Fix $new_release before deploying again." >&2
else
  echo "Rollback to $previous_release did not pass the smoke test either. Production needs manual attention." >&2
fi
exit 1
