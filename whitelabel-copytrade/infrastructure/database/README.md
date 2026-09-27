# Database

## Ownership of schema changes

Prisma owns the schema. `apps/api/prisma/schema.prisma` is the single source of
truth and every structural change ships as a migration:

```bash
npm run prisma:migrate -w @wlct/api      # development: create + apply
npm run prisma:deploy  -w @wlct/api      # CI/production: apply only
```

The SQL in `init/` runs **once**, when the Postgres container initialises an
empty data directory. It contains only what Prisma cannot express: extensions,
database-level settings and the least-privilege runtime role. Never put table
definitions here - they would drift from the Prisma schema immediately.

## Roles

| Role | Used by | Privileges |
| --- | --- | --- |
| `wlct` (owner) | migrations only | owns the schema |
| `wlct_app` | the running API | DML only, no DDL |

`wlct_app` is created only when `wlct.app_password` is set as a server
parameter. In Compose the API runs as the owner for developer convenience; in
staging and production, point `DATABASE_URL` at `wlct_app` and keep the owner
credential for migrations alone.

## Tenant isolation

Isolation is enforced in the application layer by `TenantScopedPrismaFactory`,
which injects a `tenantId` predicate into every query against a tenant-owned
model. Two properties make that safe:

* `tenantId` is always the first column of a composite index, so the predicate
  is cheap.
* A client-supplied tenant id is never trusted. The tenant is resolved from the
  authenticated token, and `TenantGuard` overrides anything the request claimed.

Row-level security is the natural next step once the trading tables land; the
schema is already shaped for it (every tenant-owned table carries a non-null
`tenantId`).

## Backups

Not automated in Part 1. For any deployed environment, take a nightly
`pg_dump --format=custom`, store it encrypted off-host, and rehearse the
restore - an untested backup is not a backup.
