# Multi-tenancy

## Model

One deployment, many organisations. A **tenant** is an organisation that
white-labels the platform: it has its own users, roles, branding, subscription,
feature flags and settings. A **platform user** (`isPlatformUser = true`,
`tenantId` pointing at the platform tenant) operates across tenants.

Isolation is **shared-database, shared-schema, application-enforced**. Chosen
over schema-per-tenant or database-per-tenant because:

* Migrations run once, not N times. With hundreds of tenants, per-tenant DDL
  becomes the dominant operational risk.
* Connection pooling stays sane. A pool per schema does not scale.
* Cross-tenant platform queries (billing, support, fraud) stay simple.

The cost is that isolation must be enforced in code, deliberately and in one
place. That place is `TenantScopedPrismaFactory`.

## Resolution order

For every request, `TenantResolutionMiddleware` determines a candidate tenant:

1. **Custom domain** - `TenantDomain.domain` matches the request host.
2. **Platform subdomain** - `{slug}.{PLATFORM_DOMAIN}`.
3. **`X-Tenant-Slug` header** - used by the mobile client and the admin console.
4. **`DEFAULT_TENANT_SLUG`** - the fallback, `platform`.

The context records *which* of those produced the answer, in
`TenantContext.source`. That distinction is load-bearing, because the first
three are claims made by the client while the fourth is an assumption made by
the server.

`TenantGuard` then applies the rule that matters:

> For an authenticated request, the tenant is the one in the access token.
> Whatever the resolution step produced is discarded.

with one refinement: an **explicit** selection (`domain`, `subdomain`, `header`)
that contradicts the token is not merely ignored, it is refused - `403
TENANT_MISMATCH` plus a `TENANT_ISOLATION_VIOLATION` security event, because a
client asking for another brand's data is an attack signal worth recording. The
`default` fallback is excluded from that rule: since the middleware always
produces a context, treating the fallback as a contradiction would reject every
legitimate request from a tenant user who simply did not send the optional
header.

Platform operators are the one exception to the "token wins" rule. A super admin
may work inside another tenant by selecting it explicitly (custom domain,
sub-domain or `X-Tenant-Slug`); without an explicit selection they stay in their
home tenant, and every cross-tenant call is audited.

A client-supplied tenant id is only ever a hint for unauthenticated flows
(sign-in, registration, branding). It is never an authorisation input.

## Query-level enforcement

```ts
// Simplified: the real factory lives in
// apps/api/src/infrastructure/prisma/tenant-scoped-prisma.factory.ts
const scoped = prisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, args, query }) {
        if (!TENANT_SCOPED_MODELS.has(model)) return query(args);
        return query(withTenantPredicate(args, scope.tenantId));
      },
    },
  },
});
```

The allowlist is explicit:

`User`, `UserSession`, `RefreshToken`, `VerificationToken`, `LoginAttempt`,
`TenantSetting`, `TenantDomain`, `TenantFeatureFlag`, `TenantSubscription`,
`TenantApiKey`, `AuditLog`, `SecurityEvent`, `KycProfile`, `Notification`,
`UserRole`.

Adding a tenant-owned table means adding it here. An omission is a leak, so the
list is short, sorted and reviewed.

## Schema conventions

| Rule | Reason |
| --- | --- |
| Every tenant-owned table has a non-null `tenantId` | The predicate can never be a no-op |
| `tenantId` is the first column of composite indexes | The predicate is free |
| Uniqueness is scoped: `@@unique([tenantId, email])` | Two tenants may share an email address |
| Platform rows use `tenantId = NULL` | System roles and platform plans belong to no tenant |
| Soft delete via `deletedAt` on Tenant/User/Role/SubscriptionPlan | Audit and billing history survive a deletion |
| Cascades from aggregate roots; audit/security use `SetNull` | Deleting a user must not erase the record that they did something |

### The `NULL` tenant caveat

Prisma types a compound-unique `where` field as non-nullable, so
`upsert({ where: { tenantId_key: { tenantId: null, key } } })` does not compile.
Platform-scoped rows are therefore read with `findFirst` and written with
explicit update/create branches. `apps/api/prisma/seed.ts` shows the pattern.

## Database-enforced isolation (Row Level Security, Part 11)

The query-level enforcement above is the second layer. The third one is the
database itself, and it exists for the failure mode the factory cannot
catch: code that never went through the factory at all - a new service, a
psql session with the app's credentials, a hotfix written under pressure.

* **Coverage is generated, never hand-maintained.**
  `scripts/gen_part11_rls.py` derives the policy set from this schema: every
  model with a non-null `tenantId` gets one `tenant_isolation` policy
  (`USING` + `WITH CHECK` on `tenant_id = wlct_current_tenant_id()`, a STABLE
  function over the transaction-local GUC). The generated migration, the
  enable/disable/grant scripts and `apps/api/prisma/rls/rls_coverage.json` are
  all outputs; `rls-coverage.spec.ts` re-parses the schema on every test run and
  goes red the moment a tenant table exists without a policy or an excluded
  table acquires one by accident. Adding a tenant-scoped model means
  rerunning the generator - one command, no judgement calls.
* **The app side is `PrismaService.withTenantRls(tenantId, work)`:** it
  validates the UUID, then issues `set_config('app.tenant_id', $1, true)` -
  SET **LOCAL**, so the setting cannot outlive the transaction, and the value
  is a bind parameter, never concatenated SQL. A pooled connection can not
  carry one tenant into the next tenant's query because there is no
  connection-level setting to carry.
* **Enabling is a DBA step with a checklist, not a migration:**
  `apps/api/prisma/rls/enable.sql` pairs `ENABLE` with `FORCE` per table
  (FORCE covers the table owner; the pre-flight check that the app role has
  neither `BYPASSRLS` nor superuser is what makes the sentence "RLS is on"
  mean anything) and `disable.sql` is the exact inverse. The additive
  migration ships policies **dormant** deliberately: enabling before every
  write path adopts `withTenantRls` converts a configuration gap into an
  outage, and the flip is a scheduled, human decision with verification
  queries attached.
* **Fail-closed at every arm.** No GUC, `NULL`; `tenant_id = NULL` is never
  true; so an unscoped read sees zero rows and an unscoped write is refused.
  When the sandbox question is asked - "did you run this against real
  Postgres?" - the recorded answer is: the policy SQL is generated-and-pinned
  by spec, the live enablement verification suite runs at enablement time
  per the checklist (no PostgreSQL server exists in this development
  sandbox; see the Part 11 gate ledger).

### Which tables are excluded, and why that is not a hole

The seven tables with a nullable `tenantId` - the role templates, the
subscription plans, `audit_logs`, `security_events`, `kill_switches`,
`ops_alerts`, `ops_incidents` - carry platform rows that belong to no
tenant. A strict `tenant_id = GUC` policy there would hide the NULL-tenant
platform rows (pricing plans are public; platform audit entries are
operational) without protecting any tenant's data, because there is no
tenant to protect them from. The exclusion is an explicit list, present in
every generated artefact and pinned by the spec - the same tables the
"NULL tenant caveat" above already singles out. Tenant-bearing rows in those
tables remain factory-filtered. Closing that last gap (per-table
multi-context policies once a platform-role session concept exists) is
listed as future work in the Part 11 document rather than left implied.

## Roles across tenants

The seven system roles (`SUPER_ADMIN`, `TENANT_ADMIN`, `TRADER`, `FOLLOWER`,
`SUPPORT`, `FINANCE`, `COMPLIANCE`) exist once with `tenantId = NULL` and
`isSystem = true`. They are immutable templates.

When a tenant is created, the roles are **cloned** into it. The tenant can then
edit its own copies - rename `TRADER` to `Strategy Provider`, drop a permission
from `SUPPORT` - with no effect on any other tenant and no effect on the
template.

`FOLLOWER` is marked `isDefault` and is assigned to self-registered users.

## Tenant lifecycle

**Creation** is a single transaction: tenant row, branding row, cloned roles,
owner user, subscription. Then, outside the transaction,
`applyDefaultsForTenant` seeds settings and feature flags and
`audit.recordImmediate` writes the audit entry. The transaction stays short
because it holds row locks; the follow-up work is idempotent.

**Suspension** (`SUSPENDED`) and **archival** (`ARCHIVED`) mass-revoke every
session belonging to the tenant. A suspended organisation's users are signed out
within seconds, not at their next token refresh.

**Deletion** is soft. Audit history and billing records must outlive the entity
they describe.

## Configuration hierarchy

Effective value = tenant override, falling back to the platform default.

| Layer | Source |
| --- | --- |
| Settings | `TenantSetting` over the seeded defaults |
| Feature flags | `TenantFeatureFlag.enabled` over `FeatureFlag.isGlobalDefault` |
| Entitlements | `TenantSubscription` → plan `limits` |
| Branding | `TenantBranding`, always tenant-owned |

Secret settings are encrypted with AAD `tenant_setting:{tenantId}:{key}` and
read back as `{ configured: true }` - the value never leaves the server.

Feature-flag rollout is deterministic:
`sha256("{tenantId}[:{userId}]:{key}").readUInt32BE(0) % 100`. The same user
always lands in the same bucket, so a partial rollout is stable rather than
flickering between requests.

## Caching

Cached with short TTLs and explicit invalidation on write:

`tenantBySlug`, `tenantById`, `tenantByDomain`, `tenantPublicConfig` (120s),
`tenantFeatureFlags` (60s), `userPermissions`, `revokedToken(jti)`,
`accountLock`, `loginFailures`.

Every key is namespaced by `REDIS_KEY_PREFIX`, so several environments can share
a Redis instance without colliding.

## Realtime

Rooms are derived server-side from the authenticated identity:

* `tenant:{tenantId}`
* `tenant:{tenantId}:user:{userId}`
* `tenant:{tenantId}:trader:{traderId}`
* `market:{SYMBOL}` (public data, no tenant dimension)

A client cannot request a room. It receives what its identity entitles it to.

## Testing isolation

The checks that must exist before any tenant-owned feature ships:

1. Tenant A cannot read, update or delete a tenant B row by id.
2. A JWT minted for tenant A is rejected on a tenant B custom domain.
3. Creating a duplicate email succeeds across tenants and fails within one.
4. A platform user's cross-tenant read is authorised, audited, and denied for
   non-platform users.
5. Suspending a tenant terminates its users' sessions.
6. With RLS enabled (staging), a covered table read as the app role without
   `withTenantRls` returns zero rows, an insert carrying another tenant's
   id is refused by the policy (`WITH CHECK`), and the enable.sql checklist's
   `rolbypassrls`/`rolsuper` probe comes back false/false for the app role.
