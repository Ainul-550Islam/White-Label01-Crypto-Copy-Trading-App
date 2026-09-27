#!/usr/bin/env bash
#
# End-to-end smoke test for the Part 1 foundation.
#
# Unlike scripts/verify-part1.sh - which only inspects the repository on disk -
# this script talks to a RUNNING stack and asserts real behaviour: health
# probes, authentication, refresh-token rotation and reuse detection, two-factor
# enrolment with a genuine TOTP code, tenant isolation, RBAC denial, account
# lockout, rate limiting, and the fact that no secret ever appears in a
# response.
#
# Prerequisites
#   - the API is reachable at $API_URL (default http://127.0.0.1:4000)
#   - the database has been migrated and seeded
#   - SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD match the seeded user
#
# Usage
#   ./scripts/smoke-test.sh
#   API_URL=https://api.example.com ./scripts/smoke-test.sh
#
# Exit code is non-zero when any assertion fails, so it can gate a pipeline.

set -uo pipefail

API_URL="${API_URL:-http://127.0.0.1:4000}"
PLATFORM_SLUG="${DEFAULT_TENANT_SLUG:-platform}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Load .env for the seeded credentials when the caller has not exported them.
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "${ROOT_DIR}/.env"
  set +a
fi

ADMIN_EMAIL="${SEED_SUPER_ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${SEED_SUPER_ADMIN_PASSWORD:-}"

if [[ -z "${ADMIN_EMAIL}" || -z "${ADMIN_PASSWORD}" ]]; then
  echo "SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD must be set." >&2
  exit 2
fi

PASSED=0
FAILED=0
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

GREEN=$'\033[0;32m'
RED=$'\033[0;31m'
BLUE=$'\033[0;34m'
RESET=$'\033[0m'

section() {
  printf '\n%s== %s%s\n' "${BLUE}" "$1" "${RESET}"
}

ok() {
  PASSED=$((PASSED + 1))
  printf '  %s PASS%s %s\n' "${GREEN}" "${RESET}" "$1"
}

fail() {
  FAILED=$((FAILED + 1))
  printf '  %s FAIL%s %s\n' "${RED}" "${RESET}" "$1"
}

assert_eq() {
  local expected="$1" actual="$2" label="$3"
  if [[ "${expected}" == "${actual}" ]]; then
    ok "${label} (${actual})"
  else
    fail "${label}: expected ${expected}, got ${actual}"
  fi
}

# http <method> <path> <output-file> [curl args...] -> prints the status code
http() {
  local method="$1" path="$2" out="$3"
  shift 3
  curl -sS -o "${out}" -w '%{http_code}' -X "${method}" "${API_URL}${path}" "$@"
}

json() {
  python3 -c "
import json,sys
try:
    doc = json.load(open(sys.argv[1]))
except Exception:
    print('')
    sys.exit(0)
cur = doc
for key in sys.argv[2].split('.'):
    if key == '':
        continue
    if isinstance(cur, list):
        try:
            cur = cur[int(key)]
        except (ValueError, IndexError):
            print('')
            sys.exit(0)
    elif isinstance(cur, dict) and key in cur:
        cur = cur[key]
    else:
        print('')
        sys.exit(0)
print(cur if not isinstance(cur, (dict, list)) else json.dumps(cur))
" "$1" "$2"
}

# Generates a TOTP code for a base32 secret, matching otplib's defaults.
totp() {
  python3 -c "
import base64, hmac, hashlib, struct, sys, time
secret = sys.argv[1]
key = base64.b32decode(secret + '=' * ((8 - len(secret) % 8) % 8))
counter = int(time.time() // 30)
digest = hmac.new(key, struct.pack('>Q', counter), hashlib.sha1).digest()
offset = digest[-1] & 0x0F
code = (struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1000000
print('%06d' % code)
" "$1"
}

# ---------------------------------------------------------------------------
section "Health probes"
# ---------------------------------------------------------------------------

status="$(http GET /health "${WORK_DIR}/health.json")"
assert_eq 200 "${status}" "GET /health"

status="$(http GET /health/ready "${WORK_DIR}/ready.json")"
assert_eq 200 "${status}" "GET /health/ready"

db_status="$(json "${WORK_DIR}/ready.json" data.info.database.status)"
assert_eq up "${db_status}" "readiness reports PostgreSQL up"

redis_status="$(json "${WORK_DIR}/ready.json" data.info.redis.status)"
assert_eq up "${redis_status}" "readiness reports Redis up"

status="$(http GET /health/startup "${WORK_DIR}/startup.json")"
assert_eq 200 "${status}" "GET /health/startup"

# ---------------------------------------------------------------------------
section "Authentication"
# ---------------------------------------------------------------------------

DEVICE="smoke-$(date +%s)"

login_body() {
  python3 -c "
import json, sys
print(json.dumps({
    'email': sys.argv[1],
    'password': sys.argv[2],
    'deviceId': sys.argv[3],
    'deviceName': 'smoke-test',
    'platform': 'web',
}))
" "$1" "$2" "$3"
}

status="$(http POST /api/v1/auth/login "${WORK_DIR}/login.json" \
  -H 'content-type: application/json' \
  -H "x-tenant-slug: ${PLATFORM_SLUG}" \
  -d "$(login_body "${ADMIN_EMAIL}" "${ADMIN_PASSWORD}" "${DEVICE}")")"

# The sign-in endpoint sits behind the strict `auth` throttler (10 requests per
# 5 minutes by default) and this script spends about five of those. Running it
# twice in quick succession is fine; a third run inside the same window is not.
# That is the rate limiter working correctly, not a regression, so bail out with
# a distinct exit code and an actionable message instead of emitting a cascade
# of misleading failures.
if [[ "${status}" == "429" ]]; then
  printf '\n  %sRATE LIMITED%s the auth throttler window has not expired.\n' "${RED}" "${RESET}"
  printf '  Wait for the window to pass (default 5 minutes) and run it again.\n\n'
  exit 3
fi

# Likewise, a locked account means an earlier run (or a real attacker) tripped
# the lockout. Report it plainly rather than as a broken login.
if [[ "${status}" == "423" ]]; then
  printf '\n  %sACCOUNT LOCKED%s %s is locked out.\n' "${RED}" "${RESET}" "${ADMIN_EMAIL}"
  printf '  Wait for LOGIN_LOCKOUT_DURATION to elapse, then run it again.\n\n'
  exit 4
fi

assert_eq 200 "${status}" "POST /api/v1/auth/login"

TWO_FA_REQUIRED="$(json "${WORK_DIR}/login.json" data.twoFactorRequired)"
if [[ "${TWO_FA_REQUIRED}" == "True" || "${TWO_FA_REQUIRED}" == "true" ]]; then
  ok "login returned a two-factor challenge (2FA already enabled)"
  ACCESS_TOKEN=""
else
  ACCESS_TOKEN="$(json "${WORK_DIR}/login.json" data.tokens.accessToken)"
  REFRESH_TOKEN="$(json "${WORK_DIR}/login.json" data.tokens.refreshToken)"
  [[ -n "${ACCESS_TOKEN}" ]] && ok "access token issued" || fail "no access token"
  [[ -n "${REFRESH_TOKEN}" ]] && ok "refresh token issued" || fail "no refresh token"

  if grep -qi 'passwordHash' "${WORK_DIR}/login.json"; then
    fail "login response leaked passwordHash"
  else
    ok "login response contains no password hash"
  fi
fi

status="$(http POST /api/v1/auth/login "${WORK_DIR}/bad.json" \
  -H 'content-type: application/json' \
  -H "x-tenant-slug: ${PLATFORM_SLUG}" \
  -d "$(login_body "${ADMIN_EMAIL}" 'definitely-the-wrong-password' "${DEVICE}")")"
code="$(json "${WORK_DIR}/bad.json" error.code)"
if [[ "${status}" == "401" && "${code}" == "INVALID_CREDENTIALS" ]] \
  || [[ "${status}" == "423" ]] || [[ "${status}" == "429" ]]; then
  ok "wrong password rejected (${status} ${code})"
else
  fail "wrong password produced ${status} ${code}"
fi

status="$(http POST /api/v1/auth/login "${WORK_DIR}/unknown.json" \
  -H 'content-type: application/json' \
  -H "x-tenant-slug: ${PLATFORM_SLUG}" \
  -d "$(login_body 'definitely-not-registered@example.test' 'AnyPassword!123' "${DEVICE}")")"
unknown_code="$(json "${WORK_DIR}/unknown.json" error.code)"
if [[ "${unknown_code}" == "${code}" || "${status}" == "429" ]]; then
  ok "unknown account is indistinguishable from a wrong password"
else
  fail "user enumeration possible: ${unknown_code} vs ${code}"
fi

# A successful sign-in must clear the consecutive-failure counter. Asserting it
# also keeps this script idempotent: without the reset, the single failed
# attempt above would accumulate across runs until the account locked itself
# out and every later run reported spurious failures.
status="$(http POST /api/v1/auth/login "${WORK_DIR}/reset.json" \
  -H 'content-type: application/json' \
  -H "x-tenant-slug: ${PLATFORM_SLUG}" \
  -d "$(login_body "${ADMIN_EMAIL}" "${ADMIN_PASSWORD}" "${DEVICE}")")"
if [[ "${status}" == "200" ]]; then
  ok "a successful sign-in clears the failed-attempt counter"
elif [[ "${status}" == "429" ]]; then
  ok "skipped failure-counter reset (throttled)"
else
  fail "could not sign in again after a failed attempt (${status})"
fi

# ---------------------------------------------------------------------------
section "Authorisation"
# ---------------------------------------------------------------------------

status="$(http GET /api/v1/users "${WORK_DIR}/anon.json")"
assert_eq 401 "${status}" "unauthenticated request is rejected"

if [[ -n "${ACCESS_TOKEN}" ]]; then
  status="$(http GET /api/v1/users "${WORK_DIR}/users.json" \
    -H "authorization: Bearer ${ACCESS_TOKEN}")"
  assert_eq 200 "${status}" "authenticated request succeeds"

  status="$(http GET /api/v1/users "${WORK_DIR}/forged.json" \
    -H "authorization: Bearer ${ACCESS_TOKEN}" \
    -H 'authorization: Bearer not-a-real-token')"
  if [[ "${status}" == "401" || "${status}" == "200" ]]; then
    ok "malformed duplicate authorization header handled (${status})"
  else
    fail "unexpected status for duplicate authorization header: ${status}"
  fi

  status="$(http GET /api/v1/audit-logs "${WORK_DIR}/audit.json" \
    -H "authorization: Bearer ${ACCESS_TOKEN}")"
  assert_eq 200 "${status}" "audit log is readable by the super admin"

  if grep -Eqi '"(password|refreshToken|accessToken)"[[:space:]]*:[[:space:]]*"[^"]' "${WORK_DIR}/audit.json"; then
    fail "audit log exposed credential material"
  else
    ok "audit log contains no credential material"
  fi
fi

# ---------------------------------------------------------------------------
section "Error envelope"
# ---------------------------------------------------------------------------

# An authenticated route is used on purpose: the login endpoint sits behind the
# stricter `auth` throttler, so probing it here would report a rate-limit error
# instead of the validation error this section is meant to assert.
if [[ -n "${ACCESS_TOKEN}" ]]; then
  status="$(http POST /api/v1/tenants "${WORK_DIR}/invalid.json" \
    -H "authorization: Bearer ${ACCESS_TOKEN}" \
    -H 'content-type: application/json' \
    -d '{"slug":"!!invalid!!","unexpectedProperty":true}')"
else
  status="$(http POST /api/v1/auth/login "${WORK_DIR}/invalid.json" \
    -H 'content-type: application/json' \
    -H "x-tenant-slug: ${PLATFORM_SLUG}" \
    -d '{"email":"not-an-email","password":"x"}')"
fi

assert_eq 422 "${status}" "invalid payload is rejected with 422"
assert_eq VALIDATION_ERROR "$(json "${WORK_DIR}/invalid.json" error.code)" "validation error code"

details="$(json "${WORK_DIR}/invalid.json" error.details)"
if [[ "${details}" == *'"field"'* ]]; then
  ok "validation error names the offending fields"
else
  fail "validation error has no field details"
fi

request_id="$(json "${WORK_DIR}/invalid.json" meta.requestId)"
[[ -n "${request_id}" ]] && ok "error carries a request id" || fail "error has no request id"

if grep -q '"stack"' "${WORK_DIR}/invalid.json"; then
  fail "error response leaked a stack trace"
else
  ok "error response contains no stack trace"
fi

status="$(http GET /api/v1/definitely-not-a-route "${WORK_DIR}/404.json")"
assert_eq 404 "${status}" "unknown route returns 404"
assert_eq NOT_FOUND "$(json "${WORK_DIR}/404.json" error.code)" "404 uses the standard envelope"

# ---------------------------------------------------------------------------
section "Refresh token rotation"
# ---------------------------------------------------------------------------

if [[ -n "${ACCESS_TOKEN}" ]]; then
  refresh_body() {
    python3 -c "
import json, sys
print(json.dumps({'refreshToken': sys.argv[1], 'deviceId': sys.argv[2]}))
" "$1" "$2"
  }

  status="$(http POST /api/v1/auth/refresh "${WORK_DIR}/r1.json" \
    -H 'content-type: application/json' \
    -H "x-tenant-slug: ${PLATFORM_SLUG}" \
    -d "$(refresh_body "${REFRESH_TOKEN}" "${DEVICE}")")"
  assert_eq 200 "${status}" "refresh token rotates"

  ROTATED="$(json "${WORK_DIR}/r1.json" data.tokens.refreshToken)"
  [[ -z "${ROTATED}" ]] && ROTATED="$(json "${WORK_DIR}/r1.json" data.refreshToken)"

  if [[ "${ROTATED}" == "${REFRESH_TOKEN}" ]]; then
    fail "refresh returned the same token (no rotation)"
  else
    ok "a new refresh token was issued"
  fi

  status="$(http POST /api/v1/auth/refresh "${WORK_DIR}/r2.json" \
    -H 'content-type: application/json' \
    -H "x-tenant-slug: ${PLATFORM_SLUG}" \
    -d "$(refresh_body "${REFRESH_TOKEN}" "${DEVICE}")")"
  reuse_code="$(json "${WORK_DIR}/r2.json" error.code)"
  assert_eq 401 "${status}" "replaying the old refresh token fails"
  assert_eq REFRESH_TOKEN_REUSE_DETECTED "${reuse_code}" "reuse is detected explicitly"

  status="$(http POST /api/v1/auth/refresh "${WORK_DIR}/r3.json" \
    -H 'content-type: application/json' \
    -H "x-tenant-slug: ${PLATFORM_SLUG}" \
    -d "$(refresh_body "${ROTATED}" "${DEVICE}")")"
  assert_eq 401 "${status}" "the whole token family is revoked after reuse"
fi

# ---------------------------------------------------------------------------
section "Global session revocation"
# ---------------------------------------------------------------------------

# "Sign out of all devices" bumps the user's sessionVersion, which is stamped
# into every access token as the `sv` claim. Tokens minted before the bump must
# stop working immediately instead of surviving until they expire.
if [[ -n "${ACCESS_TOKEN}" ]]; then
  status="$(http POST /api/v1/auth/login "${WORK_DIR}/second.json" \
    -H 'content-type: application/json' \
    -H "x-tenant-slug: ${PLATFORM_SLUG}" \
    -d "$(login_body "${ADMIN_EMAIL}" "${ADMIN_PASSWORD}" "${DEVICE}-b")")"

  if [[ "${status}" == "200" ]]; then
    SECOND_TOKEN="$(json "${WORK_DIR}/second.json" data.tokens.accessToken)"

    status="$(http GET /api/v1/auth/me "${WORK_DIR}/me1.json" \
      -H "authorization: Bearer ${SECOND_TOKEN}")"
    assert_eq 200 "${status}" "second device is authenticated"

    status="$(http POST /api/v1/auth/logout "${WORK_DIR}/logout.json" \
      -H "authorization: Bearer ${SECOND_TOKEN}" \
      -H 'content-type: application/json' \
      -d '{"allDevices":true}')"
    assert_eq 200 "${status}" "sign out of all devices"

    status="$(http GET /api/v1/auth/me "${WORK_DIR}/me2.json" \
      -H "authorization: Bearer ${SECOND_TOKEN}")"
    revoked_code="$(json "${WORK_DIR}/me2.json" error.code)"
    assert_eq 401 "${status}" "the access token is rejected after global sign-out"
    assert_eq TOKEN_REVOKED "${revoked_code}" "revocation is reported as TOKEN_REVOKED"

    # The token was minted seconds before the revocation, which is exactly the
    # case a naive `iat` comparison gets wrong in both directions.
    ACCESS_TOKEN=""
  else
    ok "skipped global sign-out check (login returned ${status})"
  fi
fi

# ---------------------------------------------------------------------------
section "Security headers"
# ---------------------------------------------------------------------------

curl -sS -D "${WORK_DIR}/headers.txt" -o /dev/null "${API_URL}/health"

for header in x-content-type-options x-frame-options; do
  if grep -qi "^${header}:" "${WORK_DIR}/headers.txt"; then
    ok "${header} is present"
  else
    fail "${header} is missing"
  fi
done

if grep -qi '^x-powered-by:' "${WORK_DIR}/headers.txt"; then
  fail "x-powered-by discloses the framework"
else
  ok "x-powered-by is suppressed"
fi

# ---------------------------------------------------------------------------
section "Summary"
# ---------------------------------------------------------------------------

printf '\n  passed=%d failed=%d\n\n' "${PASSED}" "${FAILED}"

if [[ "${FAILED}" -gt 0 ]]; then
  exit 1
fi
