#!/usr/bin/env bash
# Responsibility: removes the duplicated and superseded files Batch 05 deletes, idempotently, after proving nothing imports them — run it twice and the second run removes nothing and exits 0.
#
# THE PROBLEM THIS SCRIPT SOLVES
# ------------------------------
# Batch 02 and Batch 04 each shipped a delete script that was never applied on
# the published branch, so the tree still carries every file they were meant to
# remove. The copies are not inert:
#
#   1. apps/admin-web/src/middleware.ts ships beside src/proxy.ts. Next 16 accepts
#      exactly ONE request entrypoint per application and `next build` refuses an
#      app that has two ("both middleware and proxy files detected"). The
#      behaviour of the deleted module - public-path allowlist, login redirect
#      with its `?next=` destination, the /api/* exemption, the per-request CSP
#      nonce, the security headers and the matcher - now lives in proxy.ts and is
#      proven behaviour by behaviour in src/tests/entrypoint-proxy.test.ts.
#
#   2. apps/api/src/modules/exchanges/venues/ is a stale copy of providers/ with
#      the same four venue classes and neither `base-exchange-provider.ts` nor the
#      factory. Only providers/ is wired into ExchangeProviderFactory, so the
#      copies are unreachable - and a reader who opens the wrong directory edits a
#      provider the running application never loads.
#
#   3. apps/api/src/modules/auth/step-up/step-up.{controller,service,module}.ts,
#      their specs and dto/verify-step-up.dto.ts duplicate
#      auth/step-up-auth.{controller,service}.ts. StepUpModule is imported by no
#      module: the routes it declares do not exist in a running application while
#      its specs pass against hand-constructed instances. The guard
#      (step-up.guard.ts), the decorator and the single-use proofs issued by
#      StepUpAuthService stay: those ARE the live mechanism.
#
#   4. apps/api/src/modules/auth/account-recovery.adapters.ts is imported by no
#      file; account-recovery-runtime.module.ts wires the adapters it needs.
#
#   5. services/execution-engine/app/security.py, submission.py, placement.py,
#      credentials.py and secret_fetcher.py sit beside the modules that replaced
#      them (security/, orders/submission.py, orders/placement.py,
#      exchanges/credentials.py, security/secret_fetcher.py). Four of the five are
#      byte-identical or differ only in the docstring that already names the
#      canonical file, and none is imported. `app.security` also resolves to the
#      PACKAGE in Python, so the sibling security.py module can never be imported
#      at all: it is a file that exists and cannot run.
#
# WHY THE DELETES ARE GUARDED
# ---------------------------
# Deleting a file is only safe when nothing that runs still points at it. Before
# anything is removed this script greps every TypeScript, JavaScript, Python and
# workflow file under apps/, services/, libs/, packages/, tests/, ops/, scripts/
# and .github/ for an import of each candidate, and refuses - naming every
# importer - when one exists. A file that is still imported is repointed to its
# canonical file in the same batch; this guard is the proof that the repointing
# happened rather than a promise that it did.
#
# Two extra guards protect the pairs where "deleted" and "canonical" have to mean
# the same thing:
#   * the admin-web survivor must still carry every behaviour of the entrypoint
#     being deleted (allowlist, nonce, CSP, headers, `?next=`, matcher);
#   * each Python canonical module must exist and define the names the duplicate
#     defined, so a delete cannot leave `from app.orders.placement import X`
#     unsatisfied behind it.
#
# Usage: bash whitelabel-copytrade/_apply/apply_batch05_cleanup.sh
# Safe to run from the repository root or from whitelabel-copytrade/. A second
# run is a no-op.
set -euo pipefail

# Resolve the repository root from this script's own location so the command
# works from any working directory, including a freshly unzipped batch archive.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MONOREPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd -- "${MONOREPO_ROOT}/.." && pwd)"
cd "${REPO_ROOT}"

MONOREPO_NAME="$(basename "${MONOREPO_ROOT}")"
echo "apply-batch05-cleanup: repository root ${REPO_ROOT} (monorepo ${MONOREPO_NAME})"

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "apply-batch05-cleanup: ${REPO_ROOT} is not inside a git work tree; nothing to do." >&2
  exit 0
fi

# Repo-relative paths, resolved from the monorepo's own directory name so the
# script keeps working if the checkout is renamed.
MW="${MONOREPO_NAME}/apps/admin-web/src/middleware.ts"
PROXY="${MONOREPO_NAME}/apps/admin-web/src/proxy.ts"
ENGINE="${MONOREPO_NAME}/services/execution-engine"

# ---------------------------------------------------------------------------
# 1. The admin-web survivor must carry every behaviour of the file being deleted.
# ---------------------------------------------------------------------------
guard_proxy() {
  if [ ! -f "${PROXY}" ]; then
    echo "apply-batch05-cleanup: ${PROXY} is absent - refusing to remove ${MW}." >&2
    exit 1
  fi

  local missing=()
  need_fixed() {
    grep -qF -- "$1" "${PROXY}" || missing+=("$2 ($1)")
  }
  need_any() {
    grep -qE -- "$1" "${PROXY}" || missing+=("$2 ($1)")
  }

  need_any   "export (function|const) proxy"  "the entrypoint Next 16 calls"
  need_fixed "PUBLIC_PATHS"                   "the public-path allowlist"
  need_fixed "x-nonce"                        "the per-request CSP nonce forwarded to the render"
  need_fixed "Content-Security-Policy"        "the CSP header built from that nonce"
  need_fixed "X-Frame-Options"                "the static security headers"
  need_fixed "next="                          "the login redirect that keeps its destination"
  need_fixed "matcher"                        "the matcher that keeps static assets out"
  need_any   "startsWith\('/api/'\)|/api/\*"  "the /api/* exemption"

  if [ "${#missing[@]}" -gt 0 ]; then
    echo "apply-batch05-cleanup: ${PROXY} does not yet carry every behaviour of ${MW}; refusing to delete it." >&2
    printf '  missing: %s\n' "${missing[@]}" >&2
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# 2. Each Python canonical module must exist and define what the duplicate did.
# ---------------------------------------------------------------------------
guard_python_pair() {
  local duplicate="$1"
  local canonical="$2"
  local symbols="$3"

  if [ ! -f "${canonical}" ]; then
    echo "apply-batch05-cleanup: canonical ${canonical} is absent - refusing to remove ${duplicate}." >&2
    exit 1
  fi
  if [ -f "${duplicate}" ]; then
    local name
    for name in ${symbols}; do
      # A def, a class, or a module constant (`REVIEW_ENDPOINT_LABEL: Final[str]`).
      # `\b` is a GNU grep extension; `([^A-Za-z0-9_]|$)` is the POSIX spelling and
      # matches the same boundary.
      if ! grep -qE "(^|[[:space:]])(def|class)[[:space:]]+${name}([^A-Za-z0-9_]|$)|^${name}([[:space:]]*:|=)" "${canonical}"; then
        echo "apply-batch05-cleanup: ${canonical} does not define ${name} - refusing to remove ${duplicate}." >&2
        exit 1
      fi
    done
  fi
}

guard_python_pair \
  "${ENGINE}/app/security.py" \
  "${ENGINE}/app/security/internal_auth.py" \
  "require_internal_auth require_internal_auth_readonly"
guard_python_pair \
  "${ENGINE}/app/submission.py" \
  "${ENGINE}/app/orders/submission.py" \
  "prepare_submission record_submission"
guard_python_pair \
  "${ENGINE}/app/placement.py" \
  "${ENGINE}/app/orders/placement.py" \
  "PlacementWiring build_placement_reviewer review_placement REVIEW_ENDPOINT_LABEL"
guard_python_pair \
  "${ENGINE}/app/credentials.py" \
  "${ENGINE}/app/exchanges/credentials.py" \
  "CredentialWiring build_credential_provider"
guard_python_pair \
  "${ENGINE}/app/secret_fetcher.py" \
  "${ENGINE}/app/security/secret_fetcher.py" \
  "VaultKvConfig VaultKvSecretFetcher"

# ---------------------------------------------------------------------------
# 3. Nothing that runs may still import a candidate.
# ---------------------------------------------------------------------------
# `kind:path:specifier` - `kind` decides which grammar the specifier belongs to:
#   ts  a module specifier inside quotes, matched as a whole path segment tail
#       (`./venues/bybit.provider`, `@/modules/exchanges/venues/bybit.provider`);
#   py  an import statement whose dotted module is exactly this one, so
#       `import app.security` is a hit while `import app.security.internal_auth`
#       (the package) is not.
CANDIDATES=(
  "ts:${MONOREPO_NAME}/apps/admin-web/src/middleware.ts:middleware"
  "ts:${MONOREPO_NAME}/apps/api/src/modules/exchanges/venues/bybit.provider.ts:venues/bybit.provider"
  "ts:${MONOREPO_NAME}/apps/api/src/modules/exchanges/venues/coinbase.provider.ts:venues/coinbase.provider"
  "ts:${MONOREPO_NAME}/apps/api/src/modules/exchanges/venues/kraken.provider.ts:venues/kraken.provider"
  "ts:${MONOREPO_NAME}/apps/api/src/modules/exchanges/venues/okx.provider.ts:venues/okx.provider"
  "ts:${MONOREPO_NAME}/apps/api/src/modules/exchanges/venues/venue-providers.spec.ts:venues/venue-providers.spec"
  "ts:${MONOREPO_NAME}/apps/api/src/modules/auth/step-up/step-up.controller.ts:step-up/step-up.controller"
  "ts:${MONOREPO_NAME}/apps/api/src/modules/auth/step-up/step-up.service.ts:step-up/step-up.service"
  "ts:${MONOREPO_NAME}/apps/api/src/modules/auth/step-up/step-up.module.ts:step-up/step-up.module"
  "ts:${MONOREPO_NAME}/apps/api/src/modules/auth/step-up/step-up.controller.spec.ts:step-up/step-up.controller.spec"
  "ts:${MONOREPO_NAME}/apps/api/src/modules/auth/step-up/step-up.service.spec.ts:step-up/step-up.service.spec"
  "ts:${MONOREPO_NAME}/apps/api/src/modules/auth/step-up/dto/verify-step-up.dto.ts:verify-step-up.dto"
  "ts:${MONOREPO_NAME}/apps/api/src/modules/auth/account-recovery.adapters.ts:account-recovery.adapters"
  "py:${ENGINE}/app/security.py:app.security"
  "py:${ENGINE}/app/submission.py:app.submission"
  "py:${ENGINE}/app/placement.py:app.placement"
  "py:${ENGINE}/app/credentials.py:app.credentials"
  "py:${ENGINE}/app/secret_fetcher.py:app.secret_fetcher"
  # Batch 05 moved the mandatory-RLS fixture out of `apps/api/prisma/rls/`, a
  # directory the generator owns: a hand-written JSON file in it is the one file a
  # rerun neither overwrites nor notices, and `test_repo_reference_integrity.py`
  # asserts the directory holds exactly the four generated outputs. The fixture
  # itself is delivered at its new home by the ZIP; this removes the old copy.
  "json:${MONOREPO_NAME}/apps/api/prisma/rls/batch02_mandatory_rls.json:batch02_mandatory_rls"
)

# The roots a real importer can live in. `evidence/` and `docs/` talk ABOUT these
# files; they do not import them.
SEARCH_ROOTS=(
  "${MONOREPO_NAME}/apps"
  "${MONOREPO_NAME}/services"
  "${MONOREPO_NAME}/libs"
  "${MONOREPO_NAME}/packages"
  "${MONOREPO_NAME}/tests"
  "${MONOREPO_NAME}/ops"
  "${MONOREPO_NAME}/scripts"
  ".github"
)

is_python_candidate() { [ "$1" = "py" ]; }

# Every path this script itself may delete; an importer line inside one of them is
# not an importer, it is another copy on the same list.
is_candidate_path() {
  local needle="$1"
  local entry candidate
  for entry in "${CANDIDATES[@]}"; do
    IFS=':' read -r _ candidate _specifier <<< "${entry}"
    if [ "${candidate}" = "${needle}" ]; then
      return 0
    fi
  done
  return 1
}

IMPORT_GUARD_FAILURES=0

# The service a Python candidate belongs to: its `app` package is only importable
# from inside that service, and other services carry their own `app.security`,
# `app.credentials` and so on. Scanning the whole tree for a Python specifier would
# report four unrelated services as importers of one file.
service_root_of() {
  local path="$1"
  local rest="${path#*/}"
  printf '%s/%s/%s\n' "${MONOREPO_NAME}" "${rest%%/*}" "$(printf '%s' "${rest}" | cut -d/ -f2)"
}

check_importers() {
  local kind="$1"
  local candidate="$2"
  local specifier="$3"

  # An already-absent file has no importers to worry about.
  [ -f "${candidate}" ] || return 0

  local -a roots=()
  local root hits relative_stem line file
  if is_python_candidate "${kind}"; then
    roots=("$(service_root_of "${candidate}")")
  else
    roots=("${SEARCH_ROOTS[@]}")
  fi

  for root in "${roots[@]}"; do
    [ -d "${root}" ] || continue
    if is_python_candidate "${kind}"; then
      # The dotted module must END here. `from app.security import x` and
      # `import app.security` are hits; `from app.security.internal_auth import x`
      # is the canonical package and is not.
      local module_name="${specifier#app.}"
      hits="$(grep -rInE "^[[:space:]]*(from|import)[[:space:]]+(app\.)?${module_name}([[:space:]]|,|$)" \
        --include='*.py' "${root}" 2>/dev/null || true)"
      # `from .security import x` / `from ..security import x` inside the package.
      local relative_hits
      relative_hits="$(grep -rInE "^[[:space:]]*from[[:space:]]+\.+${module_name}[[:space:]]+import" \
        --include='*.py' "${root}" 2>/dev/null || true)"
      if [ -n "${relative_hits}" ]; then
        hits="$(printf '%s\n%s\n' "${hits}" "${relative_hits}" | grep -v '^[[:space:]]*$' || true)"
      fi
    else
      # A quoted module specifier whose TAIL is exactly this path: the segment
      # before it must be a `/` or the opening quote, so `request-context.middleware`
      # is not a reference to `middleware`, and `providers/bybit.provider` is not a
      # reference to `venues/bybit.provider`.
      hits="$(grep -rInE "(from|require\(|import\()[[:space:]]*['\"]([^'\"]*/)?${specifier}['\"]" \
        --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
        --include='*.mjs' --include='*.cjs' --include='*.yml' --include='*.yaml' \
        "${root}" 2>/dev/null || true)"
    fi

    [ -n "${hits}" ] || continue

    # Drop hits that come from other files on the delete list: they are copies
    # pointing at copies, and they leave together.
    local real_hits=""
    while IFS= read -r line; do
      [ -n "${line}" ] || continue
      file="${line%%:*}"
      if is_candidate_path "${file}"; then
        continue
      fi
      real_hits="${real_hits}${line}"$'\n'
    done <<< "${hits}"

    if [ -n "${real_hits}" ]; then
      echo "apply-batch05-cleanup: REFUSING to delete ${candidate}; it is still imported:" >&2
      printf '%s' "${real_hits}" | sed 's/^/    /' >&2
      IMPORT_GUARD_FAILURES=$((IMPORT_GUARD_FAILURES + 1))
      return 0
    fi
  done
}

for entry in "${CANDIDATES[@]}"; do
  IFS=':' read -r kind candidate specifier <<< "${entry}"
  check_importers "${kind}" "${candidate}" "${specifier}"
done

if [ "${IMPORT_GUARD_FAILURES}" -gt 0 ]; then
  echo "apply-batch05-cleanup: ${IMPORT_GUARD_FAILURES} candidate(s) are still imported; nothing was deleted." >&2
  echo "apply-batch05-cleanup: repoint each importer to the canonical file, re-run the checks, then re-run this script." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 4. Delete. Only when the survivor is whole.
# ---------------------------------------------------------------------------
if [ -e "${MW}" ] || git ls-files --error-unmatch -- "${MW}" >/dev/null 2>&1; then
  guard_proxy
fi

removed=0
skipped=0
for entry in "${CANDIDATES[@]}"; do
  IFS=':' read -r _kind candidate _specifier <<< "${entry}"
  if git ls-files --error-unmatch -- "${candidate}" >/dev/null 2>&1; then
    # --ignore-unmatch keeps a partially applied batch from aborting: a path that
    # left the index on an earlier run is a no-op, not an error.
    git rm -q --ignore-unmatch -- "${candidate}"
    echo "apply-batch05-cleanup: removed tracked file ${candidate}"
    removed=$((removed + 1))
    continue
  fi
  if [ -e "${candidate}" ]; then
    rm -f -- "${candidate}"
    echo "apply-batch05-cleanup: removed untracked file ${candidate}"
    removed=$((removed + 1))
    continue
  fi
  skipped=$((skipped + 1))
done

# Git does not track directories, but a leftover empty one keeps asking the
# question this batch exists to answer.
for empty_dir in \
  "${MONOREPO_NAME}/apps/api/src/modules/exchanges/venues" \
  "${MONOREPO_NAME}/apps/api/src/modules/auth/step-up/dto"; do
  if [ -d "${empty_dir}" ] && [ -z "$(ls -A "${empty_dir}" 2>/dev/null)" ]; then
    rmdir "${empty_dir}"
    echo "apply-batch05-cleanup: removed empty directory ${empty_dir}"
  fi
done

echo "apply-batch05-cleanup: ${removed} file(s) removed, ${skipped} already absent."
echo "apply-batch05-cleanup: done"
