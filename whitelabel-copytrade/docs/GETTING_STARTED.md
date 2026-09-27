# Getting started

Local setup, from a clean checkout to a running stack.

## Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | 20.11.0 (see `.nvmrc`) | API, admin console, notification worker |
| npm | 10+ | workspaces |
| Docker + Compose v2 | recent | Postgres, Redis, the full stack |
| Python | 3.11 | trading-engine, market-data (only if run outside Docker) |
| Flutter | 3.22+ | mobile client (optional) |

## Quick start

```bash
git clone <your-repository-url> whitelabel-copytrade
cd whitelabel-copytrade

./scripts/bootstrap.sh
```

`bootstrap.sh` is idempotent. It creates `.env` from `.env.example`, fills any
placeholder secret, installs dependencies, generates the Prisma client, starts
Postgres and Redis, applies migrations and seeds baseline data. It never
overwrites a value that already looks configured.

Then:

```bash
npm run dev:api            # http://localhost:4000  (docs at /docs)
npm run dev:admin          # http://localhost:3000
```

## Manual setup

If you would rather do it step by step:

### 1. Environment

```bash
cp .env.example .env
chmod 600 .env
node scripts/generate-keys.mjs --write .env
```

Every variable that still reads `change_me` must be replaced before the API will
start - the environment is validated by zod at boot, and an invalid value aborts
the process rather than degrading silently.

Minimum set for a local run:

```
DATABASE_URL, REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
ENCRYPTION_MASTER_KEY_BASE64, ENCRYPTION_KEY_ID, BLIND_INDEX_KEY_BASE64
INTERNAL_SERVICE_TOKEN
SESSION_COOKIE_SECRET
```

### 2. Dependencies

```bash
npm install                # installs every workspace
```

### 3. Data stores

```bash
docker compose up -d postgres redis
```

Or point `DATABASE_URL` and `REDIS_*` at your own instances.

### 4. Database

```bash
npm run prisma:generate    # generate the client
npm run prisma:migrate     # create and apply a migration (development)
npm run db:seed            # system roles, permissions, platform plans, admins
```

For a non-development environment use `npm run prisma:deploy`, which applies
existing migrations without generating new ones. `npm run prisma:reset` drops
and rebuilds a scratch database.

Two things about these commands are worth knowing:

* **They load the root `.env` explicitly.** Every Prisma script is wrapped in
  `dotenv -e ../../.env --`. The Prisma CLI only looks for a `.env` next to the
  schema or in the current working directory, and these scripts run inside
  `apps/api`, so without the wrapper the whole monorepo would need a second copy
  of its environment file. Running `npx prisma` by hand from `apps/api` will
  therefore fail with `Environment variable not found` - use the npm scripts, or
  pass `--schema` from the repository root.
* **`DIRECT_DATABASE_URL` must be set**, even with no connection pooler in play.
  `schema.prisma` declares `directUrl`, and Prisma validates that the variable
  exists before it does anything else (error `P1012`). With no pooler it is just
  `DATABASE_URL` without the `connection_limit`/`pool_timeout` parameters.

The seed is idempotent - running it twice changes nothing. It creates:

* the 7 system roles with their permission sets
* the platform tenant and its branding
* the three platform plans (`starter`, `growth`, `enterprise`)
* a super-admin from `SEED_SUPER_ADMIN_*`
* a demo tenant and its admin from `SEED_TENANT_ADMIN_*`

Change those passwords in `.env` before seeding anything you will keep.

### 5. Run

```bash
npm run dev:api                 # NestJS, watch mode
npm run dev:admin               # Next.js
npm run dev:notification        # BullMQ worker
```

Python services, outside Docker:

```bash
cd services/trading-engine
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env            # set INTERNAL_SERVICE_TOKEN to match the root .env
uvicorn app.main:app --reload --port 8001
```

```bash
cd services/market-data
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8002
```

### 6. Mobile

```bash
cd apps/mobile
flutter pub get
flutter gen-l10n

flutter run \
  --dart-define=APP_ENV=development \
  --dart-define=API_BASE_URL=http://10.0.2.2:4000/api \
  --dart-define=TENANT_SLUG=platform
```

`10.0.2.2` is the host loopback from the Android emulator; use `localhost` on
the iOS simulator.

`android/` and `ios/` are not committed. Generate them once:

```bash
flutter create --platforms=android,ios --org com.yourcompany .
```

## Full stack in Docker

```bash
docker compose up -d --build          # includes the development overlay
docker compose -f docker-compose.yml up -d --build   # production-like
```

Both commands start three Python services (`trading-engine`, `market-data`,
`execution-engine`), and until Part 18 none of the three images could reach the
point of serving: each Dockerfile passed `--log-config /dev/null`, uvicorn hands a
non-`.json`/`.yaml` path to `logging.config.fileConfig`, and that refuses a
zero-length file (`RuntimeError: /dev/null is an empty file`, true since at least
python 3.11.9). They now pass `--log-config ./log-config.json` - two no-op keys
that keep uvicorn from reconfiguring the app's JSON log pipeline.
`execution-engine` needed one more thing: its module exposes `create_app` and
deliberately no module-level `app`, so the `app.main:app` target its image named
resolved to nothing (the two siblings bind `app`, so their plain form is correct);
its command is now `uvicorn --factory app.main:create_app`. A test loads all three
image commands through uvicorn's own constructor -
`services/execution-engine/tests/test_part18_asgi_target.py` - so a recurrence
fails a suite instead of a deployment. The reasoning is in
`docs/PART18_METRICS_EXPOSITION.md` sec. 6.1.

### The Part 19 knobs, and what a first deployment should leave alone

`services/execution-engine/.env.example` documents thirteen variables Part 19 added -
one fetcher selector (`EXECUTION_CREDENTIAL_FETCHER`), eight for Vault KV v2
(`EXECUTION_VAULT_ADDR`, `..._MOUNT`, `..._PATH_TEMPLATE`, `..._TOKEN_ENV`,
`..._NAMESPACE`, `..._TIMEOUT_MS`, `..._TLS_VERIFY`, `..._MAX_RESPONSE_BYTES`) and four
for the operator confirmation (`EXECUTION_REQUIRE_OPERATOR_CONFIRMATION`,
`..._OPERATOR_CONFIRMATION_JSON`, `..._OPERATOR_CONFIRMATION_FILE`,
`EXECUTION_CONFIRMATION_KEY_ENV`). Every one of them defaults to the dark side, none
of them opens the money path, and the two key variables are deliberately absent from
`docker-compose.yml` - a compose file is a place secrets get copied from, and these
values are read from the process environment of the container that needs them.

### The two operational commands worth knowing (Part 20)

Nothing to configure - this part adds no environment variable at all. Two commands, both
read-only, both runnable today:

```bash
node scripts/dr-manifest.mjs --check-schedule   # is the DR watcher installed and current?
node scripts/dr-manifest.mjs --due              # what is overdue on the backup board?
```

`--check-schedule` fails when `docs/dr/schedule/dr.cron` no longer matches what
`docs/dr/manifest.json` implies, which is the difference between a control and a document;
installing it is `node scripts/dr-manifest.mjs --emit-schedule --root /srv/path --out
/tmp/dr.cron && crontab /tmp/dr.cron`, and the schedule never writes ledger evidence on
your behalf (that is the point: `--record` names a human).

For the engine's posture, the document to read is the one the worker reads. Dev-run, on
the port `docs/PART11_WORKER_SCALING.md` uses:

```bash
curl -s -H "x-internal-token: $EXECUTION_INTERNAL_TOKEN" \
  localhost:8093/internal/v1/status | python3 -m json.tool
```

Twenty keys, no secrets among them, and since Part 20 they need no tenant header (the
route reads the process, not a tenant - `docs/PART20_ENGINE_STATUS_EDGE.md` sec. 7 for
why, and `docs/SECURITY.md` sec. 14 for the exemption's bounds). The same block is
rendered for operators as the `ENGINE POSTURE` section of
`GET /v1/observability/execution`, which sits behind an operations-read session rather
than a curl: it is a panel row, and a panel row that could not answer says
`unverified` instead of guessing.

What a first deployment should actually set: nothing here. What a deployment that wants
its review to have real evidence to reason over should set: `EXECUTION_CREDENTIAL_SOURCE`
(plus a fetcher if the source is `secret-manager`), so the credential lookup can be made,
and `EXECUTION_STORE_BACKEND=postgres` once the migration has run. The confirmation is the
last item, not the first: it is a record a human signs about a specific symbol and order
type, and minting one before the review above it has real evidence produces an approval of
nothing in particular. `docs/PART19_LIVE_ENABLEMENT.md` is the operational document -
sec. 5 is the minting ceremony with the exact bytes, sec. 9 is the order to turn the pieces
on, sec. 10 is the refusal catalogue for when a boot says no.

| Service | Address |
| --- | --- |
| API | http://localhost:4000 |
| Admin console | http://localhost:3000 |
| Swagger (when `SWAGGER_ENABLED=true`) | http://localhost:4000/docs |
| Postgres | 127.0.0.1:5432 |
| Redis | 127.0.0.1:6379 |

`trading-engine`, `market-data` and `notification-service` are internal-only in
the production composition. The development overlay publishes them on loopback
so you can probe them directly.

## Verifying

Two scripts, with different jobs.

`scripts/verify-part1.sh` is static: it inspects the repository (layout, secret
hygiene, TypeScript, Python tests) and does not need a running stack.

```bash
./scripts/verify-part1.sh
```

`scripts/smoke-test.sh` is dynamic: it drives a **running** API and asserts real
behaviour - health probes, login, refresh-token rotation and reuse detection,
global session revocation, the error envelope, and the security headers. It
exits non-zero on the first broken guarantee, so it can gate a deployment.

```bash
npm run smoke                       # against http://127.0.0.1:4000
API_URL=https://api.example.com npm run smoke
```

It reads `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` from `.env`.
Note that it deliberately triggers refresh-token reuse detection, which signs
that account out of every device - run it against a test account, never against
a live administrator.

Manual smoke test:

```bash
curl -s localhost:4000/health | jq
curl -s localhost:4000/health/ready | jq

# Sign in as the seeded super admin.
curl -s -X POST localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -H 'x-tenant-slug: platform' \
  -d '{"email":"superadmin@copytrade.app","password":"<your seed password>","deviceId":"curl-local-device"}' | jq

# Anonymous access to a protected route must be 401.
curl -s -o /dev/null -w '%{http_code}\n' localhost:4000/api/v1/users
```

## Common problems

**`Environment validation failed`** - a required variable is missing or too
short. The message lists each offending variable. Run
`node scripts/generate-keys.mjs`.

**`Can't reach database server`** - Postgres is not up, or `DATABASE_URL` points
at `localhost` while the API runs inside Docker (it should be `postgres`).

**`P3005: database schema is not empty`** - the database has tables but no
migration history. For a scratch database: `npm run prisma:reset -w @wlct/api`.

**Admin console shows "The platform API is unreachable"** - `API_BASE_URL` is
wrong. It must include the `/api` prefix: `http://localhost:4000/api`.

**`ENOTEMPTY` during `npm install`** - a previous install was interrupted.
`rm -rf node_modules package-lock.json apps/*/node_modules services/*/node_modules packages/*/node_modules`
then reinstall.

**Flutter: `Target of URI doesn't exist: app_localizations.dart`** - run
`flutter gen-l10n`. The file is generated and intentionally not committed.

## Useful commands

```bash
npm run build                  # every workspace
npm run typecheck              # api + admin-web
npm run lint
npm run test                   # API unit tests
npm run prisma:studio          # database browser

docker compose logs -f api
docker compose down -v         # stop and delete volumes (destroys data)
```
