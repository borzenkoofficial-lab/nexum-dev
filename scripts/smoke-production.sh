#!/usr/bin/env bash
# Post-deploy smoke test for a running KVARD instance.
#
#   scripts/smoke-production.sh https://kvard.example.com [expected-release]
#
# Checks: API + PostgreSQL health, the deployed release (git commit), the SPA is
# served, protected API requires a session, security headers are present.
# Exit code 0 only when every check passes. Read-only: creates no data.
set -Eeuo pipefail

BASE_URL="${1:?usage: smoke-production.sh <base-url> [expected-release]}"
EXPECTED_RELEASE="${2:-}"
BASE_URL="${BASE_URL%/}"
CURL=(curl --silent --show-error --max-time 15 --retry 2 --retry-delay 2)
failures=0

pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1" >&2; failures=$((failures + 1)); }

echo "KVARD smoke test: $BASE_URL"

health="$("${CURL[@]}" "$BASE_URL/api/health" || true)"
if [[ "$health" == *'"status":"ok"'* && "$health" == *'"database":{"ok":true'* ]]; then
  pass "API healthy, PostgreSQL reachable"
else
  fail "health: expected status ok and database ok, got: ${health:0:300}"
fi

build_info="$("${CURL[@]}" "$BASE_URL/api/build-info" || true)"
release="$(printf '%s' "$build_info" | sed -n 's/.*"release":"\([^"]*\)".*/\1/p')"
if [[ -z "$release" ]]; then
  fail "build-info: no release in response: ${build_info:0:200}"
elif [[ -n "$EXPECTED_RELEASE" && "$release" != "$EXPECTED_RELEASE" ]]; then
  fail "release: expected $EXPECTED_RELEASE, running $release"
else
  pass "release $release"
fi

index_headers="$(mktemp)"
index_body="$("${CURL[@]}" --dump-header "$index_headers" "$BASE_URL/" || true)"
if [[ "$index_body" == *'<div id="root">'* ]]; then
  pass "web app served"
else
  fail "web app: / did not return the SPA"
fi
for header in "strict-transport-security" "x-content-type-options: nosniff" "x-frame-options: sameorigin"; do
  if grep -qi "^$header" "$index_headers"; then
    pass "header ${header%%:*}"
  else
    fail "missing security header: $header"
  fi
done
if grep -qi '^cache-control:.*no-store' "$index_headers"; then
  pass "index.html is not cached"
else
  fail "index.html must be served with Cache-Control: no-store"
fi
rm -f "$index_headers"

protected_status="$("${CURL[@]}" --output /dev/null --write-out '%{http_code}' "$BASE_URL/api/projects" || true)"
if [[ "$protected_status" == "401" ]]; then
  pass "protected API requires a session (401)"
else
  fail "protected API: expected 401 without a session, got $protected_status"
fi

test_hook_status="$("${CURL[@]}" --output /dev/null --write-out '%{http_code}' "$BASE_URL/api/test/agent-failures" || true)"
if [[ "$test_hook_status" == "404" ]]; then
  pass "test-only endpoints are not exposed"
else
  fail "test endpoint /api/test/agent-failures answered $test_hook_status (must be 404 in production)"
fi

if (( failures > 0 )); then
  echo "Smoke test FAILED: $failures check(s)." >&2
  exit 1
fi
echo "Smoke test passed."
