# White-Label Crypto Copy-Trading Platform

A production-grade, multi-tenant, **non-custodial** copy-trading platform. One
deployment serves many white-label organisations, each with its own users,
roles, branding, subscription and configuration.

Non-custodial means the platform never holds customer funds. Users connect their
own exchange accounts with trade-only API keys, and orders are placed on the
user's own account.

> **Build state (2026-09-28).** Tenancy, identity, authorisation, security,
> copy trading (leader-fill ingestion -> follower sizing -> risk -> OMS ->
> execution engine), five venue adapters, secret-manager credentials, billing,
> custody ledger and the Flutter client are all in this tree. Order
> **submission is paper/sandbox only**: live transmission stays hard-disabled
> (`EXECUTION_ENABLED=false`, engine submit route refuses non-simulated
> adapters) until a venue passes the live-enablement review in
> `docs/PART19_LIVE_ENABLEMENT.md`. There is no simulated trading performance
> anywhere in this codebase. What is and is not production-ready is listed in
> [docs/PHASE3_HANDOVER.md](docs/PHASE3_HANDOVER.md).

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
| [docs/PHASE3_HANDOVER.md](docs/PHASE3_HANDOVER.md) | current readiness, what changed in the gap-audit pass, known limits, buyer checklist |

---

## Stack

| Layer | Technology |
| --- | --- |
| Mobile | Flutter 3.22 · Riverpod · Dio · go_router · flutter_secure_storage |
| Admin console | Next.js 14 (App Router) · React 18 · TypeScript |
| Web client | Next.js 14 (App Router) · React 18 · TypeScript |
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
│   ├── web/                    Next.js end-user web client
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
npm run dev:web                 # http://localhost:3001
```

Or run the whole stack:

```bash
docker compose up -d --build
```

Full detail, including manual setup and troubleshooting, is in
[docs/GETTING_STARTED.md](docs/GETTING_STARTED.md).

---

## What the platform delivers

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
  auth state, routing guards, theming from tenant branding, en/bn localisation,
  plus strategies, risk, exchange accounts (connect / health / disable),
  copy trading (rankings, subscribe with risk acknowledgement, pause / resume /
  stop, copied-trade activity), funding (wallets, provider-issued deposit
  addresses, transactions - no withdrawals on mobile), portfolio (API facts
  only) and notifications (inbox, read state, preferences).
* Python services: config, redacting logs, internal-token auth, health, and a
  pre-trade risk engine that evaluates and reports but cannot execute.

### Trading path

* Venues: Binance, Bybit, OKX, Kraken and Coinbase (Advanced Trade) providers
  with declared capabilities; a venue that cannot do something says so.
* Copy trading: leader fills are polled (`COPY_LEADER_INGESTION_*`), fanned out
  to active subscriptions idempotently (one copy per leader event per
  subscription), sized, risk-checked and dispatched through the OMS queue to
  the execution engine. Missed or failed copies surface as reconciliation
  discrepancies (MISSING_COPY is HIGH after a 60 s grace).
* Risk: day-start-equity based daily loss, drawdown and stress calculations
  with deterministic tests; an unmeasured value is UNKNOWN, never zero.
* Credentials: envelope-encrypted in the database, or held in HashiCorp Vault
  KV v2 / AWS Secrets Manager (`credentialSource=SECRET_MANAGER`).

---

## Execution safety

No path can place a live order. Four independent gates (`docs/SECURITY.md` section 11
is the detailed copy, and it is the one a part is required to keep in step):

1. `EXECUTION_ENABLED=false` platform-wide.
2. The trading engine exposes **no** order-placement route.
3. `RiskDecision.wouldExecute = approved AND EXECUTION_ENABLED`, so an approved
   intent still reports that it would not execute.
4. The execution engine's own safety set ends in `PLACEMENT_ATTESTED` (Part 16): a
   runtime that could transmit refuses every order whose venue review it cannot
   answer, and refuses to start with no reviewer wired at all.

`EXCHANGE_SANDBOX_MODE=true` additionally disables any venue without a sandbox.

The OMS -> engine submission route (`POST /internal/v1/orders/submit`) accepts
PAPER orders only and returns 409 for any adapter that is not simulated, so the
full copy chain can be exercised end to end without touching real funds.

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

In GitHub Actions the same gates run on every push and pull request from
`../.github/workflows/ci.yml` (the repository root, one level above this project): API tests, typecheck,
console and web builds, the TypeScript SDK suite, the `ops/` and web
validators, the billing library specs in root `tests/`
(`npm run test:billing-lib`), an API dependency-injection boot check that
resolves the whole Nest graph without a database (`npm run check:api-di`), a fresh-database `prisma migrate deploy` plus schema drift check
and RLS enable/disable, and the Python suites (including the execution-engine
live Postgres tests under a non-superuser owner role so row-level security is
really enforced), the Flutter client (analyze, l10n drift, tests), the Rust
SDK (`cargo test --locked`), and Terraform (`fmt -check`, `validate`, and the
API task environment checked against the production env schema by
`scripts/check-terraform-api-env.mjs`). `../.github/workflows/production-release.yml` builds the
digest-pinned images, records them in a release manifest, waits for approval
in the `production` environment and deploys exactly those digests with
Terraform.

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
npm run dev:web
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

Settings added in the gap-audit pass (all documented in `.env.example`):

| Variable | Default | Effect |
| --- | --- | --- |
| `SECRET_MANAGER_PROVIDER`, `VAULT_*`, `SECRET_MANAGER_VAULT_*` | empty | Vault KV v2 credential store |
| `AWS_SECRETS_MANAGER_ENABLED`, `AWS_*`, `SECRET_MANAGER_AWS_*` | empty | AWS Secrets Manager credential store (SigV4, static/env credentials) |
| `COPY_LEADER_INGESTION_ENABLED` | `true` (always off under `NODE_ENV=test`) | leader-fill polling |
| `COPY_LEADER_INGESTION_INTERVAL_MS` | `5000` | poll interval |
| `COPY_LEADER_EVENT_MAX_AGE_MS` | `30000` | older fills are never copied |
| `CUSTODY_BLOCKCHAIN_PROVIDER` | empty (= `internal-ledger`) | any other value fails closed until an adapter ships |

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

Proprietary. All rights reserved. See [LICENSE](LICENSE). Third-party
dependencies remain under their own licences (see each package manifest).
