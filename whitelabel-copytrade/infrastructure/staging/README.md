# Staging Live-Readiness Environment

## Purpose

This directory contains the staging infrastructure profile for verifying all 8 execution-engine prerequisites from actual runtime objects, **without submitting orders, enabling live execution, or changing production configuration**.

## Two Verification Tools

### 1. Development Preflight (`scripts/staging/live_readiness.py`)

Quick verification for development environments. SKIPPED prerequisites count as success.

### 2. Staging Rehearsal (`scripts/staging/staging_rehearsal.py`)

**Strict** verification for staging environments. SKIPPED and UNVERIFIED prerequisites on required infrastructure **block** staging readiness. Includes persistence recovery and Redis lock/fencing verification.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Staging Profile (docker-compose.staging.yml)               │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  PostgreSQL   │  │    Redis     │  │ Execution Engine │  │
│  │  (real DB)    │  │ (real locks) │  │ (simulated mode) │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │            │
│         └─────────────────┴────────────────────┘            │
│                                                             │
│  All 8 prerequisites verified from runtime objects:         │
│  ✓ SIGNED_TRANSPORT_WIRED                                   │
│  ✓ IP_ALLOWLIST_ENFORCED                                    │
│  ✓ DURABLE_STORE_WIRED                                      │
│  ✓ DISTRIBUTED_LOCKS_WIRED                                  │
│  ✓ CREDENTIAL_SOURCE_CONFIGURED                             │
│  ✓ CREDENTIAL_FETCHER_WIRED                                 │
│  ✓ VENUE_ATTESTOR_WIRED                                     │
│  ✓ OPERATOR_CONFIRMATION_ACCEPTED                           │
│                                                             │
│  SAFETY: EXECUTION_MODE=live is REFUSED by code             │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# 1. Copy the staging environment template
cp .env.staging.example .env.staging

# 2. Edit with your staging values
#    NEVER commit .env.staging

# 3. Run the development preflight (quick check)
python3 scripts/staging/live_readiness.py --staging --json

# 4. Run the staging rehearsal (strict check)
python3 scripts/staging/staging_rehearsal.py --staging --json

# 5. Or run with docker-compose
docker compose -f docker-compose.yml -f infrastructure/staging/docker-compose.staging.yml up
```

## Staging Rehearsal Commands

```bash
# Full strict rehearsal (dependencies + runtime + recovery)
python3 scripts/staging/staging_rehearsal.py

# Dependency-only verification (PostgreSQL, Redis)
python3 scripts/staging/staging_rehearsal.py --check-dependencies

# Runtime-only verification (prerequisites)
python3 scripts/staging/staging_rehearsal.py --check-runtime

# JSON output for CI
python3 scripts/staging/staging_rehearsal.py --json

# Load staging environment
python3 scripts/staging/staging_rehearsal.py --staging
```

## Strict Readiness Semantics

The staging rehearsal uses **strict** semantics:

| Status | Meaning | Counts as Ready? |
|---|---|---|
| PASS | Verified from runtime objects | ✅ Yes |
| FAIL | Check failed | ❌ No |
| BLOCKED | Infrastructure not available | ❌ No |
| UNVERIFIED | Cannot verify (e.g., no credentials) | ❌ No |
| SKIPPED | Not configured (acceptable for credentials) | ⚠️ Conditional |

**Required prerequisites** (DURABLE_STORE_WIRED, DISTRIBUTED_LOCKS_WIRED, SIGNED_TRANSPORT_WIRED, IP_ALLOWLIST_ENFORCED) must be PASS. SKIPPED or UNVERIFIED blocks staging readiness.

**Credential-conditional prerequisites** (CREDENTIAL_SOURCE_CONFIGURED, CREDENTIAL_FETCHER_WIRED, VENUE_ATTESTOR_WIRED, OPERATOR_CONFIRMATION_ACCEPTED) may be SKIPPED if no credentials are configured.

## What the Rehearsal Verifies

### Dependencies (PostgreSQL + Redis)
- PostgreSQL connectivity and schema (engine_orders, engine_order_events, engine_order_fills)
- Redis connectivity and lock acquire/release
- Persistence recovery (write → new store instance → read back)
- Lock fencing token advancement
- Stale ownership rejection

### Runtime Prerequisites
- Signed transport (key registry, client, verifier)
- IP allowlist policy enforcement
- Credential source/fetcher wiring
- Venue attestation wiring
- Operator confirmation assessment
- Live enablement grading
- Live mode gate (always refuses)

## Safety Guarantees

1. **Never submits an order** — Only reads from runtime objects
2. **Never enables live execution** — `EXECUTION_MODE=live` is refused by code
3. **Never changes production config** — No writes to any persistent store
4. **Never prints secrets** — All output uses redacted summaries
5. **Uses runtime evidence** — Config flags alone cannot produce a PASS
6. **Production guard** — Refuses to run against production without explicit opt-in
7. **Strict semantics** — SKIPPED ≠ PASS for staging readiness

## Files

| File | Purpose |
|---|---|
| `docker-compose.staging.yml` | Staging compose overlay with real PostgreSQL/Redis |
| `../.env.staging.example` | Staging environment template |
| `scripts/staging/live_readiness.py` | Development preflight CLI |
| `scripts/staging/staging_rehearsal.py` | Staging rehearsal CLI (strict) |
| `services/execution-engine/tests/test_part28_staging_preflight.py` | 27 preflight tests |
| `services/execution-engine/tests/test_part29_staging_rehearsal.py` | 51 rehearsal tests |

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | All checks PASS (or SKIPPED for credentials) |
| 1 | One or more checks FAIL |
| 2 | BLOCKED (infrastructure not available) |

## Integration with CI/CD

```yaml
# Example CI step
staging-rehearsal:
  script:
    - cp .env.staging.example .env.staging
    - docker compose -f docker-compose.yml -f infrastructure/staging/docker-compose.staging.yml up -d
    - sleep 10  # Wait for health checks
    - python3 scripts/staging/staging_rehearsal.py --staging --json > rehearsal-report.json
    - python3 -c "import json, sys; r=json.load(open('rehearsal-report.json')); sys.exit(0 if r['stagingReady'] else 1)"
```

## Design Notes

- The rehearsal constructs the **actual runtime** using `build_runtime(settings)`
- Every check inspects **runtime objects**, not configuration flags
- PostgreSQL checks verify **table existence** and **persistence recovery**
- Redis checks perform **actual lock acquire/release** and **fencing verification**
- The confirmation check runs **assess_deployment()**, the same function used by the placement pipeline
- The live mode gate verifies that the enablement report **blocks live execution**
- **SKIPPED ≠ PASS** — staging readiness requires real infrastructure