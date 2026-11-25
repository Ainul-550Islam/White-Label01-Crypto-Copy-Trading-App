# Compliance review-action idempotency and rollout boundary

## Status

The review-action persistence path and its additive Prisma migration are restored. The compliance idempotency migration and the separate RLS policy-gap migration are both **not applied**. Production application was requested, but is pending: the production target/connection, approved backup and recovery confirmation, approval, and migration window have not been supplied. No database write or live migration rehearsal has occurred. RLS was not enabled. This is a code handoff, not a release-readiness sign-off.

## Behavior

Review-action endpoints accept an optional `idempotencyKey` in their request DTO. Supplied keys are trimmed, must not be blank, and are limited to 128 characters. Requests without a key remain non-idempotent.

The database scope is `(tenant_id, reviewer_id, idempotency_key)`. Reuse of a key with the same case, actor, action, and canonical request payload replays the persisted receipt/result. Reuse with a different payload returns HTTP 409. The request fingerprint is a domain-tagged SHA-256 digest over tenant, case, actor, action, and normalized payload. The raw key is persisted on the review receipt, not in audit metadata or application logs; safe audit metadata includes only a SHA-256 digest of a supplied key.

Assignment, escalation, decisions, EDD/re-verification/hold/release requests, resolve/close, evidence, and notes use one tenant-scoped transaction. It checks for an existing receipt first, creates a receipt claim, performs the case/evidence mutation, finalizes the immutable review record, and writes the audit record. Failed review or audit persistence aborts the transaction. A unique-key race re-reads the winning receipt in a fresh tenant transaction and either replays it or returns a conflict. Case transitions use state predicates to prevent concurrent writes from silently overwriting each other.

Evidence replay resolves `resultReferenceId` using tenant and case predicates. No in-memory success object is returned when durable persistence fails.

## Schema and migrations

`ComplianceReview` adds nullable `idempotencyKey` (`VARCHAR(128)`), `requestFingerprint` (`VARCHAR(64)`), and `resultReferenceId` (`UUID`) fields, with a nullable unique index on `(tenant_id, reviewer_id, idempotency_key)`. Legacy rows remain `NULL` and are not backfilled or deleted.

- Compliance idempotency migration: `apps/api/prisma/migrations/20270109000000_compliance_review_action_idempotency/migration.sql`
- Separate additive RLS policy-gap migration: `apps/api/prisma/migrations/20270109000001_rls_policy_gap_close/migration.sql`

Neither migration has been applied. A production apply requires the approved target, credentials through the approved secret channel, a verified backup/recovery point, approval, and a scheduled window. Applying the compliance migration does not enable RLS. RLS policy deployment/enablement is a separate action and was not authorized here.

## Pseudonym secret

Compliance PII pseudonyms use HMAC-SHA256 with per-field domain separation. Production requires `DEVELOPER_SECRET_HMAC_KEY` with at least 16 characters; startup fails if it is missing or too short. The local/test fallback is unavailable in production. Current call-site domains separate KYC email from AML first name, last name, date of birth, and transaction counterparty. Keep the secret stable; rotating it changes all generated pseudonyms and can break cross-record matching until data is reindexed.

## Pending production rollout inputs

1. Identify the exact production cluster/database and the approved migration runner. Do not put database credentials in this ZIP or paste them into ordinary chat; use the approved secret channel.
2. Confirm a recent backup and a tested restore/recovery point, with the responsible approver.
3. Provide the approval/change record and the authorized deployment window.
4. Confirm the production `DEVELOPER_SECRET_HMAC_KEY` is provisioned through the production secret manager before the application relies on it.
5. After those inputs are confirmed, apply only the migrations approved for production, then verify the columns and nullable unique index. No migration has been run in this handoff.
6. Treat RLS deployment and enablement as a separate reviewed action; do not run the RLS enable script as part of this migration request.
7. Monitor review conflicts, unique violations/replays, and audit/transaction failures.

## Validation snapshot

Executed under Node `v22.23.5` unless noted:

- `npm run build:packages` passed under Node 22.
- Prisma schema validation and client generation passed using placeholder local database URLs; no database was contacted.
- Targeted TypeScript no-emit check passed for the compliance/controller/DTO/pseudonym/developer/custody source set. This is **not** an API-wide typecheck.
- The full API Jest run passed: **273 suites and 3,736 tests passed**, with **36 suites / 180 tests skipped** and one snapshot passed. The seven directly focused suites also passed (177 tests).
- RLS generated migration/enable/disable/grant/coverage artifacts matched a temporary regeneration from the schema and checked-in generator (205 tables covered; 31 excluded).
- API-wide `tsc --noEmit` and `nest build` were attempted on Node 22 but both ran out of the sandbox's 1 GiB Node heap. API-wide typecheck/build are therefore **not established**.
- API ESLint was attempted and exited non-zero: 0 errors and 5,171 warnings, while the configured gate requires zero warnings.
- Both migrations remain unapplied; no live database migration rehearsal or RLS enablement occurred. Release readiness is **not certified**.
