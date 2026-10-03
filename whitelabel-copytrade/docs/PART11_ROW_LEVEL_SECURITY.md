# Part 11 - Row-level security (index)

This document is an index. Row-level security was never given a document of
its own: the policies shipped inside the Part 11 worker-scaling document, and
the enablement checklist moved to Part 15 when enablement became an audited
surface. Older material (the comment at the top of the Part 13 execution-store
migration, and the Part 13 and Part 14 handover snapshots) still points here,
and an applied migration cannot be edited without changing its checksum, so
this page exists to send those readers to the real sources.

## Where each part lives

| Topic | Source of truth |
| --- | --- |
| Why tenant isolation needs a database layer, and the policy design | `docs/PART11_WORKER_SCALING.md`, section 16 "Row-level security" |
| Tenant model, query-level tenant predicate, tenant resolution | `docs/MULTI_TENANCY.md` |
| Enablement as a verifiable, audited operation (probe, CLI, evidence ledger) | `docs/PART15_RLS_ENABLEMENT.md` |
| Policy migration (function `wlct_current_tenant_id()` and one `tenant_isolation` policy per covered table) | `apps/api/prisma/migrations/20260923090000_part11_row_level_security/migration.sql` |
| Operator scripts: enable (with the pre-flight checklist), disable, grants | `apps/api/prisma/rls/enable.sql`, `apps/api/prisma/rls/disable.sql`, `apps/api/prisma/rls/grant.sql` |
| Machine-readable coverage (covered and excluded tables) | `apps/api/prisma/rls/rls_coverage.json` |
| Generator for all of the above, from `schema.prisma` | `scripts/gen_part11_rls.py` |
| Platform-scoped (excluded) table set used by the engine probe | `libs/trading-core/wlct_trading/enablement.py` |
| Operator CLI that records and ages enablement evidence | `scripts/rls-enablement.mjs` |

## Coverage rule

The generator classifies syntactically from `schema.prisma`:

- a model with a required `tenantId String` column is **covered**: it gets a
  `tenant_isolation` policy (`USING` and `WITH CHECK` on
  `tenant_id = wlct_current_tenant_id()`), and `enable.sql` turns on
  `ENABLE` plus `FORCE ROW LEVEL SECURITY` for it;
- a model whose `tenantId` is nullable is **excluded** (platform-scoped):
  rows with no tenant, such as platform-wide legal holds or partner records
  that span tenants, cannot be expressed by a single tenant predicate.

The request-scoped tenant is carried in the transaction-local setting
`app.tenant_id` (see `apps/api/src/infrastructure/prisma/tenant-scoped-prisma.factory.ts`).

## Current numbers

After the Part 11 production-SSO migration
(`20260923089000_sso_authorization_code_flow`) the artifacts cover **186**
tables and exclude **30** (182 after `20260923085000_domain_persistence_tables`,
plus `sso_auth_transactions`, `sso_identities`, `sso_assertion_replays` and
`sso_audit_events`). The numbers are pinned in
`services/execution-engine/tests/test_part15_drift_parity.py` and derived in
`apps/api/src/infrastructure/prisma/rls-coverage.spec.ts`, so `enable.sql`,
`disable.sql`, `rls_coverage.json` and the migration cannot silently disagree.

## Regenerating

Always pass the migration's stamp; the generator's default stamp is older:

```sh
python3 scripts/gen_part11_rls.py --stamp 20260923090000
```

## Existing databases

Policies are created by the migration, but RLS is only switched on by the
operator step in `enable.sql`.

`prisma migrate deploy` never re-runs a migration that is already recorded, and
`20260923090000_part11_row_level_security` is regenerated whenever tenant
tables are added. A database that applied an older version of it (153 or 182
policies) receives the new tables but **not** their `tenant_isolation` policies.
Bring it up to date in this order:

1. `prisma migrate deploy` creates the new tables.
2. Apply the upgrade files that match the database, oldest first. Each is
   copied from the generated migration, idempotent (`DROP POLICY IF EXISTS`
   before each `CREATE POLICY`) and runs as one transaction:

   - `apps/api/prisma/upgrades/rls_policies_153_to_182.sql` (29 policies) for a
     database that applied the 153-policy version;
   - `apps/api/prisma/upgrades/rls_policies_182_to_186.sql` (4 SSO policies)
     for every database that applied the 153- or 182-policy version.

   ```sh
   npx prisma db execute --schema apps/api/prisma/schema.prisma --file apps/api/prisma/upgrades/rls_policies_153_to_182.sql
   npx prisma db execute --schema apps/api/prisma/schema.prisma --file apps/api/prisma/upgrades/rls_policies_182_to_186.sql
   ```

   Afterwards `SELECT count(*) FROM pg_policies WHERE policyname = 'tenant_isolation';`
   returns 186.
3. Only if the database already ran `enable.sql`: run it again (it is
   idempotent) so the new tables are enabled and forced as well:

   ```sh
   npx prisma db execute --schema apps/api/prisma/schema.prisma --file apps/api/prisma/rls/enable.sql
   ```

Do not swap steps 2 and 3. A table with RLS forced and no policy returns zero
rows to every role, so the new billing, governance, developer and SSO tables
would look empty to the API.

Fresh databases need none of this: the current migration creates all 186
policies.

Then record the audit with `scripts/rls-enablement.mjs` as described in
`docs/PART15_RLS_ENABLEMENT.md`.
