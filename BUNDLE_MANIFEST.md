# Refreshed change-bundle manifest

This ZIP contains complete file copies (not diffs) for the restored compliance review-action idempotency work, the related RLS and custody changes, and four API test-harness corrections required for the full Jest suite to pass. Extract/overlay the `whitelabel-copytrade/` tree onto the matching repository root. This is the complete 30-file change bundle; `BUNDLE_MANIFEST.md` is included as an additional archive file.

## Production / migration state

The user requested production migration application, but the production target/connection, approved backup and recovery confirmation, approval, and deployment window were not supplied. Therefore neither additive migration was applied, and no database write or live migration rehearsal occurred. RLS was not enabled; its enablement remains separate and was not authorized. No credentials are included in this ZIP.

## Included repository files (30)

- `whitelabel-copytrade/apps/api/prisma/schema.prisma`
- `whitelabel-copytrade/apps/api/prisma/migrations/20270109000000_compliance_review_action_idempotency/migration.sql`
- `whitelabel-copytrade/apps/api/prisma/migrations/20270109000001_rls_policy_gap_close/migration.sql`
- `whitelabel-copytrade/apps/api/prisma/rls/enable.sql`
- `whitelabel-copytrade/apps/api/prisma/rls/disable.sql`
- `whitelabel-copytrade/apps/api/prisma/rls/grant.sql`
- `whitelabel-copytrade/apps/api/prisma/rls/rls_coverage.json`
- `whitelabel-copytrade/apps/api/src/modules/compliance/compliance.types.ts`
- `whitelabel-copytrade/apps/api/src/modules/compliance/aml-screening.service.ts`
- `whitelabel-copytrade/apps/api/src/modules/compliance/identity-verification.service.ts`
- `whitelabel-copytrade/apps/api/src/modules/compliance/compliance-case.repository.ts`
- `whitelabel-copytrade/apps/api/src/modules/compliance/compliance-case.service.ts`
- `whitelabel-copytrade/apps/api/src/modules/compliance/compliance.controller.ts`
- `whitelabel-copytrade/apps/api/src/modules/compliance/dto/compliance-review.dto.ts`
- `whitelabel-copytrade/apps/api/src/modules/compliance/compliance-review-action-idempotency.spec.ts`
- `whitelabel-copytrade/apps/api/src/modules/compliance/compliance-pseudonym.spec.ts`
- `whitelabel-copytrade/apps/api/src/modules/developer-platform/developer.module.ts`
- `whitelabel-copytrade/apps/api/src/common/api-compatibility-contracts.spec.ts`
- `whitelabel-copytrade/apps/api/src/common/fail-soft-reads.spec.ts`
- `whitelabel-copytrade/apps/api/src/modules/billing/step-up-permission-metadata.spec.ts`
- `whitelabel-copytrade/apps/api/src/modules/exchanges/api-key-rotation.spec.ts`
- `whitelabel-copytrade/apps/api/src/modules/providers/adapters/payment/payment-normalizer.contract.spec.ts`
- `whitelabel-copytrade/apps/api/src/modules/providers/adapters/custody/custody.adapter.ts`
- `whitelabel-copytrade/apps/api/src/modules/providers/adapters/custody/custody-adapter.contract.spec.ts`
- `whitelabel-copytrade/apps/api/src/modules/custody/custody-adapter.contract.spec.ts`
- `whitelabel-copytrade/apps/api/src/infrastructure/prisma/rls-coverage.spec.ts`
- `whitelabel-copytrade/docs/COMPLIANCE_REVIEW_ACTION_IDEMPOTENCY.md`
- `whitelabel-copytrade/docs/ARCHIVE_HANDOFF.md`
- `whitelabel-copytrade/docs/PART15_RLS_ENABLEMENT.md`
- `whitelabel-copytrade/scripts/gen_part11_rls.py`

## Validation snapshot

Executed with Node `v22.23.5` unless noted:

- `npm run build:packages` passed.
- Prisma schema validation and client generation passed with placeholder local database URLs; no database was contacted.
- Targeted no-emit TypeScript check passed for the compliance/controller/DTO/pseudonym/developer/custody source set; it is not API-wide.
- Full API Jest run passed: **273 suites / 3,736 tests passed**, 36 suites / 180 tests skipped, and one snapshot passed. The directly focused seven-suite run passed 177 tests.
- RLS artifacts matched a temporary regeneration from the schema and checked-in generator: 205 tables covered and 31 excluded.
- API-wide `tsc --noEmit` and `nest build` were both attempted under Node 22 and each exceeded the sandbox's 1 GiB Node heap. Full API typecheck/build are not established.
- Full API ESLint was attempted: 0 errors, 5,171 warnings; the configured zero-warning gate failed.
- The two migrations remain unapplied, no live migration rehearsal was done, and RLS was not enabled. This bundle is not a release-readiness sign-off.

See `whitelabel-copytrade/docs/COMPLIANCE_REVIEW_ACTION_IDEMPOTENCY.md` for behavior, rollout prerequisites, and the detailed validation boundary.
