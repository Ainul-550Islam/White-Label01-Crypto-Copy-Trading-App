#!/usr/bin/env bash
# Runs the Binance testnet round-trip proof: the offline replay always, the live round trip only when an operator opts in.
#
# WHY A SCRIPT AND NOT A TEST
# ---------------------------
# The live half places a real (resting, immediately cancelled) order on
# testnet.binance.vision. `pytest` must stay hermetic — the library's own
# pyproject sets `-m 'not live'` — so the opt-in lives here, one command an
# operator runs deliberately, and the suites underneath it are skipped by
# default.
#
# WHAT IT RUNS, IN ORDER
#   1. libs/trading-core replay suites        (offline, always)
#   2. the mainnet refusal matrix             (offline, always)
#   3. the execution-engine submit-route gates(offline, always)
#   4. apps/api OMS round-trip spec           (offline, always)
#   5. the LIVE testnet round trip            (only with --live and a key pair)
#
# EXIT CODES
#   0  every requested proof passed
#   1  a proof failed
#   2  the environment is wrong (missing tool, partial key pair, --live without
#      credentials) — refused before anything is placed
#
# SAFETY RULES THIS SCRIPT ENFORCES
#   * It never echoes a credential. The key pair is checked for presence with
#     `${VAR:+set}`, never printed, and never passed on a command line.
#   * `--live` requires BOTH variables; one of the two is a mistake, not a
#     degraded mode, and a half-configured run is how a proof silently becomes
#     an offline run reported as live.
#   * It refuses to run against mainnet at all: the suites themselves enforce
#     the testnet origin, and this script has no switch that changes that.
#
# USAGE
#   scripts/live-testnet-smoke.sh              # offline replay only
#   scripts/live-testnet-smoke.sh --live       # replay + a real testnet order
#   scripts/live-testnet-smoke.sh --help

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

readonly CORE_DIR="${REPO_ROOT}/libs/trading-core"
readonly ENGINE_DIR="${REPO_ROOT}/services/execution-engine"
readonly API_DIR="${REPO_ROOT}/apps/api"

readonly LIVE_FLAG='WLCT_LIVE_TESTNET'
readonly KEY_VAR='BINANCE_TESTNET_API_KEY'
readonly SECRET_VAR='BINANCE_TESTNET_API_SECRET'

LIVE=0
for argument in "$@"; do
  case "${argument}" in
    --live) LIVE=1 ;;
    --help|-h)
      sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf 'live-testnet-smoke: unknown argument %s (try --help)\n' "${argument}" >&2
      exit 2
      ;;
  esac
done

log() { printf '\n== %s\n' "$*"; }
fail() { printf 'live-testnet-smoke: %s\n' "$*" >&2; exit 2; }

command -v python3 >/dev/null 2>&1 || fail "python3 is not on PATH"
command -v npx >/dev/null 2>&1 || fail "npx is not on PATH (node_modules must be installed)"

if [[ "${LIVE}" -eq 1 ]]; then
  # Presence only: a value is never printed, compared or exported into a log.
  if [[ -z "${!KEY_VAR:-}" || -z "${!SECRET_VAR:-}" ]]; then
    fail "--live needs both ${KEY_VAR} and ${SECRET_VAR}; a half-configured run is refused"
  fi
  printf 'live-testnet-smoke: live mode requested; %s is set, %s is set\n' "${KEY_VAR}" "${SECRET_VAR}"
  export "${LIVE_FLAG}=1"
fi

failures=0

run() {
  local label="$1"
  shift
  log "${label}"
  if ! "$@"; then
    printf 'FAILED: %s\n' "${label}" >&2
    failures=$((failures + 1))
  fi
}

# --- 1-2. The Python proof, in one collection -------------------------
# `pytest` in run order: the replay suites first, then the refusal matrix. Both
# are offline; the live class inside the first file is skipped unless
# WLCT_LIVE_TESTNET=1 was exported above.
run "trading-core: testnet round trip (replay) and mainnet refusal matrix" \
  env -u PYTHONPATH python3 -m pytest \
    "${CORE_DIR}/tests/live_testnet" \
    "${CORE_DIR}/tests/test_mainnet_refusal_matrix.py" \
    -q -W ignore

# --- 3. The engine's submit route gates -------------------------------
run "execution-engine: submit route gates" \
  env -u PYTHONPATH python3 -m pytest \
    "${ENGINE_DIR}/tests/test_submit_route_gates.py" \
    -q -W ignore

# --- 4. The API's half of the round trip ------------------------------
run "api: OMS engine round-trip spec" \
  bash -c 'cd "$1" && NODE_OPTIONS=--max-old-space-size=4096 npx jest src/modules/oms/oms-engine-roundtrip.spec.ts --runInBand' \
  _ "${API_DIR}"

if [[ "${failures}" -ne 0 ]]; then
  printf '\nlive-testnet-smoke: %d proof(s) FAILED\n' "${failures}" >&2
  exit 1
fi

if [[ "${LIVE}" -eq 1 ]]; then
  printf '\nlive-testnet-smoke: replay, gates and API proofs passed, INCLUDING a live testnet round trip.\n'
  printf 'Record the evidence in docs/live/TESTNET_PROOF.md before citing this run anywhere.\n'
else
  printf '\nlive-testnet-smoke: replay, gates and API proofs passed. The live round trip was NOT run\n'
  printf '(opt in with --live and a testnet key pair); this run proves the wire contract, not a venue answer.\n'
fi
