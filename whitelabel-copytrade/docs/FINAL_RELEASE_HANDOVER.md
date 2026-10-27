# Batch 01 release handover

**Prepared:** 2026-10-25  
**Scope:** Batch 01 implementation package only. This handover is not a production-release approval or a statement that every repository subsystem has passed CI.

## Delivery contents

- The complete Batch 01 source patch is packaged as `batch01-code.zip`, containing only new and modified files at their exact repo-relative paths; it unzips at the repository root.
- `scripts/apply-batch01-deletes.sh` (inside the archive) removes every prompt-declared deleted path from the target Git worktree with `git rm`, after verifying no remaining file imports a deletion target.
- The root workflow and the project workflow copy are synchronized; the repository-root workflow is the one GitHub executes.
- The exchange-provider implementation is canonical under `apps/api/src/modules/exchanges/providers/`; duplicate `venues/` adapters/spec and the unused provider-factory shim are removed.
- The existing Part 11 migration already contains the `lead_trader_applications` policy. The schema inventory and generated enable/disable artifacts are aligned; the RLS coverage Jest spec parses all migration files and verifies policy coverage.
- Money-path lookup failures now propagate as explicit failed operations instead of silently returning fallback success. TWR cash-flow lookup failures produce an explicit failed calculation result.
- The competing Next.js request entrypoint and the stale customer build-validation note are removed; the actual Next.js entrypoint check remains.

## Checks observed

The commands below produce their own current suite/test totals; this handover intentionally does not freeze those counts.

| Check | Command / result |
| --- | --- |
| Shared packages | `npm run build:packages` — passed |
| Admin web | `cd apps/admin-web && npx tsc --noEmit -p tsconfig.json`; `NEXT_TELEMETRY_DISABLED=1 npx next build`; `npx jest --runInBand src/tests` — passed |
| Customer web | `cd apps/web && npx tsc --noEmit -p tsconfig.json`; `NEXT_TELEMETRY_DISABLED=1 npx next build`; `node scripts/check-tailwind-output.mjs`; `NODE_OPTIONS=--max-old-space-size=1300 npx jest --runInBand` — passed |
| API portfolio-accounting | `cd apps/api && NODE_OPTIONS=--max-old-space-size=1300 npx jest --runInBand src/modules/portfolio-accounting` — passed |
| API exchanges | `cd apps/api && NODE_OPTIONS=--max-old-space-size=1300 npx jest --runInBand src/modules/exchanges` — passed |
| API RBAC | `cd apps/api && NODE_OPTIONS=--max-old-space-size=1300 npx jest --runInBand src/modules/rbac` — passed |
| API users | `cd apps/api && NODE_OPTIONS=--max-old-space-size=1300 npx jest --runInBand src/modules/users` — passed |
| API billing, custody, OMS, copy-trading, and risk | Run each corresponding `src/modules/{billing,custody,oms,copy-trading,risk}` Jest target individually with `NODE_OPTIONS=--max-old-space-size=1300`; all passed |
| Money-path catch scanner | `cd apps/api && npx jest --runInBand src/common/no-empty-catch.spec.ts` — passed |
| RLS coverage | `cd apps/api && npx jest --runInBand src/infrastructure/prisma/rls-coverage.spec.ts` — passed |
| Authorization and web API contracts | `npm run check:route-authorization`; `npm run check:web-api-contract` — passed |
| UI and entrypoint checks | `node scripts/check-next-entrypoints.mjs`; `node scripts/check-ui-copy-leaks.mjs`; `cd apps/web && node src/tests/run-50-checks.js` — passed |
| Repository references | `cd libs/trading-core && PYTHONPATH=. python -m pytest -q tests/test_repo_reference_integrity.py -W ignore` — passed |
| GAP-51–100 evidence | `node ops/gap-parity-scanner-51-100.js` — static evidence only; its output is recorded in `NEXT_51_100_FINAL_REPORT.md` |

## Not verified / environmental limits

- The complete API TypeScript check did not produce a pass: the process exhausted the sandbox's available Node heap. The scoped money-path module typechecks did pass individually.
- The combined API Jest self-check did not complete in the sandbox. Relevant Batch 01 suites were run individually as listed above; do not treat the incomplete combined run as a pass.
- Execution-engine pytest collection stops in `tests/conftest.py` because `fastapi` is not installed. The pinned `asyncpg==0.29.0` dependency also failed to install under the available Python 3.13 runtime.
- `scripts/verify-part1.sh` completed its non-TypeScript checks but its API TypeScript phase exhausted Node heap; it therefore exits nonzero for that environmental limit.
- Secret scanning was not completed because `gitleaks` is unavailable in the environment.
- No production database, live exchange, payout provider, or LIVE trading test was performed. Do not infer production readiness from static scanners or focused unit tests.

## Commands still requiring a suitable CI environment

- `npm run typecheck --workspace=@wlct/api`
- `cd apps/api && npx jest src/modules/portfolio-accounting src/modules/exchanges src/modules/rbac src/modules/users src/common src/infrastructure/prisma`
- `cd services/execution-engine && python -m pytest -q -W ignore`
- `node scripts/secret-scan.mjs --tree`

Run the commands above and the full CI workflow against the exact target commit before release. Review the release-package checklist, restore/rollback plan, dependency audit, migration posture, and environment-specific LIVE enablement approval separately.
