# White-Label Crypto Copy-Trading Platform

A production-grade, multi-tenant, **non-custodial** copy-trading platform. One
deployment serves many white-label organisations, each with its own users,
roles, branding, subscription and configuration.

Non-custodial means the platform never holds customer funds. Users connect their
own exchange accounts with trade-only API keys, and orders are placed on the
user's own account.

> **Part 1 of a multi-part build.** This part delivers the secure foundation:
> tenancy, identity, authorisation, security, and the service skeletons.
> Copy-trading logic and live order execution are **not** included and are
> hard-disabled in code (`EXECUTION_ENABLED=false`). There is no simulated
> trading performance anywhere in this codebase.

---

## Contents

| Document | What it covers |
| --- | --- |
| [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) | setup, running, troubleshooting |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | topology and the reasoning behind it |
| [docs/SECURITY.md](docs/SECURITY.md) | every control, and where it lives |
| [docs/MULTI_TENANCY.md](docs/MULTI_TENANCY.md) | isolation model and its guarantees |
| [docs/API.md](docs/API.md) | endpoints, envelopes, error codes |
| [docs/ROADMAP.md](docs/ROADMAP.md) | what ships in Parts 2-8 and why in that order |

---

## Stack

| Layer | Technology |
| --- | --- |
| Mobile | Flutter 3.22 · Riverpod · Dio · go_router · flutter_secure_storage |
| Admin console | Next.js 14 (App Router) · React 18 · TypeScript |
| API | NestJS 10 · TypeScript · Prisma 5 · Socket.IO · BullMQ |
| Database | PostgreSQL 16 |
| Cache / queue | Redis 7 |
| Trading & data | Python 3.11 · FastAPI · ccxt |
| Notifications | Node 20 · BullMQ worker |
| Runtime | Docker Compose · npm workspaces |

---

## Repository layout

```
whitelabel-copytrade/
├── apps/
│   ├── api/                    NestJS API - the only service clients talk to
│   ├── admin-web/              Next.js administration console
│   └── mobile/                 Flutter client
├── services/
│   ├── trading-engine/         Python/FastAPI - risk and (later) execution
│   ├── market-data/            Python/FastAPI - reference prices
│   └── notification-service/   Node/BullMQ - email and push worker
├── packages/
│   ├── shared-types/           the frontend/backend contract
│   ├── config/                 environment schema and constants
│   ├── validation/             shared validation schemas
│   └── utils/                  crypto, dates, ids, money
├── infrastructure/
│   ├── docker/                 one Dockerfile per deployable
│   ├── database/               init SQL and database notes
│   └── observability/          generated scrape bundle (docs/PART22_SCRAPE_SIDE.md)
├── docs/
├── scripts/
├── docker-compose.yml          reference topology; an optional observability overlay layers on it
└── .env.example
```

---

## Quick start

```bash
cp .env.example .env
./scripts/bootstrap.sh          # secrets, install, migrate, seed

npm run dev:api                 # http://localhost:4000
npm run dev:admin               # http://localhost:3000
```

Or run the whole stack:

```bash
docker compose up -d --build
```

Full detail, including manual setup and troubleshooting, is in
[docs/GETTING_STARTED.md](docs/GETTING_STARTED.md).

---

## What Part 1 delivers

### Multi-tenancy

Shared database, shared schema, isolation enforced in one place. Every query
against a tenant-owned model carries an injected `tenantId` predicate. A
client-supplied tenant id is never an authorisation input - for an authenticated
request the tenant comes from the access token.

### Authorisation

Seven system roles (`SUPER_ADMIN`, `TENANT_ADMIN`, `TRADER`, `FOLLOWER`,
`SUPPORT`, `FINANCE`, `COMPLIANCE`) ship as immutable templates that are cloned
into each tenant. Permissions are data with wildcard support, re-read live on
every request. Adding a role or a permission requires no authorisation-code
change.

### Security

argon2id passwords · JWT access tokens · rotating refresh tokens with family
reuse detection · device binding · TOTP 2FA with hashed recovery codes ·
account lockout · Redis-backed rate limiting on two buckets · Helmet and CSP ·
strict input validation · append-only audit log with hashed IPs · envelope
encryption for exchange credentials with AAD tenant binding and a documented
key-rotation path.

Details, control by control, in [docs/SECURITY.md](docs/SECURITY.md).

### Foundations

* NestJS: config, database, auth, users, tenants, RBAC, billing, feature flags,
  audit, security, notifications, realtime, queue, health - with global
  validation, a single error filter, structured logging and Swagger.
* Prisma schema: ~26 models, UUID keys, scoped uniqueness, tenant-first
  composite indexes, soft delete, deliberate cascade rules.
* Admin console: cookie-session auth through a same-origin proxy, plus
  organisations, users, roles, branding, subscription, audit log and settings.
* Mobile: config, DI, HTTP client with serialised refresh, secure storage,
  auth state, routing guards, theming from tenant branding, en/bn localisation.
* Python services: config, redacting logs, internal-token auth, health, and a
  pre-trade risk engine that evaluates and reports but cannot execute.

---

## Execution safety

Part 1 cannot place an order. Four independent gates (`docs/SECURITY.md` section 11
is the detailed copy, and it is the one a part is required to keep in step):

1. `EXECUTION_ENABLED=false` platform-wide.
2. The trading engine exposes **no** order-placement route.
3. `RiskDecision.wouldExecute = approved AND EXECUTION_ENABLED`, so an approved
   intent still reports that it would not execute.
4. The execution engine's own safety set ends in `PLACEMENT_ATTESTED` (Part 16): a
   runtime that could transmit refuses every order whose venue review it cannot
   answer, and refuses to start with no reviewer wired at all.

`EXCHANGE_SANDBOX_MODE=true` additionally disables any venue without a sandbox.

---

## Verifying the build

```bash
npm run verify   # static:  ./scripts/verify-part1.sh
npm run smoke    # dynamic: ./scripts/smoke-test.sh, needs the API running
```

`verify` checks the layout, secret hygiene, TypeScript across the API and
console, the Python test suites, and - when the stack is running - the health
endpoints and that a protected route rejects an anonymous request.

`smoke` drives a running API and asserts the security guarantees end to end:
health probes, login, refresh-token rotation with reuse detection, global
session revocation, the standard error envelope and the security headers. It
signs the test account out of all devices as part of the run, so point it at a
test account rather than a live administrator.

---

## Commands

```bash
npm install                # all workspaces
npm run build              # all workspaces
npm run typecheck          # api + admin-web
npm run test               # API unit tests

npm run prisma:generate
npm run prisma:migrate     # development
npm run prisma:deploy      # CI / production
npm run db:seed            # idempotent

npm run dev:api
npm run dev:admin
npm run dev:notification

node scripts/generate-keys.mjs           # print secrets
node scripts/generate-keys.mjs --write .env

docker compose up -d --build
docker compose logs -f api
```

Python services:

```bash
cd services/trading-engine && pip install -r requirements-dev.txt && pytest
cd services/market-data    && pip install -r requirements-dev.txt && pytest
```

Mobile:

```bash
cd apps/mobile && flutter pub get && flutter gen-l10n && flutter test
```

---

## Configuration

Every setting is an environment variable. `.env.example` documents all of them
with the reasoning for the non-obvious ones. The API validates its environment
with zod at boot and **refuses to start** on an invalid value - an API running
with a weak JWT secret is worse than an API that does not run.

Generate cryptographic material with `node scripts/generate-keys.mjs`. Use a
different set per environment.

**Never commit `.env`.** It is git-ignored, and `scripts/bootstrap.sh` sets it
to mode 600.

---

## Contributing rules

1. No secret in source. Ever. Environment variables or a secrets manager.
2. No plaintext exchange credential, in the database, in a log, or in a
   response body.
3. Never trust a client-supplied tenant id.
4. Money is `Decimal` end to end. Never a float.
5. New tenant-owned tables must be added to the tenant-scoping allowlist in the
   same commit that creates them.
6. Every privileged action writes an audit entry.
7. No simulated trading results. If the number is not real, it is not shown.

---

## Licence

Proprietary. All rights reserved.
