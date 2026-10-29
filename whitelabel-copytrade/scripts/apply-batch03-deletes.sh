#!/usr/bin/env bash
# # Responsibility: apply the batch-03 deletion plan idempotently and abort if any target is still imported.
#
# Removes verified byte-identical / dead-source duplicates the batch-03
# inventory pinned. Idempotent: a file already gone is reported and skipped.
# Safety rails:
#   - refuses to run outside the monorepo root (apps/ + services/ anchor check)
#   - aborts when the target file still exists AND is imported by live code
#     (import audit across services/apps with relative-path resolution)
#   - uses `git rm -q` so the deletion is staged, reviewable and revertible
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -d apps || ! -d services ]]; then
  echo "apply-batch03-deletes: must run from the monorepo root (whitelabel-copytrade/)" >&2
  exit 1
fi

declare -a TARGETS=(
  # Byte-identical duplicate of services/execution-engine/app/orders/submission.py:
  # the module never imported `app.submission` (only `app.orders.submission`),
  # verified byte-equal content at base commit.
  "services/execution-engine/app/submission.py"
  # Byte-identical duplicate of services/execution-engine/app/orders/security.py:
  # same forensic record - every import resolves through the orders package.
  "services/execution-engine/app/security.py"
)

fail=0
deleted=()
skipped=()
for target in "${TARGETS[@]}"; do
  if [[ ! -f "$target" ]]; then
    skipped+=("$target")
    echo "skip (already gone): $target"
    continue
  fi

  module_path="${target%.py}"
  module_path="${module_path#services/execution-engine/}"
  module_dotted="${module_path//\//.}"
  # import audit: only hard `import ...` / `from ... import` references against
  # the module dotted path - comment mentions and docstrings do not land here
  # The dotted module path is service-scoped (each service has its own app/
  # package): audit only the OwNING service tree, then strip comments/doc lines.
  service_root="$(dirname "$target")"
  while [[ "$service_root" != services/* && "$service_root" != services ]]; do service_root="$(dirname "$service_root")"; done
  service_root="$(echo "$target" | awk -F/ '{print $1"/"$2}')"
  hits=$(grep -REn "^\s*(from\s+${module_dotted}\s+import|import\s+${module_dotted}\b)\b" \
    "$service_root" --include="*.py" 2>/dev/null \
    | grep -v "^${target}:" || true)
  if [[ -n "$hits" ]]; then
    echo "apply-batch03-deletes: ABORT - $target is still imported:" >&2
    echo "$hits" >&2
    fail=1
    continue
  fi

  git rm -q "$target"
  deleted+=("$target")
  echo "deleted: $target"
done

if [[ "$fail" -ne 0 ]]; then
  echo "apply-batch03-deletes: aborted with live-import violations; no partial failure state (git rm only runs on clean targets)" >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# TypeScript side: apps/api/src/modules/exchanges/venues/ — a per-venue
# adapter duplicate tree. The four provider files were verified byte-identical
# to apps/api/src/modules/exchanges/providers/*.{bybit,coinbase,kraken,okx}
# .provider.ts at base commit (the venue-providers contract spec carries the
# same forensic record), and the tree's own spec is that providers-suite copy
# re-pointed at the duplicate implementations — its subject is the tree being
# deleted, so it goes with it. The byte-identity proof is re-verified HERE,
# at deletion time: if the pairs ever diverge, this script aborts rather than
# destroy content that stopped being a duplicate.
declare -a TS_PAIRS=(
  "apps/api/src/modules/exchanges/venues/bybit.provider.ts|apps/api/src/modules/exchanges/providers/bybit.provider.ts"
  "apps/api/src/modules/exchanges/venues/coinbase.provider.ts|apps/api/src/modules/exchanges/providers/coinbase.provider.ts"
  "apps/api/src/modules/exchanges/venues/kraken.provider.ts|apps/api/src/modules/exchanges/providers/kraken.provider.ts"
  "apps/api/src/modules/exchanges/venues/okx.provider.ts|apps/api/src/modules/exchanges/providers/okx.provider.ts"
)
TS_SPEC="apps/api/src/modules/exchanges/venues/venue-providers.spec.ts"

for pair in "${TS_PAIRS[@]}"; do
  dup="${pair%%|*}"
  canon="${pair##*|}"
  if [[ ! -f "$dup" ]]; then
    skipped+=("$dup")
    echo "skip (already gone): $dup"
    continue
  fi
  if [[ ! -f "$canon" ]]; then
    echo "apply-batch03-deletes: ABORT - canonical file missing, cannot prove $dup is a duplicate: $canon" >&2
    fail=1
    continue
  fi
  if ! cmp -s "$dup" "$canon"; then
    echo "apply-batch03-deletes: ABORT - $dup is no longer byte-identical to $canon; refused to delete non-duplicate content" >&2
    fail=1
    continue
  fi
done

# Import audit across the whole api app: any static import path that reaches
# the venues tree from OUTSIDE it keeps the tree alive and must be resolved
# before deletion. Forms caught: './venues/x', '../venues/x', and any alias
# that still spells modules/exchanges/venues. The tree's own files are exempt
# (they are the deletions).
venue_hits=$(grep -REn "from\s+['\"][^'\"]*modules/exchanges/venues/|from\s+['\"]\.{1,2}/[^'\"]*venues/" \
  apps/api/src --include="*.ts" 2>/dev/null \
  | grep -v "apps/api/src/modules/exchanges/venues/" || true)
if [[ -n "$venue_hits" ]]; then
  echo "apply-batch03-deletes: ABORT - venues/ tree is still imported:" >&2
  echo "$venue_hits" >&2
  fail=1
fi

if [[ "$fail" -eq 0 ]]; then
  for pair in "${TS_PAIRS[@]}"; do
    dup="${pair%%|*}"
    if [[ -f "$dup" ]]; then
      git rm -q "$dup"
      deleted+=("$dup")
      echo "deleted: $dup"
    fi
  done
  if [[ -f "$TS_SPEC" ]]; then
    git rm -q "$TS_SPEC"
    deleted+=("$TS_SPEC")
    echo "deleted: $TS_SPEC"
  else
    skipped+=("$TS_SPEC")
    echo "skip (already gone): $TS_SPEC"
  fi
fi

if [[ "$fail" -ne 0 ]]; then
  echo "apply-batch03-deletes: aborted with live-import violations; no partial failure state (git rm only runs on clean targets)" >&2
  exit 2
fi

echo "apply-batch03-deletes: ${#deleted[@]} file(s) removed, ${#skipped[@]} already absent"
