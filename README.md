# White-Label Crypto Copy-Trading App

This repository holds one product: a multi-tenant, white-label crypto
copy-trading SaaS platform. Everything that builds, tests or deploys lives in
[`whitelabel-copytrade/`](whitelabel-copytrade/); the CI and release
workflows live in [`.github/workflows/`](.github/workflows/) at this level,
because GitHub only reads workflows from the repository root.

```
.
├── .github/workflows/
│   ├── ci.yml                    every push / pull request
│   └── production-release.yml    digest-pinned images -> approval -> Terraform deploy
├── whitelabel-copytrade/         the monorepo (npm workspaces + Python + Flutter + Rust)
│   ├── apps/          api (NestJS + Prisma), web (Next.js), admin-web (Next.js), mobile (Flutter)
│   ├── services/      execution-engine, market-data, trading-engine (FastAPI),
│   │                  notification-service (Node), low-latency-gateway (Rust)
│   ├── libs/          trading-core (Python)
│   ├── packages/      shared-types, config, utils, validation, sdk-typescript, sdk-python, sdk-rust
│   ├── infrastructure/ Dockerfiles, database init SQL, staging compose
│   ├── infra/         production Terraform
│   ├── ops/           validators and production runbook material
│   ├── docs/          architecture, security, multi-tenancy, SSO, DR and per-part design notes
│   ├── scripts/       bootstrap, key generation, guards, DR tooling
│   └── tests/         billing library specs
├── README.md                     this file
├── RELEASE_MANIFEST.json         SHA-256 of every file in the release package
└── RELEASE_PACKAGE_CHECK.md      how the release package was verified
```

The detailed product README is
[`whitelabel-copytrade/README.md`](whitelabel-copytrade/README.md), and the
full manual setup guide with troubleshooting is
[`whitelabel-copytrade/docs/GETTING_STARTED.md`](whitelabel-copytrade/docs/GETTING_STARTED.md).
Every command below is run from `whitelabel-copytrade/` unless it says
otherwise.

---

## 1. Prerequisites

The versions are the ones CI pins (`.github/workflows/ci.yml`).

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | 20.11.0 (`.nvmrc`; `engines`: `>=20.11.0`) | API, web, admin-web, notification-service, SDK, scripts |
| npm | `>=10` | workspaces, `npm ci` against the committed `package-lock.json` |
| PostgreSQL | 16 or 17 | API database (`docker compose` provides `postgres`) |
| Redis | 7 | queues, throttling, SSO replay/throttle state (`docker compose` provides `redis`) |
| OpenSSL | 3.x on `PATH` | **API test suite**: SAML test keys are generated at test time |
| Python | 3.11 (`requires-python >=3.11`; the Python SDK accepts `>=3.10`) | execution-engine, market-data, trading-engine, trading-core, Python SDK |
| Flutter | 3.47.5 stable (`pubspec.yaml`: Flutter `>=3.22.0`, Dart `>=3.4.0 <4.0.0`) | mobile app |
| Rust | stable (`rust-version = "1.75"` minimum for the low-latency gateway) | Rust SDK, low-latency gateway |
| Terraform | 1.8.5 | production infrastructure validation / deployment |
| Docker + Compose v2 | current | full local stack, image builds |

---

## 2. Install

```bash
cd whitelabel-copytrade
npm ci                      # exact versions from package-lock.json, all workspaces
npm run build:packages      # shared-types, config, utils, validation (the API imports their dist/)
npm run prisma:generate     # Prisma client for apps/api
```

`npm ci` is the supported install: dependencies are pinned by the committed
lockfile and nothing in this repository needs them upgraded.

---

## 3. Environment files

Copy each template and fill it in. Real `.env` files are git-ignored and must
never be committed.

| Template | Copy to | Used by |
| --- | --- | --- |
| `.env.example` | `.env` | API, notification-service, Prisma scripts, `docker compose` |
| `apps/web/.env.example` | `apps/web/.env.local` | web client |
| `apps/admin-web/.env.example` | `apps/admin-web/.env.local` | admin console |
| `services/execution-engine/.env.example` | `services/execution-engine/.env` | execution engine |
| `services/market-data/.env.example` | `services/market-data/.env` | market-data service |
| `services/trading-engine/.env.example` | `services/trading-engine/.env` | trading engine |
| `infrastructure/.env.staging.example` | `infrastructure/.env.staging` | staging compose overlay |

The API validates its environment with zod at boot and refuses to start on an
invalid value. Production Terraform variables are declared in
`infra/production/terraform/main.tf`; the API task environment there is
checked against the API's production schema by
`node scripts/check-terraform-api-env.mjs`.

---

## 4. Key generation

Application secrets (JWT, encryption and service tokens) - unique per
environment:

```bash
node scripts/generate-keys.mjs              # print assignments to stdout
node scripts/generate-keys.mjs --write .env # write them into .env
```

`--write` fills only keys whose value is empty or starts with `change_me`, never
overwrites a configured value, and leaves the file at mode 600. It also
generates `EXECUTION_INTERNAL_TOKEN` (64 hex characters), the shared secret
`docker compose` requires for the execution engine and passes to the API and
worker as `EXECUTION_ENGINE_TOKEN`; `scripts/bootstrap.sh` runs it for you.
When it fills `POSTGRES_PASSWORD` / `REDIS_PASSWORD`, it also puts the same
password into `DATABASE_URL`, `DIRECT_DATABASE_URL` and `REDIS_URL` if those
still carry the `.env.example` placeholder (or, for Redis, no password), so
host-side tools such as `npm run db:seed` can log in to the containers that
`docker compose` initialised from those passwords.

SAML/SSO **test** keys are never committed. The API Jest run generates them
automatically through its `globalSetup`
(`apps/api/test/sso-test-keys.global-setup.js`) into the git-ignored
`apps/api/.generated/sso-test-keys/`. To generate them by hand:

```bash
node scripts/generate-test-sso-keys.mjs
```

OpenSSL must be on `PATH`. If it is missing, the generator exits non-zero and
the API test run stops at `globalSetup` with a clear message; SAML tests are
never skipped silently. Details:
[`docs/SSO.md`](whitelabel-copytrade/docs/SSO.md), section 10.

---

## 5. Database and Redis

Start PostgreSQL and Redis (or point `.env` at your own instances):

```bash
docker compose up -d postgres redis
```

Then apply the schema and seed:

```bash
npm run prisma:deploy       # applies the 20 migrations in apps/api/prisma/migrations
npm run db:seed             # idempotent demo data
```

`npm run prisma:migrate` is the development workflow (creates new migrations);
`npm run prisma:deploy` is what CI and production use. Historical migrations
are never edited.

Row-level security: the migrations create the `tenant_isolation` policies for
the 186 tenant-owned tables but do not switch RLS on. Enabling it is a DBA
step with a pre-flight checklist - `apps/api/prisma/rls/enable.sql`
(`disable.sql` rolls back, `grant.sql` is run through `psql`). Databases that
were created by an older release apply `apps/api/prisma/upgrades/*.sql` first.
See [`docs/PART11_ROW_LEVEL_SECURITY.md`](whitelabel-copytrade/docs/PART11_ROW_LEVEL_SECURITY.md).

`bash scripts/bootstrap.sh` performs install, secret generation, migration
and seeding in one idempotent run. (Files are stored without the executable
bit, so shell scripts are invoked through `bash`, as the npm scripts do.)

---

## 6. Run the applications

```bash
npm run dev:api             # NestJS API          http://localhost:4000
npm run dev:admin           # admin console       http://localhost:3000
npm run dev:web             # client web app      http://localhost:3001
npm run dev:notification    # notification service
```

Python services (each from its own directory, after copying its `.env`):

```bash
cd services/trading-engine   && pip install -r requirements-dev.txt
cd services/market-data      && pip install -r requirements-dev.txt
cd services/execution-engine && pip install -r requirements-dev.txt
```

Mobile:

```bash
cd apps/mobile
flutter pub get --enforce-lockfile
flutter gen-l10n
flutter run
```

---

## 7. Tests and validators

What CI runs, as local commands:

```bash
# Node
npm test                                    # API unit/integration suite (Jest; generates SSO test keys)
npm run test:billing-lib                    # billing library specs in tests/
npm run typecheck                           # api, admin-web, web, notification-service
npm run build:admin && npm run build:web
npm test --workspace=@wlct/web
npm run build --workspace=@wlct/sdk-typescript && npm test --workspace=@wlct/sdk-typescript

# Static guards
npm run check:api-di                        # resolves the whole Nest DI graph without a database
npm run check:prisma-literals
npm run check:route-authorization
npm run check:web-api-contract
node --test scripts/                        # script unit tests (DR, retention, key generator)

# Validators
node ops/provider-validation-50-checks.js
node ops/production-validation-50-checks.js
node ops/governance-validation-50-checks.js
node ops/partner-validation-60-checks.js
node apps/web/src/tests/run-50-checks.js
node scripts/check-terraform-api-env.mjs
node scripts/dr-manifest.mjs --check

# Python (each project directory: libs/trading-core, packages/sdk-python, services/*)
python -m pytest -q

# Mobile
cd apps/mobile && flutter analyze --no-fatal-infos && flutter test --no-pub

# Rust
cd packages/sdk-rust && cargo test --locked

# Terraform
cd infra/production/terraform && terraform fmt -check && terraform init -backend=false -lockfile=readonly && terraform validate
```

`npm run verify` (`scripts/verify-part1.sh`) runs a layout/secret/typecheck/
Python sweep; `npm run smoke` (`scripts/smoke-test.sh`) drives a running API.

The execution-engine live PostgreSQL tests need
`EXECUTION_TEST_POSTGRES_DSN` pointing at a disposable database owned by a
NOSUPERUSER role (CI creates one); without it those tests are skipped by the
suite itself.

---

## 8. Docker

```bash
docker compose up -d --build                # dev: docker-compose.yml + docker-compose.override.yml
docker compose -f docker-compose.yml up -d  # production-like posture, no dev overlay
docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d   # + Prometheus/Grafana
docker compose -f docker-compose.yml -f infrastructure/staging/docker-compose.staging.yml up -d
```

All images build with `whitelabel-copytrade/` as context from
`infrastructure/docker/*.Dockerfile`. The `migrate` service applies
migrations before the API starts.

**Verified in round 8** (Docker 26.1.5, Compose 2.26.1, a 2 GB-RAM machine
with 6 GB swap), from `whitelabel-copytrade/`:

```bash
cp .env.example .env && node scripts/generate-keys.mjs --write .env
docker compose -f docker-compose.yml build          # all 9 images
docker compose -f docker-compose.yml up -d          # migrate exits 0, 10 services up
SEED_SUPER_ADMIN_EMAIL=admin@example.com npm run db:seed   # from the host, see below
```

Result of that run: all 9 images built; `migrate` applied the 20 migrations to
the Postgres 16 container; api, web, admin-web, the four Python services,
Postgres and Redis report `healthy`; the worker logged `execution engine
compatible: mode=simulated` and `worker worker-1 online`, holds all 8
partitions (`GET /api/v1/observability/worker-coordination`: 8 claimed,
0 misaligned); `GET /health` and `/health/ready` answer 200, both web apps
serve their login page, and the seeded super administrator can log in through
`POST /api/v1/auth/login` (a wrong password gets 401).

Notes from that run:

- The API image's `nest build` needs more than Node's default heap. The
  Dockerfile sets `NODE_BUILD_HEAP_MB=6144`; lower it with
  `--build-arg NODE_BUILD_HEAP_MB=...` only on a builder that cannot provide
  it. On a small machine build the images one at a time.
- The worker has no Docker healthcheck on purpose: it serves no HTTP, and it
  exits non-zero on any start-up failure (configuration, engine compatibility
  gate, dependency graph), so `restart: unless-stopped` restarts it. A running
  worker container is a started worker; its partition claims are visible
  through the API endpoint above.
- Redis runs with `maxmemory-policy noeviction`, which BullMQ requires.
- The images contain production dependencies only, so the TypeScript seed
  runs from the host (`npm run db:seed`) against the Postgres that compose
  publishes on `127.0.0.1:5432`. Set `SEED_SUPER_ADMIN_PASSWORD` too, or the
  seed prints a generated one once.
- The seed holds `SEED_SUPER_ADMIN_PASSWORD` to the API's password policy and
  checks it before the first write. Quote the value in `.env` if it contains
  `#`: unquoted, dotenv truncates it there, and before this check the seed
  hashed the truncated password and the first login failed with 401.
- CI builds the runtime target of every image (`docker` job in
  `.github/workflows/ci.yml`, added in round 8, not yet run on GitHub), so
  a broken Dockerfile now fails a pull request instead of a release.

---

## 9. Gated features (fail-closed by default)

These ship disabled and stay disabled until an operator supplies the
licences, accounts and credentials they depend on. The defaults in
`.env.example` keep the platform in paper / sandbox mode.

| Area | Default | What turning it on requires |
| --- | --- | --- |
| Live order routing | `LIVE_TRADING_ENABLED=false`, `EXECUTION_ENABLED=false`, `PAPER_TRADING=true`, `EXCHANGE_SANDBOX_MODE=true` | exchange accounts, live enablement attestation, operator licensing |
| Live execution harness | `LIVE_EXECUTION_HARNESS_ENABLED=false` | operator-owned exchange credentials |
| Custody / on-chain | `CUSTODY_BLOCKCHAIN_PROVIDER` empty (internal ledger) | a custody provider and adapter; any other value fails closed |
| Billing / payouts | `BILLING_PROVIDER=none`, `PAYOUT_PROVIDER` empty | payment and payout provider accounts |
| KYC / AML | `KYC_PROVIDER=none`, `AML_PROVIDER` empty | provider contracts |
| Push / SMS | `PUSH_PROVIDER=none`, `SMS_PROVIDER=none` | provider accounts |
| SAML SSO | `SSO_SAML_ENABLED=false` | IdP metadata per tenant |
| Historical ingestion / streaming | `HISTORICAL_INGESTION_ENABLED=false`, `MARKET_DATA_STREAMING_ENABLED=false` | market data agreements |
| Production infrastructure | Terraform is validated, never applied by this repository | AWS account, approval in the `production` environment |

---

## 10. Known gaps

The codebase is complete for what it implements; these items are either the
buyer/operator's responsibility or acknowledged open work:

- Live order routing, custody, licensing, provider-dependent payouts, tax
  filing and `terraform apply` depend on operator accounts and are gated off
  (section 9). They cannot be completed inside this repository: each needs a
  contract, credentials or a licence that only the operator can hold.
- SSO: IdP-initiated SAML **login** is refused by design, and SAML Single
  Logout uses the HTTP-Redirect binding only (no SOAP / HTTP-POST logout).
  Interoperability against a real IdP is the operator's to test; the suite uses
  generated keys and a local test IdP.
- Deliberately kept `catch` blocks: of the 358 catch-and-answer-empty sites
  inventoried in round 8, 57 remain because they are not fail-soft storage
  reads (value parsing, cache fallbacks, provider availability probes that
  answer "unavailable", fail-closed pre-trade guards, logged write side
  effects, and two resolvers no module registers). Each file is listed with an
  exact count and its reason in `apps/api/src/common/fail-soft-reads.spec.ts`,
  so a new fail-soft read fails the test suite.
- `docs/PART*_HANDOVER_FULL_SOURCE.md` are point-in-time records of each part
  and are intentionally not regenerated; `docs/source/` is regenerated.

Closed in round 7 (previously listed here): per-tenant idempotency keys (68
tables, with migration); observable reconciliation read fallbacks; statement
visibility before pagination; custody scope from permissions; the Prisma
filter's SQLSTATE mapping; per-follower kill-switch matching; `GET` single
withdrawal; `ENFORCED` SSO blocking password login; tenant-admin SSO
configuration with a lock-out guard; opt-in encrypted SAML assertions; OIDC
RP-initiated logout; the admin billing portal, plan catalogue and SaaS tenant
screens mounted on the real API; compose variables and the required execution
engine token in `.env.example` / `generate-keys.mjs`; executable shell
scripts; an up-to-date source-dump generator.

Closed in round 8: failed database reads are errors, not empty answers (266
fail-soft wrappers removed, 9 changed to log and rethrow, 26 narrowed to "row
not found" only; fail-open security reads such as restriction, period-close,
session-revocation and SSO-enforcement checks now fail closed; reconciliation
reports FAILED and health reports UNKNOWN instead of SUCCEEDED / HEALTHY when
they cannot read); the four admin-console `exhaustive-deps` warnings (lint is
clean); SAML Single Logout, SP- and IdP-initiated (`docs/SSO.md` section 3);
SSO logins completed through 2FA now keep their SSO origin; and the web login
button no longer hardcodes OIDC, so SAML-only tenants can start SSO from the
web.

Also closed in round 8, found by building and running the Docker stack for the
first time (section 8): the API image build (heap, missing COPY source), both
engine images (invalid pip flag), `migrate` reaching the database
(`DIRECT_DATABASE_URL`), Redis eviction policy (also in production Terraform),
and the trade-execution worker, which had never started: its dependency graph
did not resolve, its engine compatibility gate refused every real engine
because the TypeScript `/status` mirror named keys the engine never sends,
its refusal reasons were never written to the log, and a refusing worker kept
running instead of exiting. Each now has a check that fails if it returns
(`check-api-di.mjs` resolves the worker; the parity spec reads the engine's
Python source; the CI `docker` job builds the images).

The full, current list is in `RELEASE_MANIFEST.json` (`known_unresolved`) and
`RELEASE_PACKAGE_CHECK.md`.

## Licence

See [`whitelabel-copytrade/LICENSE`](whitelabel-copytrade/LICENSE).
