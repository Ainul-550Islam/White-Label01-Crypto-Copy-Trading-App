# Row-level security deployment procedure

This document is the operator-facing procedure for the additive tenant RLS policies used by the API and execution-engine database roles. The checked-in policy inventory is generated from the Prisma tenant model and is the source of truth for covered and explicitly excluded tables.

## Artifacts

- `scripts/gen_part11_rls.py` derives the table inventory from `apps/api/prisma/schema.prisma` and emits the additive migration and operator SQL.
- `apps/api/prisma/migrations/20261006120000_part11_row_level_security/migration.sql` installs the versioned policy function and per-table policies; `lead_trader_applications` is included in the current tenant-scoped inventory and policy set.
- The reserved `20261101` generator run emits `apps/api/prisma/migrations/20261101000000_rls_policy_gap_close/migration.sql`. Its policy delta is zero because the earlier additive migration already contains exactly one policy for every covered table, including `lead_trader_applications`; the new migration refreshes the transaction-local tenant function without duplicating policies.
- The checked-in `enable.sql` and `disable.sql` each cover the same 190 distinct tenant tables. The coverage spec checks table parity and requires a policy for every table enabled by a migration or the DBA enable script.
- `apps/api/prisma/rls/rls_coverage.json` records the covered/excluded models and reserved generator stamp.
- `apps/api/prisma/rls/enable.sql`, `disable.sql`, and `grant.sql` are operator actions; they are not application boot-time switches.
- `docs/PART15_RLS_ENABLEMENT.md` describes the later audited execution-engine enablement gate.

## Review before deployment

1. Compare `rls_coverage.json` with the tenant-owned Prisma models and review every exclusion. A new tenant-owned table is not covered until the inventory and additive migration are updated and reviewed.
2. Confirm the migration contains the restrictive tenant predicate and uses the intended transaction-local tenant setting. Application queries must still include tenant IDs; RLS is a second boundary, not a replacement for authorization.
3. Apply the migration to a restored staging database first. Verify the application role is neither a superuser nor a `BYPASSRLS` role and that the database role cannot change policy state.
4. Exercise both tenant-scoped reads and attempted cross-tenant reads/writes using the application role. Verify the negative cases return no data or are rejected.
5. Only run the enablement SQL after the audited preflight is green. The procedure must refuse to enable policies when catalog inspection, role posture, table inventory, or seed-data checks are unavailable or inconsistent.

## Failure handling

A failed or incomplete policy audit is a deployment refusal. Do not substitute an empty result, assume policies are active, or grant the application role elevated catalog or row-security privileges to make the check pass. Preserve the migration and audit evidence with the release record. Roll back using the reviewed disable/rollback procedure only when the incident commander authorizes it; do not edit production policy rows by hand.

## Versioning

Policy changes are additive. Existing migration history must remain immutable. Use a new migration, regenerate the coverage inventory, and review the forward and inverse SQL together. Keep the generated table coverage consistent with the schema and tests before deployment.
