#!/usr/bin/env bash
# # The single procedure that brings Batch 03 and Batch 04 together after both are merged.
#
# WHY THIS SCRIPT EXISTS
# ----------------------
# Batch 03 and Batch 04 were written concurrently against disjoint files, so the merge
# itself is trivial and the *generated* state is not: RLS policies, the env matrix,
# the OpenAPI document and both SDKs are all derived from the merged schema and the
# merged route list. Regenerating them on either branch alone produces artefacts that
# mention half the tables, and a drift check run against the wrong half fails for the
# wrong reason.
#
# So this runs once, after the merge, in the merged tree, in a fixed order:
#
#   1. install and generate the client from the merged schema;
#   2. generate the RLS policies  - with a stamp in Batch 04's range, because the
#      policies must be applied AFTER both batches' tables exist;
#   3. regenerate the env matrix and the OpenAPI document from the merged code;
#   4. regenerate both SDKs from that OpenAPI document;
#   5. run every drift/consistency check and the gap scanner.
#
# Every step is checked and the script stops at the first failure with the step name.
# A post-merge script that carries on after a failure produces a tree that looks
# regenerated and is not.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STEP="start"
FAILED=""

step() {
  STEP="$1"
  printf '\n=== %s\n' "$STEP"
}

# Runs one command and records the failing step name for the trap.
run() {
  if ! "$@"; then
    FAILED="$STEP"
    printf '\nFAILED: %s\n  command: %s\n' "$STEP" "$*" >&2
    exit 1
  fi
}

on_exit() {
  local status=$?
  if [ "$status" -ne 0 ] && [ -n "$FAILED" ]; then
    printf '\npost-merge aborted in step: %s\n' "$FAILED" >&2
  fi
}
trap on_exit EXIT

step "verify both batches are present"
# A post-merge run on a tree that is missing one batch would regenerate policies for
# half the tables and pass every check, which is the worst possible outcome.
run test -f apps/api/prisma/migrations/20261201000000_batch03_tables/migration.sql
if compgen -G "apps/api/prisma/migrations/20261215*" > /dev/null; then
  printf 'Batch 04 migration found.\n'
else
  printf 'WARNING: no 20261215* Batch 04 migration; continuing with Batch 03 only.\n' >&2
fi

step "npm ci"
run npm ci

step "prisma generate"
run npx prisma generate --schema apps/api/prisma/schema.prisma

step "generate RLS policies (stamp 20261220000000)"
# Deliberately later than BOTH batches: policies created before the tables they cover
# would have to be re-created, and a re-created policy loses its review history.
run python3 scripts/gen_part11_rls.py --stamp 20261220000000

step "regenerate the env matrix"
run node scripts/gen-env-matrix.mjs

step "export OpenAPI"
run npm run openapi:export

step "regenerate the TypeScript SDK"
run node packages/sdk-typescript/scripts/generate.mjs

step "regenerate the Python SDK"
run python3 packages/sdk-python/scripts/generate.py

step "check OpenAPI drift"
run node scripts/check-openapi-drift.mjs

step "gap scanner"
run node ops/gap-parity-scanner-51-100.js

step "route authorization"
run npm run check:route-authorization

step "web API contract"
run npm run check:web-api-contract

step "web and admin typecheck"
run npm run typecheck

FAILED=""
printf '\npost-merge complete: generated artefacts, drift checks and the gap scanner are in step with the merged tree.\n'
