# Repository root

Workspace wiring, the shared TypeScript base config, the complete environment reference and the Compose topology.

11 files. Part of the complete Part 1 source dump - see `docs/source/README.md`.

---

FILE: .dockerignore

```gitignore
node_modules
**/node_modules
dist
**/dist
.next
**/.next
build
**/build
coverage
.git
.gitignore
*.log
logs
.env
.env.*
!.env.example
apps/mobile/build
apps/mobile/.dart_tool
__pycache__
**/__pycache__
.venv
**/.venv
```

FILE: .editorconfig

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false

[*.{py,dart}]
indent_size = 4
```

FILE: .env.example

```ini
# =============================================================================
# WHITE-LABEL CRYPTO COPY-TRADING PLATFORM - ENVIRONMENT CONFIGURATION
# =============================================================================
# Copy to .env and fill in real values. NEVER commit .env.
# Generate cryptographic material with: npm run keys:generate
# =============================================================================

# -----------------------------------------------------------------------------
# APPLICATION
# -----------------------------------------------------------------------------
NODE_ENV=development
APP_NAME=WhiteLabelCopyTrade
API_PORT=4000
API_HOST=0.0.0.0
API_GLOBAL_PREFIX=api
API_DEFAULT_VERSION=1
# Public base URL of the API (used in emails, webhooks, OpenAPI servers)
API_PUBLIC_URL=http://localhost:4000
# Public base URL of the admin web application
ADMIN_WEB_URL=http://localhost:3000
# Host port the admin console is published on by Docker Compose.
ADMIN_WEB_PORT=3000
# Trust N reverse proxy hops (nginx/ALB). 0 disables proxy trust.
TRUST_PROXY_HOPS=1
# Root domain used to resolve tenants from sub-domains: acme.copytrade.app
PLATFORM_ROOT_DOMAIN=copytrade.app
# Fallback tenant slug used when a request carries no resolvable tenant context
DEFAULT_TENANT_SLUG=platform

# -----------------------------------------------------------------------------
# DATABASE (PostgreSQL)
# -----------------------------------------------------------------------------
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=copytrade
POSTGRES_PASSWORD=change_me_postgres_password
POSTGRES_DB=copytrade
POSTGRES_SCHEMA=public
# Password for the least-privilege runtime role created by
# infrastructure/database/init/02-roles.sql. Leave blank to skip role creation.
POSTGRES_APP_PASSWORD=
# Prisma connection string. Inside docker-compose use host "postgres".
DATABASE_URL=postgresql://copytrade:change_me_postgres_password@localhost:5432/copytrade?schema=public&connection_limit=20&pool_timeout=20
# REQUIRED, not optional. schema.prisma declares `directUrl`, and Prisma refuses
# to run ANY migrate/generate command when the variable is missing (error P1012)
# even though the application itself never reads it. Point it at the database
# directly, bypassing any connection pooler (PgBouncer, RDS Proxy) and without
# the pooling query parameters, so DDL runs on a real session. With no pooler in
# front of PostgreSQL it is simply DATABASE_URL minus connection_limit/pool_timeout.
DIRECT_DATABASE_URL=postgresql://copytrade:change_me_postgres_password@localhost:5432/copytrade?schema=public
DATABASE_LOG_QUERIES=false
DATABASE_SSL=false

# -----------------------------------------------------------------------------
# REDIS (cache, rate limiting, queues, websocket adapter)
# -----------------------------------------------------------------------------
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_TLS=false
REDIS_KEY_PREFIX=wlct:
REDIS_URL=redis://localhost:6379/0

# -----------------------------------------------------------------------------
# JWT / AUTHENTICATION
# -----------------------------------------------------------------------------
# Asymmetric signing is recommended in production (RS256). For HS256 provide secrets.
JWT_ALGORITHM=HS256
JWT_ACCESS_SECRET=change_me_access_secret_min_32_chars_long
JWT_REFRESH_SECRET=change_me_refresh_secret_min_32_chars_long
# Base64-encoded PEM keys, required when JWT_ALGORITHM=RS256
JWT_PRIVATE_KEY_BASE64=
JWT_PUBLIC_KEY_BASE64=
JWT_ACCESS_TTL=900s
JWT_REFRESH_TTL=30d
JWT_ISSUER=https://api.copytrade.app
JWT_AUDIENCE=copytrade-clients
# Maximum concurrent active sessions (devices) per user
MAX_ACTIVE_SESSIONS_PER_USER=10

# Password policy / hashing (argon2id)
PASSWORD_MIN_LENGTH=12
ARGON2_MEMORY_COST=19456
ARGON2_TIME_COST=2
ARGON2_PARALLELISM=1

# Account protection
LOGIN_MAX_FAILED_ATTEMPTS=5
LOGIN_FAILED_WINDOW_SECONDS=900
ACCOUNT_LOCKOUT_SECONDS=900

# -----------------------------------------------------------------------------
# ENCRYPTION (exchange API credential envelope encryption)
# -----------------------------------------------------------------------------
# 32-byte key, base64 encoded. Key Encryption Key used to wrap per-record DEKs.
ENCRYPTION_MASTER_KEY_BASE64=
# Identifier of the active master key; enables zero-downtime key rotation.
ENCRYPTION_KEY_ID=local-dev-v1
# Previous keys kept for decrypt-only, JSON map: {"local-dev-v0":"<base64key>"}
ENCRYPTION_PREVIOUS_KEYS_JSON={}
# kms | local  -> "kms" delegates KEK operations to a managed KMS provider
ENCRYPTION_PROVIDER=local
KMS_PROVIDER=
KMS_KEY_ARN=
# Deterministic HMAC key used to build blind indexes (lookup on encrypted values)
BLIND_INDEX_KEY_BASE64=

# -----------------------------------------------------------------------------
# TWO-FACTOR AUTHENTICATION (TOTP)
# -----------------------------------------------------------------------------
TWO_FACTOR_ISSUER=CopyTrade
TWO_FACTOR_WINDOW=1
TWO_FACTOR_DIGITS=6
TWO_FACTOR_PERIOD=30
TWO_FACTOR_RECOVERY_CODES=10
# Short-lived token issued between password step and 2FA step
TWO_FACTOR_CHALLENGE_TTL=300s
# Wrong codes tolerated per challenge token before it is discarded.
TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS=5

# -----------------------------------------------------------------------------
# CORS
# -----------------------------------------------------------------------------
CORS_ENABLED=true
CORS_ORIGINS=http://localhost:3000,http://localhost:4000
CORS_CREDENTIALS=true
CORS_ALLOWED_HEADERS=Content-Type,Authorization,X-Tenant-Slug,X-Request-Id,X-Api-Version,Accept-Language,X-2FA-Token
CORS_EXPOSED_HEADERS=X-Request-Id,X-RateLimit-Limit,X-RateLimit-Remaining,X-RateLimit-Reset

# -----------------------------------------------------------------------------
# RATE LIMITING
# -----------------------------------------------------------------------------
RATE_LIMIT_ENABLED=true
RATE_LIMIT_TTL_SECONDS=60
RATE_LIMIT_MAX=120
RATE_LIMIT_AUTH_TTL_SECONDS=300
RATE_LIMIT_AUTH_MAX=10
RATE_LIMIT_TRUSTED_IPS=127.0.0.1,::1

# -----------------------------------------------------------------------------
# SWAGGER / OPENAPI
# -----------------------------------------------------------------------------
SWAGGER_ENABLED=true
SWAGGER_PATH=docs
SWAGGER_TITLE="White-Label Copy Trading API"
SWAGGER_DESCRIPTION="Multi-tenant non-custodial crypto copy-trading platform API"
SWAGGER_VERSION=1.0.0
# Optional basic-auth protection for the docs route in non-local environments
SWAGGER_USER=
SWAGGER_PASSWORD=

# -----------------------------------------------------------------------------
# LOGGING
# -----------------------------------------------------------------------------
LOG_LEVEL=debug
# json | pretty. Set ONCE, here: both planes read the same name and this file keeps one
# active assignment per knob, because dotenv honours the first of a repeated key while
# docker compose's env_file honours the last - two assignments would make the deployed
# answer a loader detail. The "SHARED LOGGING" section below states the policy (`json`
# in every deployed environment, `pretty` for a local terminal), so that is the value.
LOG_FORMAT=json
LOG_REQUEST_BODY=false
LOG_SAMPLE_RATE=1
SENTRY_DSN=

# -----------------------------------------------------------------------------
# WEBSOCKET
# -----------------------------------------------------------------------------
WS_ENABLED=true
WS_PATH=/realtime
WS_NAMESPACE=/v1
WS_PING_INTERVAL_MS=25000
WS_PING_TIMEOUT_MS=20000
WS_MAX_CONNECTIONS_PER_USER=5
# Redis adapter lets many API replicas share socket rooms
WS_REDIS_ADAPTER=true

# -----------------------------------------------------------------------------
# BULLMQ / BACKGROUND JOBS
# -----------------------------------------------------------------------------
QUEUE_PREFIX=wlct-queue
QUEUE_DEFAULT_ATTEMPTS=5
QUEUE_BACKOFF_MS=5000
QUEUE_REMOVE_ON_COMPLETE=1000
QUEUE_REMOVE_ON_FAIL=5000
QUEUE_CONCURRENCY=10
# Enable the in-process worker (single-container dev). Disable when running the dedicated worker.
QUEUE_RUN_INLINE_WORKERS=true
BULL_BOARD_ENABLED=false
BULL_BOARD_PATH=admin/queues

# -----------------------------------------------------------------------------
# EXCHANGE INTEGRATIONS (non-custodial: user-supplied trade-only API keys)
# -----------------------------------------------------------------------------
# Comma separated list of exchanges enabled platform-wide
EXCHANGES_ENABLED=binance,bybit,okx,kraken
EXCHANGE_SANDBOX_MODE=true
EXCHANGE_REQUEST_TIMEOUT_MS=10000
EXCHANGE_MAX_RETRIES=3
# Hard safety switch. Order execution remains disabled: the connectivity layer
# delivers market data only, and no order-placement adapter is registered.
EXECUTION_ENABLED=false
# Internal service endpoints
TRADING_ENGINE_URL=http://localhost:8001
TRADING_ENGINE_HEALTH_PATH=/health
MARKET_DATA_URL=http://localhost:8002
MARKET_DATA_HEALTH_PATH=/health
NOTIFICATION_SERVICE_URL=http://localhost:8003
NOTIFICATION_SERVICE_HEALTH_PATH=/health
# Shared secret for service-to-service authentication (mTLS recommended in prod)
INTERNAL_SERVICE_TOKEN=change_me_internal_service_token
# Signing secret used to verify inbound exchange webhooks
EXCHANGE_WEBHOOK_SIGNING_SECRET=change_me_webhook_secret

# -----------------------------------------------------------------------------
# EXCHANGE CONNECTIVITY (libs/trading-core: wlct_trading.transport / .exchanges)
# -----------------------------------------------------------------------------
# These tune the realtime market-data connectivity layer. They contain no
# credentials: public market data needs none, and user exchange API keys are
# stored encrypted per trading account in PostgreSQL, never in the environment.
#
# Only venues with an implemented adapter can be selected. Naming a venue here
# that has no adapter fails fast at startup rather than at the first order.
EXCHANGE_MARKET_DATA_VENUES=binance
# Use the venue testnet endpoints. Keep true outside production.
EXCHANGE_USE_TESTNET=true

# --- Order-book synchronisation ---
# Depth requested for the REST snapshot. Rounded up to a depth the venue
# accepts. Deeper snapshots cost significantly more rate-limit weight
# (Binance spot: 100 levels = 5 weight, 1000 = 50, 5000 = 250).
ORDERBOOK_SNAPSHOT_DEPTH=1000
# Diffs buffered while a snapshot is in flight. Bounds memory: at 100 msg/s
# this is roughly 50 seconds of runway.
ORDERBOOK_MAX_BUFFERED_DELTAS=5000
# Resync attempts before a book is marked FAILED and refuses to serve quotes.
# It never silently serves a book it could not verify.
ORDERBOOK_MAX_RESYNC_ATTEMPTS=10
# A book quiet for longer than this is treated as stale and is not tradeable.
ORDERBOOK_STALENESS_THRESHOLD_MS=5000

# --- Websocket connection management ---
# These are read by the live transport (wlct_trading.net); the Part 3 library
# itself reads no environment at all.
WEBSOCKET_CONNECT_TIMEOUT_MS=10000
WS_HEARTBEAT_INTERVAL_MS=20000
# Silence after which the socket is considered dead and rebuilt. MUST be
# greater than WS_HEARTBEAT_INTERVAL_MS or healthy connections get killed.
WEBSOCKET_HEARTBEAT_TIMEOUT_MS=90000
# Reconnect backoff: capped exponential with full jitter. Jitter is not
# optional in production - without it every connection retries in lockstep
# after a venue blip and the reconnect storm is self-inflicted.
WS_RECONNECT_BASE_DELAY_MS=500
WS_RECONNECT_MAX_DELAY_MS=30000
WS_RECONNECT_MAX_ATTEMPTS=20
# Binance drops stream connections at 24h; cycling early makes it planned.
WS_CONNECTION_MAX_LIFETIME_SECONDS=82800

# --- Staleness thresholds (per channel, milliseconds) ---
# Trades are legitimately sporadic on thin symbols; an order book going quiet
# is not. Thresholds differ so neither alert is useless.
STALENESS_ORDER_BOOK_MS=5000
STALENESS_BOOK_TICKER_MS=5000
STALENESS_TICKER_MS=10000
STALENESS_TRADES_MS=60000
STALENESS_CANDLES_MS=120000
STALENESS_CONNECTION_MS=30000

# --- Rate limiting (venue-published values; lower them, never raise them) ---
# Binance spot: 6000 request weight per minute per IP.
BINANCE_REQUEST_WEIGHT_PER_MINUTE=6000
# 5 inbound messages per second per socket, counting PING/PONG and every
# subscribe frame. Exceeding it disconnects; repeat offenders get IP-banned.
BINANCE_WS_MESSAGES_PER_SECOND=5
BINANCE_MAX_STREAMS_PER_CONNECTION=1024
# Metrics scrape interval for the connectivity layer.
CONNECTIVITY_METRICS_INTERVAL_SECONDS=15

# -----------------------------------------------------------------------------
# LIVE MARKET DATA TRANSPORT (libs/trading-core: wlct_trading.net)
# -----------------------------------------------------------------------------
# The concrete websocket and HTTP clients behind the Part 3 abstractions.
#
# PUBLIC MARKET DATA ONLY. Nothing in this section is a credential and nothing
# on this code path can accept one: the market-data adapter has no API-key
# parameter, no request is signed, and no order is ever submitted. Live order
# execution is NOT implemented.
#
# Endpoints. Both must be TLS - the service refuses to start on ws:// or
# http://, because market data an attacker can rewrite is a way to induce bad
# trades. When EXCHANGE_USE_TESTNET=true and these are left unset, the venue's
# testnet endpoints are used automatically.
BINANCE_WS_URL=wss://stream.binance.com:9443
BINANCE_REST_URL=https://api.binance.com

# Symbols to stream. Accepts BTC/USDT, BTC-USDT or BTCUSDT; all three are
# normalised to the canonical BASE-QUOTE form and then validated against the
# venue's own instrument list, so a typo or a delisted market fails at startup
# rather than producing a socket that is silent forever. The value is assigned
# once, in the MARKET DATA service section below, and this transport and
# services/market-data read that one number: two assignments of one name in one
# file is how a shared knob stops being shared.

# Channels. Each enabled channel adds one stream per symbol to the single
# shared connection (Binance allows 1024 streams per socket).
# "ticker" is the bookTicker stream: best bid/ask on every book change, which
# is what the risk engine's price checks need. The 1-second rolling ticker is a
# statistics feed, not a quote feed.
MARKET_DATA_TICKER_ENABLED=true
MARKET_DATA_TRADES_ENABLED=true
MARKET_DATA_ORDERBOOK_ENABLED=true

# Websocket timeouts. WEBSOCKET_RECEIVE_TIMEOUT_MS is a backstop below the
# heartbeat, not the primary liveness check: a thin symbol's trade stream can
# legitimately be silent for minutes, and the venue's protocol pings are
# answered by the client library without ever surfacing as a message. Set it
# too low and a healthy but quiet connection is torn down in a loop.
WEBSOCKET_RECEIVE_TIMEOUT_MS=300000
# Client-initiated ping cadence and its response deadline. Binance pings every
# 3 minutes and disconnects after 10 without a pong; this is the reverse
# direction, used to notice a peer that has gone away silently.
WEBSOCKET_PING_INTERVAL_MS=180000
WEBSOCKET_PING_TIMEOUT_MS=60000
WEBSOCKET_CLOSE_TIMEOUT_MS=5000
# Frame size ceiling. An unbounded reader is a memory-exhaustion vector.
WEBSOCKET_MAX_FRAME_BYTES=8388608

# HTTP timeouts for REST snapshots. Every request is bounded by all three;
# there is no code path that produces an unbounded wait.
HTTP_CONNECT_TIMEOUT_MS=5000
HTTP_READ_TIMEOUT_MS=10000
HTTP_TOTAL_TIMEOUT_MS=15000
# Retries are bounded and only fire for categories the retry policy calls
# retryable. A 400 is never retried; a 429 honours the venue's Retry-After.
HTTP_MAX_RETRIES=3
HTTP_MAX_CONNECTIONS=20

# Duration of the separately invoked live smoke test
# (scripts/live_market_data_smoke_test.py). That script is the only thing in
# the repository that touches a real exchange; the normal test suite needs no
# internet, credentials, database or Redis.
LIVE_MARKET_DATA_SMOKE_TEST_DURATION_SECONDS=30

# -----------------------------------------------------------------------------
# EMAIL
# -----------------------------------------------------------------------------
# console | smtp (implemented). ses and postmark are planned; selecting an
# unimplemented driver fails fast instead of dropping mail silently.
MAIL_DRIVER=console
MAIL_FROM_NAME=CopyTrade
MAIL_FROM_ADDRESS=no-reply@copytrade.app
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=

# -----------------------------------------------------------------------------
# NOTIFICATIONS (push / sms / webhooks)
# -----------------------------------------------------------------------------
NOTIFICATIONS_ENABLED=true
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY_BASE64=
TELEGRAM_BOT_TOKEN=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=

# -----------------------------------------------------------------------------
# LOCALIZATION / CURRENCY
# -----------------------------------------------------------------------------
DEFAULT_LOCALE=en
SUPPORTED_LOCALES=en,es,ar,bn,tr
DEFAULT_CURRENCY=USD
SUPPORTED_CURRENCIES=USD,EUR,GBP,AED,BDT,TRY
FX_RATES_PROVIDER=none
FX_RATES_API_KEY=

# -----------------------------------------------------------------------------
# KYC (architecture only in Part 1)
# -----------------------------------------------------------------------------
# none | sumsub | onfido | shufti
KYC_PROVIDER=none
KYC_API_URL=
KYC_APP_TOKEN=
KYC_SECRET_KEY=
KYC_WEBHOOK_SECRET=

# -----------------------------------------------------------------------------
# PAYMENTS / BILLING (architecture only in Part 1)
# -----------------------------------------------------------------------------
# none | stripe | nowpayments
BILLING_PROVIDER=none
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NOWPAYMENTS_API_KEY=
NOWPAYMENTS_IPN_SECRET=

# -----------------------------------------------------------------------------
# BOOTSTRAP / SEED (development only)
# -----------------------------------------------------------------------------
# QUOTING: always wrap a value in double quotes if it contains '#', a space, or
# any shell metacharacter. The '#' case is the one that bites: dotenv-cli treats
# an unquoted '#' as the start of a comment and silently truncates the value,
# while sourcing the same file from bash (`set -a; . .env`) keeps it intact.
# The two then disagree, so the password the seed hashes is not the password
# your scripts send, and you get an inexplicable 401 followed by a lockout.
#   WRONG: SEED_SUPER_ADMIN_PASSWORD=My_P4ss#2026   -> becomes "My_P4ss"
#   RIGHT: SEED_SUPER_ADMIN_PASSWORD="My_P4ss#2026"
SEED_SUPER_ADMIN_EMAIL=superadmin@copytrade.app
SEED_SUPER_ADMIN_PASSWORD="ChangeMe_Str0ng!Pass"
SEED_TENANT_ADMIN_EMAIL=admin@acme-capital.test
SEED_TENANT_ADMIN_PASSWORD=ChangeMe_Str0ng!Pass

# -----------------------------------------------------------------------------
# ADMIN WEB (Next.js) - consumed by apps/admin-web
# -----------------------------------------------------------------------------
# Server-side base URL used by Next route handlers and server components to
# reach the API. Inside Docker Compose this becomes http://api:4000/api.
API_BASE_URL=http://localhost:4000/api
# Organisation the console administers when no custom domain is in play.
ADMIN_TENANT_SLUG=platform
# Salt for the console's session cookies. Generate: openssl rand -base64 32
SESSION_COOKIE_SECRET=change_me_admin_session_secret_min_16_chars

# Browser-visible values only. Never place a secret behind NEXT_PUBLIC_.
NEXT_PUBLIC_APP_NAME="CopyTrade Admin"
NEXT_PUBLIC_API_VERSION=v1
NEXT_PUBLIC_WS_URL=http://localhost:4000
NEXT_PUBLIC_WS_PATH=/socket.io
NEXT_PUBLIC_DEFAULT_LOCALE=en

# -----------------------------------------------------------------------------
# TRADING ENGINE (services/trading-engine, Python/FastAPI, port 8001)
# -----------------------------------------------------------------------------
TRADING_ENGINE_HOST=0.0.0.0
TRADING_ENGINE_PORT=8001

# Pre-trade risk ceilings. These are hard caps enforced by the engine on every
# order intent; they are not user-configurable from the client.
MAX_ORDER_NOTIONAL_USD=1000
MAX_OPEN_POSITIONS_PER_ACCOUNT=20
MAX_LEVERAGE=5

# -----------------------------------------------------------------------------
# MARKET DATA (services/market-data, Python/FastAPI, port 8002)
# -----------------------------------------------------------------------------
MARKET_DATA_HOST=0.0.0.0
MARKET_DATA_PORT=8002
# Public reference-price sources, tried in order. No credentials are used.
MARKET_DATA_SOURCES=binance,bybit
# The only active assignment of this name: the LIVE MARKET DATA TRANSPORT section
# above explains the accepted spellings and the validation, and both readers -
# services/market-data and that transport - take the value from here.
MARKET_DATA_SYMBOLS=BTC/USDT,ETH/USDT,SOL/USDT
MARKET_DATA_POLL_INTERVAL_SECONDS=5
# A cached quote older than this is served with stale=true.
MARKET_DATA_CACHE_TTL_SECONDS=15
# Enables the realtime websocket connectivity layer (wlct_trading.transport).
# Off by default: with it disabled the service serves cached REST quotes only
# and opens no exchange sockets.
MARKET_DATA_STREAMING_ENABLED=false

# -----------------------------------------------------------------------------
# NOTIFICATION SERVICE (services/notification-service, Node/BullMQ, port 8003)
# -----------------------------------------------------------------------------
NOTIFICATION_SERVICE_HOST=0.0.0.0
NOTIFICATION_SERVICE_PORT=8003
# The standalone worker reads MAIL_DRIVER, MAIL_FROM_* and SMTP_* from the
# EMAIL section above. Only "console" and "smtp" are implemented; any other
# value throws on startup rather than silently discarding mail.
# none | fcm | apns. "none" reports delivered:false instead of faking delivery.
PUSH_PROVIDER=none
# none | twilio
SMS_PROVIDER=none

# -----------------------------------------------------------------------------
# SHARED LOGGING (all Node and Python services)
# -----------------------------------------------------------------------------
# LOG_FORMAT is assigned once, in the LOGGING section above, and set there to json -
# the policy this section states (json in every deployed environment, pretty for local
# terminals). It is repeated here as a heading only, on purpose: a second active
# assignment for one name in one file is how two sections end up meaning two things.
# Additional pino redaction paths, comma separated. The built-in list already
# covers authorization headers, cookies, passwords, tokens and API secrets.
PINO_REDACT_PATHS=

# -----------------------------------------------------------------------------
# BUILD METADATA (injected at image build time; not an operator setting)
# -----------------------------------------------------------------------------
# Two names are read straight off the process environment by the health surface
# (apps/api/src/modules/health/health.service.ts:30,32) rather than through the
# validated schema, because they describe the artefact rather than the deployment:
# what was built, and from which commit. They are documented here for that reason -
# a name a program reads and no file explains is a name nobody can fill in.
#
# Nothing in this repository currently sets either one. There is no CI in the tree and
# no build arg in infrastructure/docker/api.Dockerfile, so a deployment built from this
# repository answers GET /v1/health with commit "unknown" and version taken from
# SWAGGER_VERSION by fallback. Wiring it is one build arg in the image and one value
# from the build environment; until that exists the honest answer is "unknown", and the
# spec at apps/api/src/config/env-example-coverage.spec.ts keeps this sentence true by
# refusing any process.env read that neither the schema nor this file knows about.
# APP_VERSION=
# GIT_COMMIT_SHA=

# -----------------------------------------------------------------------------
# MOBILE APP (apps/mobile, Flutter)
# -----------------------------------------------------------------------------
# The Flutter app deliberately does NOT read this file. A .env shipped inside an
# APK/IPA is trivially extractable, so every mobile value is compiled in with
# --dart-define and the app holds no secrets at all: it authenticates with the
# user's own credentials and stores the resulting tokens in the platform
# keystore (flutter_secure_storage), never in shared preferences or a bundled
# asset. The variables below are listed here only so that all configuration for
# the platform lives in one discoverable place.
#
#   APP_ENV       development | staging | production
#   API_BASE_URL  Base URL INCLUDING the global prefix, e.g. https://api.example.com/api
#                 Android emulator reaches the host through 10.0.2.2, not localhost.
#                 Production builds refuse to start unless this is https://.
#   API_VERSION   URI version segment appended after the prefix (v1)
#   TENANT_SLUG   Sent as X-Tenant-Slug; identifies the white-label brand
#   WS_URL        Socket.IO origin, without the /realtime namespace
#
# Local development against this compose stack:
#
#   flutter run \
#     --dart-define=APP_ENV=development \
#     --dart-define=API_BASE_URL=http://10.0.2.2:4000/api \
#     --dart-define=API_VERSION=v1 \
#     --dart-define=TENANT_SLUG=platform \
#     --dart-define=WS_URL=http://10.0.2.2:4000
#
# Release build:
#
#   flutter build apk --release \
#     --dart-define=APP_ENV=production \
#     --dart-define=API_BASE_URL=https://api.example.com/api \
#     --dart-define=API_VERSION=v1 \
#     --dart-define=TENANT_SLUG=acme \
#     --dart-define=WS_URL=https://api.example.com
#
# Prefer --dart-define-from-file=config/production.json in CI so the values are
# versioned per environment instead of being retyped on the command line.

# =============================================================================
# PART 5 - AUTHENTICATED EXECUTION (libs/trading-core: wlct_trading.execution)
# =============================================================================
# Everything in this block governs whether real orders can reach a real
# exchange with real money. Read the whole section before changing anything.
#
# THE DEFAULTS BELOW CANNOT TRADE. That is deliberate and it is enforced in
# code, not just by convention: an unset variable is never treated as
# permission, and a contradictory combination fails at startup rather than
# resolving itself to the dangerous option.

# -----------------------------------------------------------------------------
# Exchange credentials
# -----------------------------------------------------------------------------
# NEVER commit real values. NEVER paste a key into a ticket, a chat message or
# a log. These are read once at startup by the credential provider and are
# never written to the database, never returned by an API, never included in a
# WebSocket payload and never logged - the credential object redacts itself in
# every rendering path, including repr() and f-strings.
#
# Create the key on Binance with ONLY:
#   [x] Enable Reading
#   [x] Enable Spot & Margin Trading
#   [ ] Enable Withdrawals   <-- MUST stay off
# A withdrawal-capable key is rejected by verify_credentials() and by the
# CREDENTIALS_VALID safety gate. The platform is non-custodial and refuses to
# hold a key that can move funds off the exchange.
#
# Also add an IP allowlist on the key. It is the single most effective control
# available, and it is free.
#
# These two variables are for a single-tenant development setup only. In
# production, per-tenant credentials come from the secret manager through
# SecretManagerCredentialProvider (Vault / AWS Secrets Manager / GCP Secret
# Manager / KMS), keyed by tenant and account. Environment variables do not
# scale to multi-tenant and cannot be rotated per customer.
BINANCE_API_KEY=
BINANCE_API_SECRET=
# Optional: restricts what the platform believes the key can do, independently
# of what the venue says. Comma separated. WITHDRAW here is always refused.
BINANCE_API_PERMISSIONS=SPOT
# Where credentials come from: env | secret-manager | none
CREDENTIAL_PROVIDER=env
# Cache TTL for a resolved credential, in seconds. Short, so a revoked key
# stops working quickly; non-zero, so every order does not hit the secret
# manager. 300 is a reasonable compromise.
CREDENTIAL_CACHE_TTL_SECONDS=300

# -----------------------------------------------------------------------------
# The four switches that gate real money
# -----------------------------------------------------------------------------
# All of the following must agree before a single byte reaches a real venue:
#
#   LIVE_TRADING_ENABLED=true
#   DRY_RUN=false
#   PAPER_TRADING=false
#   TRADING_MODE=LIVE
#   TRADING_ENABLED=true
#   LIVE_TRADING_CONFIRMED=true
#
# Any disagreement is a startup failure with an explicit message. In
# particular:
#   * LIVE_TRADING_ENABLED=true with DRY_RUN=true   -> REJECTED (contradiction)
#   * LIVE_TRADING_ENABLED=true with PAPER_TRADING=true -> REJECTED
#   * LIVE_TRADING_ENABLED=true without TRADING_MODE=LIVE -> REJECTED
# The platform never silently picks the dangerous interpretation, and never
# silently downgrades a misconfigured LIVE to PAPER either - a silent downgrade
# hides a production misconfiguration until the day it matters.

# Master switch for real-money execution.
LIVE_TRADING_ENABLED=false

# Build, validate, risk-check and sign the request, then stop. Nothing is
# transmitted and the order is NEVER reported as submitted. This is the correct
# setting for verifying a configuration end to end without risk.
DRY_RUN=true

# Route orders to the simulated venue. Paper fills are computed from real
# observed prices and are labelled is_simulated=true everywhere they appear -
# in the database, in the API and in every PnL figure.
PAPER_TRADING=true

# -----------------------------------------------------------------------------
# Execution timing
# -----------------------------------------------------------------------------
# How long to wait for a venue response before treating the outcome as UNKNOWN.
# A timeout is ambiguous, not a failure: the order may have been accepted. It
# is reconciled by clientOrderId and never resubmitted.
ORDER_REQUEST_TIMEOUT_MS=10000

# How often the background sweep compares local state against the venue.
ORDER_RECONCILIATION_INTERVAL_MS=60000

# How long to wait before reconciling an order whose result was unknown. Long
# enough for the venue to have finished processing; short enough that a
# position is not a mystery for minutes.
ORDER_UNKNOWN_RECONCILIATION_DELAY_MS=2000

# How often the exchange clock offset is re-measured. A signed request whose
# timestamp is outside the venue's window is rejected, so this is not optional.
EXCHANGE_TIME_SYNC_INTERVAL_MS=300000

# Maximum tolerated difference between this host's clock and the venue's.
# Above this, signing is REFUSED rather than attempted - Binance rejects a
# timestamp more than 1000ms ahead of server time regardless of recvWindow, so
# a larger local error cannot be compensated for by widening the window. If you
# hit this, fix NTP; do not raise the limit.
EXCHANGE_MAX_CLOCK_SKEW_MS=1000

# recvWindow sent with every signed request. Binance caps this at 60000.
# Smaller is safer: it bounds how long a captured request stays replayable.
EXCHANGE_RECV_WINDOW_MS=5000

# How long a clientOrderId reservation is remembered in Redis. The durable
# guard is the unique index on (tenant_id, client_order_id); this is the cheap
# fast path in front of it. 86400 = 24h.
EXECUTION_IDEMPOTENCY_TTL_SECONDS=86400

# Refuse to submit when the risk snapshot is older than this. Stale risk state
# is treated as unavailable, and unavailable means the order is refused.
#
# NOT ASSIGNED HERE, and that is a finding rather than tidying. MAX_RISK_STATE_AGE_MS
# is one name read by three planes whose code defaults disagree: the execution plane
# parses a fallback of 5000 (libs/trading-core/wlct_trading/execution/config.py:377),
# while services/trading-engine/app/config.py:89 and the API's env schema
# (packages/config/src/env.schema.ts:405, pinned at 2000 by risk-safety.spec.ts:182)
# both default to 2000 - and the SLO catalog derives its 4-second freshness budget from
# the 2000 figure (libs/trading-core/wlct_trading/slo/catalog.py:27). An unset
# deployment therefore gates a submission at 5s in one plane and 2s in another on the
# same snapshot. The single assignment lives in the RISK section below at the tighter
# figure; whether the execution plane's looser fallback is intended is a decision with a
# risk consequence attached, so it is written here as a question and not resolved by a
# comment that would make the file look settled.

# Submission attempts for genuinely retryable failures. Never applied to an
# ambiguous result - that path reconciles instead of retrying, always.
MAX_SUBMIT_ATTEMPTS=1

# -----------------------------------------------------------------------------
# Private user-data stream
# -----------------------------------------------------------------------------
# The authenticated WebSocket that delivers fills, order updates and balance
# changes. Backend only: its payloads are the full order flow of a real
# account and must never reach a mobile client or the admin web app.
PRIVATE_STREAM_RECONNECT_ENABLED=true

# Listen-key keepalive interval. Binance expires a listen key after 60 minutes;
# 30 minutes means one renewal can fail entirely and the stream still survives.
PRIVATE_STREAM_LISTEN_KEY_REFRESH_MS=1800000

# After every reconnect the platform reconciles, because Binance does not
# replay events missed while disconnected. Leave this on.
PRIVATE_STREAM_RECONCILE_ON_RECONNECT=true

# -----------------------------------------------------------------------------
# Live-trading harness (NOT part of the default startup path)
# -----------------------------------------------------------------------------
# Guards the separately-invoked script that places a real order on testnet.
# It refuses to run unless this is explicitly true AND the credentials point at
# a testnet endpoint.
LIVE_EXECUTION_HARNESS_ENABLED=false
BINANCE_USE_TESTNET_FOR_HARNESS=true

# =============================================================================
# PART 6 - STRATEGY ENGINE, PAPER TRADING, BACKTESTING
# =============================================================================
# The strategy layer decides what it would like to do. It cannot submit an
# order, it never sees a credential, and NOTHING IN THIS SECTION CAN ENABLE
# LIVE TRADING. That still requires the Part 5 combination above
# (LIVE_TRADING_ENABLED=true, EXECUTION_ENABLED=true, DRY_RUN=false,
# PAPER_TRADING=false, EXCHANGE_SANDBOX_MODE=false), and every one of those is
# validated at startup.
#
# THREE THINGS THIS SECTION CANNOT PROMISE:
#   BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.
#   PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE.
#   SIMULATION DOES NOT GUARANTEE REAL EXECUTION QUALITY.

# -----------------------------------------------------------------------------
# Feature switches
# -----------------------------------------------------------------------------
# Master switch for the strategy engine. Off by default: a deployment that has
# not been asked to run strategies should not spend CPU on every book update.
STRATEGY_ENGINE_ENABLED=false

# Whether paper sessions may be started. A paper session routes to the
# simulated adapter and refuses any adapter that is not marked simulated, so
# this is safe to leave on.
PAPER_TRADING_ENABLED=true

# Whether backtests may be submitted. A backtest opens no socket and touches
# no venue; it reads a stored dataset and replays it.
BACKTEST_ENABLED=true

# -----------------------------------------------------------------------------
# Engine bounds
# -----------------------------------------------------------------------------
# Bound on the in-process market-data queue feeding the strategies. A bounded
# queue turns a slow strategy into shed load rather than unbounded memory
# growth. Valid range 100 - 1000000.
STRATEGY_EVENT_QUEUE_SIZE=10000

# Hard cap on concurrently registered strategy instances per process.
# Valid range 1 - 1000.
STRATEGY_MAX_INSTANCES=50

# Observation budget for one dispatch, in milliseconds. Exceeding it increments
# a counter and marks the dispatch slow so an operator can see degradation.
# It is NOT a guarantee: this platform makes no latency guarantee, and any
# claim of "sub-millisecond" processing would be false. Must stay well below
# SIGNAL_MAX_AGE_MS.
STRATEGY_MAX_PROCESSING_LATENCY_MS=50

# -----------------------------------------------------------------------------
# Signal handling
# -----------------------------------------------------------------------------
# A signal older than this is refused by the validator rather than acted on.
# Stale intent is how a processing backlog turns into a bad fill.
SIGNAL_MAX_AGE_MS=2000

# How long a signal identity is remembered so an identical repeat is dropped.
# This is a bounded in-memory guard against a chattering strategy - it is NOT
# the order idempotency system, which lives in the execution layer and is
# backed by a unique index. Must cover at least SIGNAL_MAX_AGE_MS.
SIGNAL_DEDUP_TTL_SECONDS=5

# -----------------------------------------------------------------------------
# Backtest defaults
# -----------------------------------------------------------------------------
# Applied when a backtest request does not state its own assumptions. They are
# recorded in the configuration hash of every run, so changing one here changes
# the identity of subsequent runs - which is the point: two results computed
# under different cost assumptions are not comparable.
#
# None of these describe a real account or a real fee schedule. Set them from
# your venue's published rates.
BACKTEST_DEFAULT_INITIAL_CAPITAL=10000

# Fee RATES, not basis points: 0.001 is ten basis points. Maker and taker are
# separate because they are separate on every venue that matters.
BACKTEST_DEFAULT_MAKER_FEE=0.001
BACKTEST_DEFAULT_TAKER_FEE=0.001

# Slippage in basis points applied against every simulated taker fill, on both
# sides. Zero fees together with zero slippage is refused in production: that
# combination produces results no real account could achieve.
BACKTEST_DEFAULT_SLIPPAGE_BPS=1

# =============================================================================
# PART 7 - HISTORICAL DATASETS (ingestion, validation, replay input)
# =============================================================================
# Datasets feed the Part 6 backtest engine. They are public market data: no
# credentials exist for them and none are accepted by them. Nothing in this
# section can enable live trading or route an order; the ingestion path shares
# no import with the execution path by design (and by test).
#
# BACKTEST RESULTS OVER THESE DATASETS ARE SIMULATIONS.
# BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.
# SIMULATION DOES NOT GUARANTEE REAL EXECUTION QUALITY.

# -----------------------------------------------------------------------------
# Storage
# -----------------------------------------------------------------------------
# Only the local backend ships. Object storage (S3-compatible, GCS, Azure)
# will be a new enum value and a new module - never a branch in the local one.
DATASET_STORAGE_BACKEND=local

# Root for finalised dataset trees. Must be absolute in production.
DATASET_LOCAL_ROOT=./data/datasets

# Staging root for in-flight ingestion. Must be on the SAME filesystem as
# DATASET_LOCAL_ROOT (finalisation is a rename) and disjoint from it
# (staging under the visible tree would expose half-written versions).
DATASET_TEMP_ROOT=./data/staging

# Hard ceiling for one partition file, in bytes (1 MiB - 4 GiB).
DATASET_MAX_PARTITION_BYTES=268435456

# Streaming reader chunk size (4 KiB - 64 MiB). The only read buffer a replay
# ever allocates; memory does not grow with dataset size.
DATASET_READER_BUFFER_SIZE=65536

# -----------------------------------------------------------------------------
# Validation
# -----------------------------------------------------------------------------
# Validate new versions before they become visible. Off is for emergency
# re-ingest of data validated elsewhere; such manifests are stamped
# "unvalidated" so they never masquerade as validated ones.
DATASET_VALIDATION_ENABLED=true

# Cap on gap findings repeated in a report (0 - 10000). Counts stay exact.
DATASET_MAX_GAP_WARNINGS=100

# Event ceiling per partition (1,000 - 50,000,000).
DATASET_MAX_EVENTS_PER_PARTITION=2000000

# Retention for NON-validated staging only. 'retain' keeps everything,
# including quarantined evidence. Nothing in this repo auto-deletes evidence.
DATASET_RETENTION_POLICY=retain

# -----------------------------------------------------------------------------
# Ingestion and backtest binding
# -----------------------------------------------------------------------------
# Master switch for dataset ingestion jobs. Off by default and never
# auto-enabled in production: a backfill is a deliberate act.
HISTORICAL_INGESTION_ENABLED=false

# Require backtest submissions to name a registered dataset VERSION.
# This is the rule that ends "re-ran the same backtest on different data":
# a run without a pinned version is refused rather than quietly guessed.
BACKTEST_DATASET_REQUIRED=true

# -----------------------------------------------------------------------------
# Part 8: real-time risk engine (control plane)
# -----------------------------------------------------------------------------
# These keys configure the API's risk control surface and the platform-default
# ceilings the trading worker inherits. They can only ever tighten what the
# engine enforces; there is no key here that approves an order, loosens a
# breach or disables a check. See docs/PART8_RISK.md for the resolution
# hierarchy and the fail-closed matrix.

# Require the extended Part 8 gate at worker startup (the Part 2 core gate is
# mandatory regardless and cannot be switched off by any setting).
RISK_ENGINE_ENABLED=true

# Assertion, not a toggle: RISK_FAIL_CLOSED=false is rejected at parse time
# in every environment. The engine refusing what it cannot prove safe is not
# a mode; it is the design.
RISK_FAIL_CLOSED=true

# A hot risk snapshot older than this may not authorise risk-increasing
# orders (ms). Keep it comfortably above RISK_SNAPSHOT_REFRESH_MS or the
# deployment is guaranteed stale (the env loader refuses that combination).
# This is the file's one active assignment of the name: set here, it governs the
# execution plane, the trading engine and the API alike, and no plane falls back to
# its own default - which is the state the Execution timing section above points at.
MAX_RISK_STATE_AGE_MS=2000
RISK_SNAPSHOT_REFRESH_MS=250

# Platform default ceilings. Child scopes (account/strategy/symbol) resolve
# to the TIGHTEST applicable value across the whole chain; these numbers are
# the top of that chain, deliberately conservative, and an emergency
# "flatten everything now" can only lower them further - never raise them.
MAX_ORDER_NOTIONAL=1000
MAX_POSITION_NOTIONAL=5000
MAX_ACCOUNT_EXPOSURE=10000
MAX_STRATEGY_EXPOSURE=5000
MAX_SYMBOL_EXPOSURE=5000
MAX_OPEN_ORDERS=20
MAX_DAILY_LOSS=500
MAX_STRATEGY_DAILY_LOSS=250
MAX_DRAWDOWN=10
MAX_ORDERS_PER_SECOND=2
MAX_ORDERS_PER_MINUTE=30
MAX_CANCELS_PER_SECOND=2
MAX_CANCELS_PER_MINUTE=30
MAX_PRICE_DEVIATION_BPS=250
MAX_CONSECUTIVE_LOSSES=5

# Risk events are the operator-facing trail (breaches, switches, stale
# state). Pruned by the maintenance queue after this many days; the durable
# accounting trail remains in the audit log under its own retention.
RISK_EVENTS_RETENTION_DAYS=365

# =============================================================================
# Part 9: observability & operations
# =============================================================================
# Publication and retention settings - never trading settings. In production
# the *_ENABLED flags cannot be false (env validation refuses to parse); a
# deployment that cannot be observed while holding money is not a deployment.
OBSERVABILITY_ENABLED=true
# ^ the name is shared by services/trading-engine, services/market-data and
# (since Part 18) services/execution-engine on purpose: one platform knob, three
# services, and NODE_ENV=production refuses to parse with it off in each.
METRICS_ENABLED=true
HEALTH_ENABLED=true
PROMETHEUS_ENABLED=true
PROMETHEUS_PATH=/metrics
# Loopback port for the OPTIONAL monitoring overlay (docker-compose.
# observability.yml), which is the only reader of this name: the platform runs
# unchanged with the stack switched off. 9090 is the image's own default, and the
# generated scrape config never reads this value - only compose does.
PROMETHEUS_PORT=9090
ALERTING_ENABLED=true
# Scrape secret. OPTIONAL outside production, REQUIRED in production.
# Provide a real random value through your secret store; never commit one.
# The header the scraper must present is x-metrics-token.
# METRICS_TOKEN=
# Cadences. HEALTH_REFRESH_MS paces each service's mirror loop;
# ALERT_DEDUP_WINDOW_MS must be >= it (validation enforces the ordering);
# QUEUE_ALERT_AGE_MS is the oldest-waiting threshold, halved for the
# trade-execution queue where the severity is CRITICAL by policy.
HEALTH_REFRESH_MS=5000
METRICS_EXPORT_INTERVAL_MS=15000
ALERT_DEDUP_WINDOW_MS=60000
QUEUE_ALERT_AGE_MS=120000
# Retention floors (validation enforces the minima): only RESOLVED alerts and
# CLOSED incidents are ever pruned; unresolved rows stay until resolved.
ALERT_RETENTION_DAYS=90
INCIDENT_RETENTION_DAYS=365

# =============================================================================
# Part 10: tracing, error budgets, fault injection
# =============================================================================
# Telemetry observes; it never authorises. Nothing below changes a trading
# decision, and the fault switch cannot arm in production (the validators
# refuse the boot on both runtimes).
OTEL_ENABLED=false
# OTLP/HTTP JSON collector base URL. Required in production when enabled.
# OTEL_ENDPOINT=http://otel-collector:4318
OTEL_TIMEOUT_MS=2000
OTEL_SAMPLE_RATIO=0.1
# Comma-separated operations always sampled at ratio 1.0 regardless of the
# above (the "critical traces remain inspectable" list).
OTEL_PRIORITY_OPERATIONS=execution.transmit
# Failure injection - a TEST HARNESS SWITCH. Armed only with the guard on
# and only outside production; disabling the guard DISABLES the feature,
# it does not unlock production. No API route can arm or consume.
FAILURE_INJECTION_ENABLED=false
FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY=true
# SLO engine. Evaluation cadence 1..59 minutes; retention has a hard floor
# of 7 days IN CODE - the configured value can only raise it.
SLO_ENABLED=true
SLO_EVALUATION_INTERVAL_MINUTES=5
SLO_RETENTION_DAYS=30
SLO_DEFAULT_WINDOW_MINUTES=1440
SLO_FAST_BURN_MULTIPLIER=14.4
SLO_SLOW_BURN_MULTIPLIER=6

# -----------------------------------------------------------------------------
# Part 11: trading-worker plane and read-replica policy.
#
# Three separable switches, all default-safe: the worker consumer (runs only
# in the dedicated `npm run worker` process / container - the API never hosts
# it), the execution engine it forwards to (services/execution-engine, which
# holds the venue side), and the read replica (off until BOTH the URL and the
# flag are set; half-configuration is a boot error, by design).
# -----------------------------------------------------------------------------
# Worker latch: false makes the worker boot EXIT with a reason rather than
# idle quietly. The API process ignores it (it never mounts the consumers).
WORKER_ENABLED=true
# Stable per-replica identity for claims and logs. Unset composes host:pid:rand.
# WORKER_ID=worker-a
# The fleet list the partition assignment is computed over - identical on
# every worker, comma-separated. Empty means "this worker alone".
# WORKER_MEMBERSHIP=worker-a,worker-b,worker-c
# Part 12: where live membership comes from. 'config' (the default) treats
# the list above as the fleet. 'registry' lets workers self-register through
# a Redis heartbeat zset - the list above becomes the documented fallback
# (first tick + registry outages) and claims remain the entire authority.
# WORKER_MEMBERSHIP_MODE=registry
# Heartbeat grace period for 'registry' mode; must be >= 2x
# WORKER_PARTITION_RETRY_MS when the mode is registry (schema-enforced).
# WORKER_MEMBERSHIP_TTL_MS=30000
# Keyspace width; changing it rescales every assignment at once (coordinated
# config change, ceiling 4096 pinned by the coordination fixtures).
WORKER_PARTITION_COUNT=8
WORKER_PARTITION_LEASE_TTL_MS=15000
WORKER_PARTITION_RETRY_MS=2500
# Parked-job cadence and the ceiling before a homeless job fails visibly
# (deferrals do not consume BullMQ attempts; this is what stops an eternal orbit).
WORKER_DEFER_DELAY_MS=3000
WORKER_MAX_DEFERS=30
WORKER_SHUTDOWN_TIMEOUT_MS=10000
# The execution engine (services/execution-engine) this worker forwards
# TRADE_EXECUTION commands to. It holds venue contact and credentials; this
# process holds only the queue.
EXECUTION_ENGINE_URL=http://127.0.0.1:8093
# REQUIRED by the worker: its startup gate asks the engine's /internal/v1/status before it
# will consume a job, and refuses to run against a mode it was not built to serve. Since
# Part 20 the API reads both names too - not to command the engine, only to render the
# ENGINE POSTURE section of GET /v1/observability/execution. Optional for the API in the
# strict sense: with either name absent the module declines to construct a client, the API
# boots, and the panel section reports `unconfigured` with the reason instead of inventing
# an answer (no observability surface may be the reason a service refuses to start).
# Must match the engine's EXECUTION_INTERNAL_TOKEN. Generate fresh; never reuse across
# environments.
# EXECUTION_ENGINE_TOKEN=
# Inside docker-compose.yml both services get EXECUTION_ENGINE_URL=http://execution-engine:8093
# instead of the loopback value above: in a container network 127.0.0.1 is the container that
# set it, and the engine publishes no host port.
# Part 13 durable engine store (read by docker-compose for the
# execution-engine service). memory is the default and reports
# storeDurable=false honestly; postgres persists orders/events/fills in the
# engine_* tables (created by the API's migrations). Postgres without the
# DSN - or the DSN without postgres - refuses startup; there is no silent
# fallback in either direction. Details: services/execution-engine/.env.example
# and docs/PART13_DURABLE_STORE.md.
# EXECUTION_STORE_BACKEND=postgres
# EXECUTION_POSTGRES_DSN=postgresql://wlct_app:CHANGE-ME@db:5432/wlct
# Part 14 journal retention, also read by the execution-engine service
# above: defaults keep APPLY disabled (dry-run/inspect always available);
# bounds and semantics in services/execution-engine/.env.example and
# docs/PART14_RETENTION.md. The prune itself runs from
# `node scripts/retention-run.mjs` under the deployment's scheduler.
# EXECUTION_RETENTION_ENABLED=false
# EXECUTION_RETENTION_EVENT_DAYS=90
# Part 15: how old a row-level-security enablement audit may be before the
# platform stops treating it as evidence (bounds enforced by the core law;
# a bad value refuses boot). The audit is read-only - there is no enablement
# apply switch to turn on. Recorded results live in
# docs/dr/rls-evidence.jsonl and are aged by `node scripts/rls-enablement.mjs
# check` (docs/PART15_RLS_ENABLEMENT.md).
# EXECUTION_ENABLEMENT_MAX_AGE_DAYS=30
# ---------------------------------------------------------------------------
# Part 16 - the credential source and the authenticated placement review.
#
# The review itself has no switch: it runs before every order a runtime could
# transmit, and a deployment that cannot reach the venue is refused rather than
# waved through. What is configurable here is where key material comes from and
# how expensive the review may be (docs/PART16_PLACEMENT_REVIEW.md).
#
# Where a live runtime would read key material. `none` (the default) wires a
# provider that refuses every authenticated lookup, which is what a simulated
# deployment wants: a paper process that needs a key is a bug, and this makes it
# loud. `environment` is development-only and is refused outright when
# NODE_ENV=production. `secret-manager` needs a fetcher injected in code - the
# platform's key custody lives with the service that owns the encrypted store.
# EXECUTION_CREDENTIAL_SOURCE=none
# The two variables `environment` reads are <PREFIX>_API_KEY and
# <PREFIX>_API_SECRET. No trailing underscore: the separator is appended for
# you, and `ACME_` would look for `ACME__API_KEY` (refused at boot).
# EXECUTION_CREDENTIAL_ENV_PREFIX=WLCT_BINANCE
# The single (tenant, account) pair an environment can serve. More than one
# tenant needs `secret-manager` - an environment has no way to scope a secret
# per customer, which is why it is development-only.
# EXECUTION_CREDENTIAL_TENANT_ID=tenant-1
# EXECUTION_CREDENTIAL_ACCOUNT_ID=account-1
# How long a resolved credential may be reused before the provider goes back to
# its source. Not a security window: rotation and revocation are the venue's and
# the operator's; this is the difference between one vault call per order and one
# per burst.
# EXECUTION_CREDENTIAL_CACHE_SECONDS=300
# How long a gathered placement attestation may be reused - AND how old one may
# be before the review calls it stale. One number on purpose: a cache that outlived
# the freshness bound would be the reason a stale answer passed. Bounds
# (1000..3600000 ms) are the core's law and refuse boot outside them.
# EXECUTION_PLACEMENT_ATTESTATION_TTL_MS=300000
# A key older than this may not trade until it is rotated (1..36500 days).
# EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS=90
# The venue must report an IP allowlist on the key. Default true; `false` is
# accepted for simulated runtimes and refused for live ones, because the
# allowlist is the one control on a leaked key that the venue enforces for us.
# EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST=true
#
# Deliberately absent from docker-compose.yml: the key variables themselves.
# `EXECUTION_CREDENTIAL_SOURCE=environment` reads them from the process
# environment; a compose line spelling them out would advertise the file as a
# place to put a secret, which is the one thing this platform will not do.
# Read-replica routing. Off by default; every read stays on the primary.
# When on, replica-eligible reads move only while the replica is healthy AND
# its lag (last probe, 10s trust window) is within DATABASE_READ_MAX_LAG_MS;
# any unknown routes primary. Execution-critical reads never use the replica.
DATABASE_READ_ENABLED=false
# DATABASE_READ_URL=postgresql://replica-user:...@replica-host:5432/wlct?sslmode=require
DATABASE_READ_MAX_LAG_MS=1500

# ---------------------------------------------------------------------------
# Disaster-recovery rehearsal (Part 21): scripts/dr-rehearsal.mjs
# ---------------------------------------------------------------------------
# Nothing here is read by the API, the worker or the engine: these are operator
# shell variables for one command, listed so that `scripts/dr-manifest.mjs` can see
# the name exists (its environment scan reads this file for `KEY=` lines, including
# commented ones) and so a deployment cannot mistake the rehearsal's confirmation for
# a live-mode switch. It is not one: EXECUTION_MODE=live is refused at startup
# regardless of anything below, and the rehearsal runner refuses --target production
# outright rather than consulting a variable.
#
# DR_REHEARSAL_CONFIRMATION=<rehearsalId>  # must equal the hash of the plan being
#     approved (printed by `--execute` on refusal, or `--plan-only`); the flag form
#     --confirm is equivalent. Setting it once in a shell profile defeats the purpose:
#     the value is the plan, so a stale export approves nothing.
```

FILE: .gitignore

```gitignore
# Dependencies
node_modules/
.pnp/
.pnp.js
.yarn/

# Build output
dist/
build/
out/
.next/
*.tsbuildinfo

# Environment / secrets
.env
.env.*
!.env.example
*.pem
*.key
!infrastructure/**/*.key.example
secrets/
keys/

# Logs
logs/
*.log
npm-debug.log*
yarn-error.log*
pnpm-debug.log*

# Testing
coverage/
.nyc_output/

# Python
__pycache__/
*.py[cod]
.venv/
venv/
.mypy_cache/
.pytest_cache/
.ruff_cache/

# Flutter / Dart
apps/mobile/.dart_tool/
apps/mobile/.flutter-plugins
apps/mobile/.flutter-plugins-dependencies
apps/mobile/.packages
apps/mobile/build/
apps/mobile/ios/Pods/
apps/mobile/ios/.symlinks/
apps/mobile/android/.gradle/
apps/mobile/android/local.properties
apps/mobile/**/GeneratedPluginRegistrant.*
apps/mobile/lib/generated/

# Prisma
apps/api/prisma/*.db
apps/api/prisma/*.db-journal

# IDE / OS
.idea/
.vscode/*
!.vscode/extensions.json
.DS_Store
Thumbs.db

# Docker volumes
infrastructure/docker/volumes/

# Compiled output accidentally emitted next to the sources it came from.
# `tsc` writes beside the input whenever outDir is missing or a stray tsconfig
# is picked up, and those .js/.d.ts files then shadow the real .ts modules on
# the next resolve. Ignoring them keeps the mistake out of the history.
packages/*/src/**/*.js
packages/*/src/**/*.d.ts
packages/*/src/**/*.js.map
packages/*/src/**/*.d.ts.map
apps/api/src/**/*.js
apps/api/src/**/*.d.ts
services/notification-service/src/**/*.js
services/notification-service/src/**/*.d.ts
```

FILE: .nvmrc

```text
20.11.0
```

FILE: README.md

````markdown
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
````

FILE: docker-compose.observability.yml

```yaml
# =============================================================================
# Optional overlay: the reader for the telemetry this platform already publishes.
#
# One service, and one only. The main compose file exposes `/metrics` on four
# services (api, trading-engine, execution-engine, market-data) and Part 18
# stopped there on purpose, leaving "the alert rules, the dashboards and the
# scrape targets" to the deployment (docs/PART18_METRICS_EXPOSITION.md). This
# file is that deployment side, as a file in the repository, so that it can be
# reviewed, diffed and checked instead of existing only on somebody's host.
#
# Usage:
#   docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d prometheus
#
# Verifying the config this service reads (no container needed):
#   python3 libs/trading-core/scripts/gen_observability_bundle.py --check
#   python3 libs/trading-core/scripts/gen_observability_bundle.py --emit
# The bundle under infrastructure/observability/ is generated from docker-compose.yml, the
# services' own routers and libs/trading-core/wlct_trading/observability/alerts.py. This file
# is hand-written, and `--check` reads it back: the read-only mount, the loopback publish, the
# pinned image, the internal network and the absence of a lifecycle endpoint are all asserted.
#
# What is NOT here, each with the reason rather than a silence:
#   * alertmanager - the platform owns the alert lifecycle already (ALERT_RULES, the fold,
#     durable dedupe and retention). A second store of the same alerts is a second truth.
#   * grafana - a dashboard file needs a data source UID and a layout nobody in this tree
#     owns; the dashboard the platform does own is the derived document from
#     wlct_trading/observability/dashboard.py, and `--dashboard` renders it.
#   * an otel-collector - `OTEL_ENDPOINT` names `http://otel-collector:4318` as a
#     deployment-provided address; a collector shipped here would have to name a trace
#     backend, and this repository has none.
#   * node-exporter or any other exporter - each added image is another one to pin and
#     another surface to secure, and the failure modes worth paging on are trading-path ones.
#   * a retention flag - `--storage.tsdb.retention.time` is left unset, so the image
#     default stands. This repository declares no retention policy for scraped telemetry
#     (it has one for its own data, in the retention law of Part 14, and that law does not
#     reach the monitoring stack's volume).
#   * `--web.enable-lifecycle` - a POST that rewrites a monitoring config, on a container
#     that needs no such power, is an unauthenticated control surface. Config changes mean
#     a restart, which is also the moment `--check` would have caught a drift anyway.
#
# Nothing in this file can change a trading decision. Prometheus reads what the services
# publish; if it is switched off, the platform behaves exactly as it did before it existed.
# =============================================================================

name: wlct

x-logging: &default-logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"

x-restart: &default-restart
  restart: unless-stopped

services:
  prometheus:
    # Pinned, because infrastructure/observability/prometheus/prometheus.yml uses
    # `http_headers` (needs >= 2.53) and a floating tag would let a major version change
    # the config format underneath a committed file. Bumping this tag is a change to the
    # bundle contract, so it travels with `--check`.
    image: prom/prometheus:v3.5.0
    container_name: wlct-prometheus
    <<: *default-restart
    logging: *default-logging
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      - --storage.tsdb.path=/prometheus
    environment:
      # Prometheus expands `${...}` inside its config from its own process environment.
      # These two lines are the only way the deployment's values reach the scrape jobs, so
      # the repository can name a path and a header without ever holding a token: an unset
      # METRICS_TOKEN expands to empty, which the API ignores, and in production the API's
      # environment validation refuses to start without one at all.
      METRICS_TOKEN: ${METRICS_TOKEN:-}
      PROMETHEUS_PATH: ${PROMETHEUS_PATH:-/metrics}
    volumes:
      # Read-only on purpose. The bundle is generated by a script a human runs, not by the
      # container, so nothing needs to write here - and a monitoring service that could
      # rewrite its own rules is one more way for a bad afternoon to become a silent one.
      - ./infrastructure/observability/prometheus:/etc/prometheus:ro
      # The TSDB itself, on a named volume like Postgres' and Redis' state: a restart keeps
      # the history, a recreation of the container does not. No bind mount, because nobody
      # outside this stack is expected to read raw blocks off disk.
      - prometheus-data:/prometheus
    expose:
      # Reachable from inside the network: the query UI is a debugging surface that other
      # services in this stack have no reason to touch, so nothing is published from it
      # except the loopback mapping below.
      - "9090"
    ports:
      - "127.0.0.1:${PROMETHEUS_PORT:-9090}:9090"
    networks:
      - wlct-internal

volumes:
  prometheus-data:
    driver: local

networks:
  # Re-declared, not re-created: with the main file this is the same network, and the
  # scraper has to be inside it to reach the ports the services `expose` rather than
  # publish. Declaring it here is what lets `docker compose config` resolve this overlay on
  # its own instead of failing on an unknown network.
  wlct-internal:
    driver: bridge
    internal: false
```

FILE: docker-compose.override.yml

```yaml
# =============================================================================
# Development overlay.
#
# Applied automatically by `docker compose up` alongside docker-compose.yml.
# It trades the hardened production posture for fast feedback: source is bind
# mounted, processes reload on change, and the internal services publish their
# ports so they can be probed directly from the host.
#
# This file must never be used in a deployed environment. Run production-like
# stacks with:
#   docker compose -f docker-compose.yml up -d
# =============================================================================

services:
  postgres:
    ports:
      - "${POSTGRES_PORT:-5432}:5432"

  redis:
    ports:
      - "${REDIS_PORT:-6379}:6379"

  api:
    build:
      target: build
    environment:
      NODE_ENV: development
      LOG_FORMAT: pretty
      SWAGGER_ENABLED: "true"
    command: sh -c "npm run start:dev --workspace @wlct/api"
    volumes:
      - ./apps/api/src:/app/apps/api/src
      - ./apps/api/prisma:/app/apps/api/prisma
      - ./packages:/app/packages
    ports:
      - "${API_PORT:-4000}:4000"
      # Node inspector, loopback only.
      - "127.0.0.1:9229:9229"

  notification-service:
    build:
      target: build
    environment:
      NODE_ENV: development
      LOG_FORMAT: pretty
    command: sh -c "npm run start:dev --workspace @wlct/notification-service"
    volumes:
      - ./services/notification-service/src:/app/services/notification-service/src
      - ./packages:/app/packages
    ports:
      - "127.0.0.1:8003:8003"

  trading-engine:
    environment:
      NODE_ENV: development
      LOG_LEVEL: debug
    command: >
      sh -c "uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload --log-config /dev/null"
    volumes:
      - ./services/trading-engine/app:/app/app
    ports:
      - "127.0.0.1:8001:8001"

  market-data:
    environment:
      NODE_ENV: development
      LOG_LEVEL: debug
    command: >
      sh -c "uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload --log-config /dev/null"
    volumes:
      - ./services/market-data/app:/app/app
    ports:
      - "127.0.0.1:8002:8002"

  admin-web:
    build:
      target: deps
    environment:
      NODE_ENV: development
      API_BASE_URL: http://api:4000/api
    command: sh -c "npm run dev --workspace @wlct/admin-web"
    volumes:
      - ./apps/admin-web/src:/app/apps/admin-web/src
      - ./apps/admin-web/public:/app/apps/admin-web/public
      - ./apps/admin-web/next.config.mjs:/app/apps/admin-web/next.config.mjs
      - ./packages:/app/packages
```

FILE: docker-compose.yml

```yaml
# =============================================================================
# White-label copy-trading platform - local and staging composition.
#
# Design notes:
#  * Only Postgres, Redis, the API and the admin console publish ports. The
#    Python services and the notification worker stay on the internal network:
#    they are reachable by service name and by nothing else.
#  * Every service reads the same root .env, so there is one place to configure
#    the stack and no secret is written into this file.
#  * Health checks gate startup order. `depends_on: condition: service_healthy`
#    means the API never boots against a database that is still initialising.
#  * Named volumes hold state. Bind mounts are used only for the development
#    profile, where hot reload is worth the trade-off.
# =============================================================================

name: wlct

x-logging: &default-logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"

x-restart: &default-restart
  restart: unless-stopped

services:
  # ---------------------------------------------------------------------------
  # Data stores
  # ---------------------------------------------------------------------------
  postgres:
    image: postgres:16.4-alpine
    container_name: wlct-postgres
    <<: *default-restart
    logging: *default-logging
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-wlct}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
      POSTGRES_DB: ${POSTGRES_DB:-wlct}
      # Deterministic collation avoids index-corruption surprises when the base
      # image's libc changes between upgrades.
      POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale=C"
    command:
      - postgres
      - -c
      - max_connections=200
      - -c
      - shared_buffers=256MB
      - -c
      - log_min_duration_statement=1000
      # Consumed by infrastructure/database/init/02-roles.sql.
      - -c
      - wlct.app_password=${POSTGRES_APP_PASSWORD:-}
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./infrastructure/database/init:/docker-entrypoint-initdb.d:ro
    ports:
      # Bound to loopback: the database must not be reachable from the LAN.
      - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-wlct} -d ${POSTGRES_DB:-wlct}"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 20s
    networks:
      - wlct-internal

  redis:
    image: redis:7.4-alpine
    container_name: wlct-redis
    <<: *default-restart
    logging: *default-logging
    command:
      - redis-server
      - --requirepass
      - ${REDIS_PASSWORD:?REDIS_PASSWORD is required}
      - --appendonly
      - "yes"
      - --maxmemory
      - 512mb
      # Queue jobs and session state must never be silently evicted; only keys
      # with an explicit TTL are eligible.
      - --maxmemory-policy
      - volatile-lru
    volumes:
      - redis-data:/data
    ports:
      - "127.0.0.1:${REDIS_PORT:-6379}:6379"
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a \"$$REDIS_PASSWORD\" ping | grep -q PONG"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 10s
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD}
    networks:
      - wlct-internal

  # ---------------------------------------------------------------------------
  # Migrations
  #
  # A one-shot job rather than an API entrypoint step: running migrations from
  # every replica is a race, and a failed migration must stop the deploy rather
  # than crash-loop an application container.
  # ---------------------------------------------------------------------------
  migrate:
    build:
      context: .
      dockerfile: infrastructure/docker/api.Dockerfile
      target: build
    container_name: wlct-migrate
    restart: "no"
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://${POSTGRES_USER:-wlct}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-wlct}?schema=public
    command: >
      sh -c "npx prisma migrate deploy --schema apps/api/prisma/schema.prisma"
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - wlct-internal

  # ---------------------------------------------------------------------------
  # Application services
  # ---------------------------------------------------------------------------
  api:
    build:
      context: .
      dockerfile: infrastructure/docker/api.Dockerfile
      target: runtime
    container_name: wlct-api
    <<: *default-restart
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      PORT: 4000
      DATABASE_URL: postgresql://${POSTGRES_USER:-wlct}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-wlct}?schema=public&connection_limit=20&pool_timeout=20
      REDIS_HOST: redis
      REDIS_PORT: 6379
      TRADING_ENGINE_URL: http://trading-engine:8001
      MARKET_DATA_URL: http://market-data:8002
      NOTIFICATION_SERVICE_URL: http://notification-service:8003
      # Part 20: the engine-posture panel (`GET /v1/observability/execution`, section 4
      # of `docs/PART20_ENGINE_STATUS_EDGE.md`). Both names must be set here, not only in
      # `.env`, for two measured reasons. `.env.example` sets `EXECUTION_ENGINE_URL` to
      # `http://127.0.0.1:8093` - correct for a developer running uvicorn, and inside this
      # network it aims the API container at itself, so the panel would answer
      # `unverified` with a connection error on a deployment where the engine is healthy
      # and publishes no host port at all. And `.env.example` documents
      # `EXECUTION_ENGINE_TOKEN` commented out, while the engine validates
      # `EXECUTION_INTERNAL_TOKEN`: `worker:` translates that one secret under two names,
      # and the panel needs the same translation. (No line numbers here on purpose - this
      # part inserted lines above `worker:`, which is exactly how a cited line number
      # becomes a false statement in a file nobody re-reads.) Nothing is required of the operator either way: the
      # observability module constructs a client only when `engineInternalClientConfigured`
      # holds, so with the variables absent the API still boots and the panel says
      # `unconfigured` with the reason - which is the fail-closed half of Part 20, left
      # working deliberately. A wrong panel row, not a missing one, is the failure mode this
      # part was written against.
      EXECUTION_ENGINE_URL: http://execution-engine:8093
      EXECUTION_ENGINE_TOKEN: ${EXECUTION_INTERNAL_TOKEN:-}
      # The API enqueues; the standalone worker consumes. Running the worker
      # inline as well would double-process every job.
      QUEUE_RUN_INLINE_WORKERS: "false"
    ports:
      - "${API_PORT:-4000}:4000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 40s
    networks:
      - wlct-internal
      - wlct-edge

  notification-service:
    build:
      context: .
      dockerfile: infrastructure/docker/notification-service.Dockerfile
      target: runtime
    container_name: wlct-notification-service
    <<: *default-restart
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      NOTIFICATION_SERVICE_PORT: 8003
      REDIS_HOST: redis
      REDIS_PORT: 6379
    expose:
      - "8003"
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - wlct-internal

  trading-engine:
    build:
      context: .
      dockerfile: infrastructure/docker/trading-engine.Dockerfile
      target: runtime
    container_name: wlct-trading-engine
    <<: *default-restart
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      TRADING_ENGINE_PORT: 8001
      # Part 9: observability mirror cadence + master switch (see .env.example).
      HEALTH_REFRESH_MS: ${HEALTH_REFRESH_MS:-5000}
      OBSERVABILITY_ENABLED: ${OBSERVABILITY_ENABLED:-true}
      DATABASE_URL: postgresql://${POSTGRES_USER:-wlct}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-wlct}
      REDIS_HOST: redis
      REDIS_PORT: 6379
      # Part 1 ships with execution hard-disabled. Enabling it requires a
      # deliberate change here and in the root .env.
      EXECUTION_ENABLED: ${EXECUTION_ENABLED:-false}
      EXCHANGE_SANDBOX_MODE: ${EXCHANGE_SANDBOX_MODE:-true}
    expose:
      - "8001"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - wlct-internal

  # ---------------------------------------------------------------------------
  # Part 11: the execution plane, split in two on purpose. The ENGINE holds
  # venue contact (adapters, credentials domain, locks, incidents); the
  # WORKER holds the queue (admission, partition claims, ack policy). Each
  # can say "no" to the other and both mean it: the worker refuses to boot
  # when the engine reports an incompatible mode, and the engine serves only
  # an authenticated internal token plus a tenant header.

  execution-engine:
    build:
      context: .
      dockerfile: infrastructure/docker/execution-engine.Dockerfile
      target: runtime
    container_name: wlct-execution-engine
    <<: *default-restart
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      SERVICE_PORT: 8093
      # Bind inside the container so the compose network can route to it; the
      # port is EXPOSEd to internal networks only - never published.
      EXECUTION_ENGINE_HOST: 0.0.0.0
      EXECUTION_INSTANCE_ID: ${EXECUTION_INSTANCE_ID:-execution-engine-1}
      EXECUTION_INTERNAL_TOKEN: ${EXECUTION_INTERNAL_TOKEN:?EXECUTION_INTERNAL_TOKEN is required for the execution engine}
      # simulated is the only wired mode; live refuses startup by code.
      EXECUTION_MODE: simulated
      EXECUTION_DRY_RUN: ${EXECUTION_DRY_RUN:-true}
      # Part 13 durable store. memory is the default (readiness reports
      # storeDurable=false, as it always has); postgres requires the
      # engine tables (applied by the migrate job's own migrations) and a
      # DSN - both are start-up refusals when missing, never a fallback.
      EXECUTION_STORE_BACKEND: ${EXECUTION_STORE_BACKEND:-memory}
      EXECUTION_POSTGRES_DSN: ${EXECUTION_POSTGRES_DSN:-}
      # Part 14 journal retention. ENABLED gates APPLY only - inspect and
      # dry-run work regardless, and every value is validated at startup by
      # the core's retention law (bounds in docs/PART14_RETENTION.md). The
      # scheduler (if any) is the deployment's business; nothing here runs
      # deletes on its own.
      EXECUTION_RETENTION_ENABLED: ${EXECUTION_RETENTION_ENABLED:-false}
      EXECUTION_RETENTION_EVENT_DAYS: ${EXECUTION_RETENTION_EVENT_DAYS:-90}
      EXECUTION_RETENTION_BATCH_ROWS: ${EXECUTION_RETENTION_BATCH_ROWS:-2000}
      EXECUTION_RETENTION_MAX_BATCHES: ${EXECUTION_RETENTION_MAX_BATCHES:-50}
      # Part 15: the evidence window only (the audit itself is read-only, so
      # there is no enablement switch to thread through). Empty-string-safe
      # like every other default here; the config validator rejects 0.
      EXECUTION_ENABLEMENT_MAX_AGE_DAYS: ${EXECUTION_ENABLEMENT_MAX_AGE_DAYS:-30}
      # Part 16: the credential source and the placement review's cost bounds.
      # The review has no enable switch, so nothing here can turn it off; the
      # defaults below are the safe ones and the config validator refuses a
      # nonsense value at boot rather than at the first order. NOTE the absence
      # of any API-key line: `environment` credentials are read from the host
      # process environment when an operator opts into them, and this file is
      # not a place a secret may be written (docs/SECURITY.md).
      EXECUTION_CREDENTIAL_SOURCE: ${EXECUTION_CREDENTIAL_SOURCE:-none}
      EXECUTION_CREDENTIAL_ENV_PREFIX: ${EXECUTION_CREDENTIAL_ENV_PREFIX:-WLCT_BINANCE}
      EXECUTION_CREDENTIAL_TENANT_ID: ${EXECUTION_CREDENTIAL_TENANT_ID:-tenant-1}
      EXECUTION_CREDENTIAL_ACCOUNT_ID: ${EXECUTION_CREDENTIAL_ACCOUNT_ID:-account-1}
      EXECUTION_CREDENTIAL_CACHE_SECONDS: ${EXECUTION_CREDENTIAL_CACHE_SECONDS:-300}
      EXECUTION_PLACEMENT_ATTESTATION_TTL_MS: ${EXECUTION_PLACEMENT_ATTESTATION_TTL_MS:-300000}
      EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS: ${EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS:-90}
      EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST: ${EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST:-true}
      # Part 17 added no variable of its own: the durable incident sink is a
      # consequence of EXECUTION_STORE_BACKEND (postgres brings engine_incidents
      # with it, memory keeps the in-process recorder) and a mismatched pair is
      # refused at composition, so there is nothing to mis-configure here.
      # Part 18's knob is the platform's, shared with the two sibling services:
      # GET /metrics renders this process's stage histograms and counters, and
      # NODE_ENV=production refuses to parse with it off.
      OBSERVABILITY_ENABLED: ${OBSERVABILITY_ENABLED:-true}
    expose:
      - "8093"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - wlct-internal

  worker:
    build:
      context: .
      dockerfile: infrastructure/docker/api.Dockerfile
      target: runtime
    container_name: wlct-worker
    <<: *default-restart
    logging: *default-logging
    command: ["node", "dist/worker.js"]
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      # The worker container owns ALL inline workers (maintenance,
      # notification, trade-execution); the API keeps them off.
      QUEUE_RUN_INLINE_WORKERS: "true"
      DATABASE_URL: postgresql://${POSTGRES_USER:-wlct}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-wlct}?schema=public&connection_limit=10&pool_timeout=20
      REDIS_HOST: redis
      REDIS_PORT: 6379
      WORKER_ENABLED: "true"
      WORKER_ID: ${WORKER_ID:-worker-1}
      WORKER_MEMBERSHIP: ${WORKER_MEMBERSHIP:-worker-1}
      # Part 12: the compose fleet self-registers via the Redis heartbeat
      # zset; the list above stays as the boot/fallback view. Flipping this
      # back to config is a one-line redeploy - claims decide authority in
      # both modes, so nothing else about safety changes.
      WORKER_MEMBERSHIP_MODE: ${WORKER_MEMBERSHIP_MODE:-registry}
      WORKER_MEMBERSHIP_TTL_MS: ${WORKER_MEMBERSHIP_TTL_MS:-30000}
      WORKER_PARTITION_COUNT: ${WORKER_PARTITION_COUNT:-8}
      WORKER_PARTITION_LEASE_TTL_MS: ${WORKER_PARTITION_LEASE_TTL_MS:-15000}
      WORKER_PARTITION_RETRY_MS: ${WORKER_PARTITION_RETRY_MS:-2500}
      WORKER_DEFER_DELAY_MS: ${WORKER_DEFER_DELAY_MS:-3000}
      WORKER_MAX_DEFERS: ${WORKER_MAX_DEFERS:-30}
      WORKER_SHUTDOWN_TIMEOUT_MS: ${WORKER_SHUTDOWN_TIMEOUT_MS:-10000}
      EXECUTION_ENGINE_URL: http://execution-engine:8093
      # One secret, two names: the engine validates EXECUTION_INTERNAL_TOKEN,
      # the worker presents it as EXECUTION_ENGINE_TOKEN.
      EXECUTION_ENGINE_TOKEN: ${EXECUTION_INTERNAL_TOKEN:-}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
      execution-engine:
        condition: service_healthy
    # No ports: the worker serves nothing. Its visibility is structured logs
    # plus the API's read-only GET /v1/observability/worker-coordination,
    # which reads the same Redis claims this process writes.
    networks:
      - wlct-internal

  market-data:
    build:
      context: .
      dockerfile: infrastructure/docker/market-data.Dockerfile
      target: runtime
    container_name: wlct-market-data
    <<: *default-restart
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      MARKET_DATA_PORT: 8002
      # Part 9: observability mirror cadence + master switch (see .env.example).
      HEALTH_REFRESH_MS: ${HEALTH_REFRESH_MS:-5000}
      OBSERVABILITY_ENABLED: ${OBSERVABILITY_ENABLED:-true}
      REDIS_HOST: redis
      REDIS_PORT: 6379
    expose:
      - "8002"
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - wlct-internal

  admin-web:
    build:
      context: .
      dockerfile: infrastructure/docker/admin-web.Dockerfile
      target: runtime
      args:
        NEXT_PUBLIC_APP_NAME: ${NEXT_PUBLIC_APP_NAME:-CopyTrade Admin}
        NEXT_PUBLIC_API_VERSION: ${NEXT_PUBLIC_API_VERSION:-v1}
        NEXT_PUBLIC_WS_URL: ${NEXT_PUBLIC_WS_URL:-}
        NEXT_PUBLIC_WS_PATH: ${NEXT_PUBLIC_WS_PATH:-/socket.io}
    container_name: wlct-admin-web
    <<: *default-restart
    logging: *default-logging
    environment:
      NODE_ENV: production
      PORT: 3000
      # Server-to-server inside the compose network; the browser never sees it.
      API_BASE_URL: http://api:4000/api
      ADMIN_TENANT_SLUG: ${ADMIN_TENANT_SLUG:-platform}
      SESSION_COOKIE_SECRET: ${SESSION_COOKIE_SECRET:?SESSION_COOKIE_SECRET is required}
    ports:
      - "${ADMIN_WEB_PORT:-3000}:3000"
    depends_on:
      api:
        condition: service_healthy
    networks:
      - wlct-internal
      - wlct-edge

volumes:
  postgres-data:
    driver: local
  redis-data:
    driver: local

networks:
  # Service-to-service traffic. Not reachable from outside the host.
  wlct-internal:
    driver: bridge
    internal: false
  # Everything that legitimately faces a browser.
  wlct-edge:
    driver: bridge
```

FILE: package.json

```json
{
  "name": "whitelabel-copytrade",
  "version": "1.0.0",
  "private": true,
  "description": "Multi-tenant white-label crypto copy-trading platform (non-custodial, API-key based)",
  "license": "UNLICENSED",
  "engines": {
    "node": ">=20.11.0",
    "npm": ">=10.0.0"
  },
  "workspaces": [
    "packages/*",
    "apps/api",
    "apps/admin-web",
    "services/notification-service"
  ],
  "scripts": {
    "build:packages": "npm run build --workspace=@wlct/shared-types && npm run build --workspace=@wlct/config && npm run build --workspace=@wlct/utils && npm run build --workspace=@wlct/validation",
    "build:api": "npm run build --workspace=@wlct/api",
    "build:admin": "npm run build --workspace=@wlct/admin-web",
    "build:notification": "npm run build --workspace=@wlct/notification-service",
    "build": "npm run build:packages && npm run build:api && npm run build:notification && npm run build:admin",
    "dev:api": "npm run start:dev --workspace=@wlct/api",
    "dev:admin": "npm run dev --workspace=@wlct/admin-web",
    "dev:notification": "npm run start:dev --workspace=@wlct/notification-service",
    "prisma:generate": "npm run prisma:generate --workspace=@wlct/api",
    "prisma:migrate": "npm run prisma:migrate --workspace=@wlct/api",
    "prisma:deploy": "npm run prisma:deploy --workspace=@wlct/api",
    "prisma:reset": "npm run prisma:reset --workspace=@wlct/api",
    "prisma:studio": "npm run prisma:studio --workspace=@wlct/api",
    "db:seed": "npm run db:seed --workspace=@wlct/api",
    "lint": "npm run lint --workspace=@wlct/api",
    "test": "npm run test --workspace=@wlct/api",
    "test:e2e": "npm run test:e2e --workspace=@wlct/api",
    "typecheck": "npm run typecheck --workspace=@wlct/api && npm run typecheck --workspace=@wlct/admin-web && npm run typecheck --workspace=@wlct/notification-service",
    "keys:generate": "node scripts/generate-keys.mjs",
    "docker:up": "docker compose up -d --build",
    "docker:down": "docker compose down",
    "docker:logs": "docker compose logs -f api",
    "smoke": "bash scripts/smoke-test.sh",
    "verify": "bash scripts/verify-part1.sh"
  },
  "devDependencies": {
    "@types/node": "^20.14.10",
    "rimraf": "^5.0.7",
    "typescript": "^5.5.4"
  }
}
```

FILE: tsconfig.base.json

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "commonjs",
    "moduleResolution": "node",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": false,
    // Incremental builds are deliberately OFF for the whole monorepo.
    //
    // Every package/app cleans with `rimraf dist` (and `nest build` uses
    // deleteOutDir) before compiling. A `.tsbuildinfo` left over from the
    // previous run makes tsc believe nothing changed, so it exits 0 having
    // emitted nothing at all and downstream projects fail with TS2307.
    // `tsBuildInfoFile` is not a fix either: relative paths in a tsconfig are
    // resolved against the file that DECLARES them, so a value set here would
    // point every project at one shared file at the repository root.
    // Full builds take a few seconds; correctness is worth more.
    "incremental": false,
    "strict": true,
    "strictNullChecks": true,
    "strictPropertyInitialization": false,
    "noImplicitAny": true,
    "noImplicitOverride": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "exclude": ["node_modules", "dist", "build", ".next"]
}
```

