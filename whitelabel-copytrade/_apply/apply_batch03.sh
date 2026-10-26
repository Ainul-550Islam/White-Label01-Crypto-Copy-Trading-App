#!/usr/bin/env bash
# # Applies Batch 03 to a clean checkout: removes the files the batch deletes, then applies its shared-file patches.
#
# WHY DELETIONS NEED A SCRIPT
# ---------------------------
# A zip cannot express a deletion. The batch removes duplicate venue providers, the
# dead admin-web middleware, a placeholder vite config and a BUILD_VALIDATION.md that
# claimed PASSING without being produced by any command. Shipping the new tree over
# the old one would leave all of them in place, and a duplicate provider file is
# exactly the kind of thing that keeps compiling while the wrong copy is imported.
#
# ORDER MATTERS
# -------------
# 1. `git rm` the deleted paths. Any importer was repointed in the batch's own files,
#    which the zip has already overwritten by the time this runs.
# 2. `git apply --3way` every `_apply/*.batch03.patch`. `--3way` is deliberate: these
#    patches touch shared files that Batch 04 also edits, and a three-way merge turns
#    an overlapping hunk into a conflict to review instead of a silent overwrite.
#
# Run from the repository root (the directory that contains `whitelabel-copytrade/`).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECT="whitelabel-copytrade"
if [ ! -d "$PROJECT" ]; then
  printf 'Expected the project at %s/%s. Run this from the repository root.\n' "$ROOT" "$PROJECT" >&2
  exit 1
fi

if ! git -C "$ROOT" rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  printf 'Not a git work tree; deletions and three-way applies need git.\n' >&2
  exit 1
fi

printf '=== removing files Batch 03 deletes\n'
deleted_paths=(
  "$PROJECT/apps/admin-web/src/middleware.ts"
  "$PROJECT/apps/api/src/modules/exchanges/venues/bybit.provider.ts"
  "$PROJECT/apps/api/src/modules/exchanges/venues/okx.provider.ts"
  "$PROJECT/apps/api/src/modules/exchanges/venues/kraken.provider.ts"
  "$PROJECT/apps/api/src/modules/exchanges/venues/coinbase.provider.ts"
  "$PROJECT/apps/api/src/modules/exchanges/venues/venue-providers.spec.ts"
  "$PROJECT/apps/api/src/modules/exchanges/providers/exchange-provider.factory.ts"
  "$PROJECT/apps/api/src/modules/auth/step-up/step-up.service.ts"
  "$PROJECT/apps/api/src/modules/auth/step-up/step-up.service.spec.ts"
  "$PROJECT/apps/api/src/modules/auth/step-up/step-up.controller.ts"
  "$PROJECT/apps/api/src/modules/auth/step-up/step-up.controller.spec.ts"
  "$PROJECT/apps/api/src/modules/auth/step-up/step-up.module.ts"
  "$PROJECT/apps/api/src/modules/auth/step-up/dto/verify-step-up.dto.ts"
  "$PROJECT/apps/web/vite.config.ts"
  "$PROJECT/apps/web/BUILD_VALIDATION.md"
)

for path in "${deleted_paths[@]}"; do
  if git -C "$ROOT" ls-files --error-unmatch "$path" > /dev/null 2>&1; then
    git -C "$ROOT" rm -f --quiet "$path"
    printf '  removed %s\n' "$path"
  elif [ -e "$ROOT/$path" ]; then
    # Tracked in the index but not in HEAD (already-staged addition), or ignored.
    rm -f "$ROOT/$path"
    printf '  deleted (untracked) %s\n' "$path"
  else
    printf '  already absent %s\n' "$path"
  fi
done

# The step-up directory is left in place if anything else still lives in it; an empty
# directory is harmless but a silently-missing sibling would not be.
if [ -d "$ROOT/$PROJECT/apps/api/src/modules/auth/step-up" ]; then
  remaining=$(find "$ROOT/$PROJECT/apps/api/src/modules/auth/step-up" -type f | wc -l | tr -d ' ')
  printf '  auth/step-up still holds %s file(s) (the guard and its decorator stay)\n' "$remaining"
fi

printf '\n=== applying shared-file patches\n'
shopt -s nullglob
patches=("$PROJECT"/_apply/*.batch03.patch)
if [ ${#patches[@]} -eq 0 ]; then
  printf 'No patches found under %s/_apply.\n' "$PROJECT"
  exit 0
fi

for patch in "${patches[@]}"; do
  printf '  git apply --3way %s\n' "$patch"
  if ! git -C "$ROOT" apply --3way "$patch"; then
    printf '\nFAILED to apply %s.\nResolve the conflict by hand, then re-run the remaining steps:\n' "$patch" >&2
    printf '  npx prisma generate --schema %s/apps/api/prisma/schema.prisma\n' "$PROJECT" >&2
    printf '  npm run check:api-di\n' >&2
    exit 1
  fi
done

printf '\nApplied. Next:\n'
printf '  npm ci\n'
printf '  npx prisma generate --schema %s/apps/api/prisma/schema.prisma\n' "$PROJECT"
printf '  npx prisma migrate deploy   # applies 20261201000000_batch03_tables\n'
printf '  npm run check:api-di && npm run check:route-authorization && npm run check:web-api-contract\n'
printf '  node ops/gap-parity-scanner-51-100.js\n'
