# Shared packages (@wlct/*)

The contracts every runtime agrees on: shared types, validated configuration, validation schemas and the crypto/util layer.

40 files. Part of the complete Part 1 source dump - see `docs/source/README.md`.

---

FILE: packages/config/package.json

```json
{
  "name": "@wlct/config",
  "version": "1.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "rimraf dist && tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "rimraf": "^5.0.7",
    "typescript": "^5.5.4"
  }
}
```

FILE: packages/config/src/constants.ts

```typescript
/** Platform-wide constants shared by every Node/TypeScript workload. */

export const HEADER_REQUEST_ID = 'x-request-id';
export const HEADER_TENANT_SLUG = 'x-tenant-slug';
export const HEADER_TENANT_ID = 'x-tenant-id';
export const HEADER_API_VERSION = 'x-api-version';
export const HEADER_TWO_FACTOR_TOKEN = 'x-2fa-token';
export const HEADER_DEVICE_ID = 'x-device-id';
export const HEADER_INTERNAL_TOKEN = 'x-internal-token';

/** Part 9: correlation ids ride headers across the service boundary. The
 *  values are UUIDs or nothing - both the API middleware and the Python
 *  services refuse unbounded input, so a header cannot smuggle text into
 *  log fields or incident rows. */
export const HEADER_CORRELATION_ID = 'x-correlation-id';
export const HEADER_IDEMPOTENCY_KEY = 'idempotency-key';

export const CACHE_TTL = {
  TENANT_RESOLUTION_SECONDS: 300,
  TENANT_PUBLIC_CONFIG_SECONDS: 120,
  USER_PERMISSIONS_SECONDS: 300,
  FEATURE_FLAGS_SECONDS: 60,
  PLAN_CATALOG_SECONDS: 600,
} as const;

export const CACHE_KEY = {
  tenantBySlug: (slug: string): string => `tenant:slug:${slug}`,
  tenantByDomain: (domain: string): string => `tenant:domain:${domain}`,
  tenantById: (id: string): string => `tenant:id:${id}`,
  tenantPublicConfig: (id: string): string => `tenant:${id}:public-config`,
  tenantFeatureFlags: (id: string): string => `tenant:${id}:feature-flags`,
  userPermissions: (userId: string): string => `user:${userId}:permissions`,
  userSessionVersion: (userId: string): string => `user:${userId}:session-version`,
  loginFailures: (tenantId: string, email: string): string =>
    `auth:failures:${tenantId}:${email.toLowerCase()}`,
  accountLock: (tenantId: string, email: string): string =>
    `auth:lock:${tenantId}:${email.toLowerCase()}`,
  revokedToken: (jti: string): string => `auth:revoked:${jti}`,
  idempotency: (tenantId: string, key: string): string => `idem:${tenantId}:${key}`,
} as const;

/** Part 10: response header echoing the W3C trace id (never the parent's raw
 *  traceparent - the id is correlation metadata for operators, the header
 *  full of routing bits is not something to hand to a browser). */
export const TRACE_ID_RESPONSE_HEADER = 'x-trace-id';

export const QUEUE_NAMES = {
  AUDIT: 'audit',
  EMAIL: 'email',
  NOTIFICATION: 'notification',
  SECURITY: 'security',
  MAINTENANCE: 'maintenance',
  BILLING: 'billing',
  // Registered now, consumed by the trading engine from Part 3.
  TRADE_SIGNAL: 'trade-signal',
  TRADE_EXECUTION: 'trade-execution',
  MARKET_SNAPSHOT: 'market-snapshot',
  /// Strategy lifecycle, backtests and paper sessions (Part 6). A separate
  /// queue from TRADE_EXECUTION on purpose: a backlog of backtests must never
  /// delay a cancel request.
  STRATEGY_CONTROL: 'strategy-control',
  /// Historical dataset ingestion and validation (Part 7). Separate from
  /// STRATEGY_CONTROL: a backfill that streams gigabytes must not queue in
  /// front of a cancel, and neither must delay the other's user-visible work.
  DATASET_CONTROL: 'dataset-control',
  /// Risk-control plane (Part 8). Publishes configuration versions to the
  /// engine's Redis pointers and mirrors hot state into Prisma. Separate
  /// from TRADE_EXECUTION on principle: a snapshot-sync backlog must never
  /// sit in front of - or behind - anything that can move an order, and a
  /// worker for this queue holds no credentials by design.
  RISK_CONTROL: 'risk-control',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const JOB_NAMES = {
  WRITE_AUDIT_LOG: 'write-audit-log',
  SEND_EMAIL: 'send-email',
  DISPATCH_NOTIFICATION: 'dispatch-notification',
  EVALUATE_SECURITY_EVENT: 'evaluate-security-event',
  PRUNE_EXPIRED_TOKENS: 'prune-expired-tokens',
  PRUNE_AUDIT_LOGS: 'prune-audit-logs',
  RECONCILE_SUBSCRIPTIONS: 'reconcile-subscriptions',

  // Authenticated execution (Part 5). Produced by the API, consumed by the
  // trading worker - the only process that holds venue credentials. The API
  // deliberately cannot perform these itself: it has no signing code and no
  // access to key material, which is what keeps the credential boundary a
  // process boundary rather than a code-review convention.
  VERIFY_EXCHANGE_CREDENTIALS: 'verify-exchange-credentials',
  REFRESH_ACCOUNT_BALANCES: 'refresh-account-balances',
  RECONCILE_TRADING_ACCOUNT: 'reconcile-trading-account',
  RESYNC_PRIVATE_STREAM: 'resync-private-stream',
  CANCEL_ORDER: 'cancel-order',

  // Strategy layer (Part 6). Produced by the API, consumed by the strategy
  // worker. None of them can place a live order: the strategy worker holds no
  // credential and the backtest and paper paths have no adapter that could
  // reach a venue.
  APPLY_STRATEGY_STATE: 'apply-strategy-state',
  RUN_BACKTEST: 'run-backtest',
  START_PAPER_SESSION: 'start-paper-session',
  STOP_PAPER_SESSION: 'stop-paper-session',
  CHECKPOINT_STRATEGY_STATE: 'checkpoint-strategy-state',

  // Historical datasets (Part 7). Produced by the API, consumed by the
  // dataset/strategy worker - the only process that fetches archives and
  // writes storage. The API enqueues intent and reads the registry's
  // projection; it never stores a dataset and never replays one.
  INGEST_HISTORICAL_DATASET: 'ingest-historical-dataset',
  VALIDATE_DATASET_VERSION: 'validate-dataset-version',
  SYNC_DATASET_STATUS: 'sync-dataset-status',

  // Risk engine (Part 8). Produced by the API's risk module; consumed by the
  // risk/state worker. None of these jobs can place, cancel or amend an
  // order: they publish *what the limits are* and mirror *what the engine
  // decided*. Enforcement stays in the engine's hot path.
  PUBLISH_RISK_CONFIGURATION: 'publish-risk-configuration',
  SYNC_RISK_SNAPSHOT: 'sync-risk-snapshot',
  RECONCILE_RISK_PROTECTIONS: 'reconcile-risk-protections',

  // Observability (Part 9). The alert sync folds each publisher service's
  // Redis alert mirror into durable rows (one writer: the API); pruning
  // honours explicit retention and never touches unresolved history.
  // Neither job can place, cancel or amend an order.
  SYNC_OPERATIONAL_ALERTS: 'sync-operational-alerts',
  PRUNE_OPERATIONAL_HISTORY: 'prune-operational-history',

  // Reliability (Part 10). Evaluation is a scheduled READ of already-recorded
  // evidence (queue mirrors, health mirrors, durable tables) plus an append
  // of evaluation rows; pruning removes rows the burn windows no longer read.
  // Neither job can place, cancel or amend an order, or resolve an alert.
  EVALUATE_OPERATIONAL_SLOS: 'evaluate-operational-slos',
  PRUNE_SLO_EVALUATIONS: 'prune-slo-evaluations',
} as const;

/** Prometheus text exposition content type (0.0.4). Pinned in one place so
 *  the API endpoint and the parity tests cannot drift apart. */
export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/** The typed phrase that must be quoted verbatim to force-resolve an alert
 *  without an observed recovery. Short enough to type under pressure,
 *  distinctive enough that it is never quoted by accident. (Alert
 *  auto-resolution goes through the sync job, which only resolves on
 *  observed recovery; this phrase is the exception path, and it is audited
 *  with the same seriousness as clearing a risk protection.) */
export const ALERT_FORCE_RESOLVE_PHRASE = 'FORCE RESOLVE ALERT';

/** Services whose observability mirrors the API syncs. A service not listed
 *  here is invisible to the fold, which is why the list is a constant:
 *  adding a publisher is a review, not a config typo. notification-service
 *  publishes nothing today and its absence must read as silence, not as
 *  recovery - the sync job only resolves rows whose publisher mirror is
 *  present-but-empty. */
export const OBS_PUBLISHER_SERVICES: readonly string[] = Object.freeze([
  'market-data',
  'trading-engine',
]);

// ---------------------------------------------------------------------------
// Part 10 (reliability) shared constants.
// ---------------------------------------------------------------------------

/** Counter bucket width for SLO sample sources, in minutes. The evaluators
 *  read whole buckets so both languages can reproduce window sums exactly;
 *  sub-bucket fractions are documented, not fudged. */
export const SLO_SAMPLE_BUCKET_MINUTES = 10;

/** Redis prefix for the SLO sample buckets: `wlct:trading:ops:slo:<source>:
 *  <yyyyMMddHHmm>`, hash fields `good`/`bad`. Bounded by the retention of
 *  the buckets themselves (2x the maximum window) - never a long memory. */
export const SLO_SAMPLE_KEY_PREFIX = 'wlct:trading:ops:slo';

/** Trace-context sidecar for queued jobs: `wlct:trading:ops:tracectx:
 *  <queue>:<jobId>`, TTL-bounded (a job that never runs must not keep the
 *  trace alive forever). Sidecar rather than payload field: job payloads
 *  have versioned schemas and replay semantics; the trace context is
 *  transport metadata and belongs beside them, not inside them. */
export const TRACECTX_KEY_PREFIX = 'wlct:trading:ops:tracectx';
export const TRACECTX_TTL_SECONDS = 600;

/** The OTLP/HTTP traces path appended to a configured OTEL_ENDPOINT. */
export const OTLP_TRACES_PATH = '/v1/traces';

export const PAGINATION_DEFAULTS = {
  PAGE: 1,
  LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

/** Fields scrubbed from every structured log line and audit payload. */
export const SENSITIVE_FIELD_NAMES: readonly string[] = Object.freeze([
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'accessToken',
  'refreshToken',
  'challengeToken',
  'idToken',
  'authorization',
  'cookie',
  'setCookie',
  'apiKey',
  'apiSecret',
  'secret',
  'secretKey',
  'privateKey',
  'passphrase',
  'mnemonic',
  'seedPhrase',
  'twoFactorSecret',
  'totpSecret',
  'recoveryCodes',
  'encryptionKey',
  'dek',
  'kek',
  'cardNumber',
  'cvv',
  'iban',
  'ssn',
  'clientSecret',
  'webhookSecret',
]);

export const REDACTED_PLACEHOLDER = '[REDACTED]';

export const SUPPORTED_LOCALES = ['en', 'es', 'ar', 'bn', 'tr'] as const;
export const RTL_LOCALES = ['ar'] as const;
export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'BDT', 'TRY'] as const;

export const FEATURE_FLAG_KEYS = {
  COPY_TRADING: 'copy_trading',
  FUTURES_TRADING: 'futures_trading',
  SPOT_TRADING: 'spot_trading',
  PAPER_TRADING: 'paper_trading',
  REFERRAL_PROGRAM: 'referral_program',
  KYC_REQUIRED: 'kyc_required',
  TWO_FACTOR_MANDATORY: 'two_factor_mandatory',
  PUBLIC_REGISTRATION: 'public_registration',
  CUSTOM_DOMAIN: 'custom_domain',
  MOBILE_APP: 'mobile_app',
  ADVANCED_ANALYTICS: 'advanced_analytics',
  WITHDRAWAL_NOTIFICATIONS: 'withdrawal_notifications',
} as const;

/**
 * Part 11 coordination keys (docs/PART11_SCALE.md). Leader leases live at
 * `wlct:trading:lock:leader:<name>` and partition claims at
 * `wlct:trading:lock:partition:<group>:<partition>` - deliberately inside
 * the lock namespace so one operational rule ("deleting a live key under
 * `lock:` can briefly double-run something; nothing else") covers every
 * coordination key too. The key builders and token grammar live with the
 * primitives (infrastructure/coordination); these prefixes exist so
 * anything that merely needs to RECOGNISE the namespace - key scanners,
 * audit tooling - does not re-spell the prefix.
 */
/** The coordination group for the trading worker's partitioned execution
 * plane (the value is the queue name string, deliberately restated as a
 * separate constant: the CLAIM namespace and the QUEUE are different
 * concepts that happen to share a label, and code should read which one it
 * means). Both the worker (claims) and the API (read-only ops view) compose
 * claim keys through this constant, and the Python side pins the same
 * string in docs/fixtures/coordination_fixtures.json - a rename must be a
 * coordinated, fixture-pinned change, never a local edit. */
export const WORKER_COORDINATION_GROUP = 'trade-execution';
export const COORD_LEADER_KEY_PREFIX = 'wlct:trading:lock:leader';
export const COORD_PARTITION_KEY_PREFIX = 'wlct:trading:lock:partition';
export const COORD_MEMBERSHIP_KEY_PREFIX = 'wlct:trading:coord:members';
```

FILE: packages/config/src/env.schema.ts

```typescript
import { z } from 'zod';

/**
 * Single source of truth for environment configuration.
 *
 * The schema is intentionally strict: the API refuses to boot when a value is
 * missing or malformed, which prevents an environment from silently starting
 * with, for example, an empty JWT secret.
 */

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') {
      return value;
    }
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  });

const intFromString = (defaultValue: number) =>
  z
    .union([z.number(), z.string()])
    .default(defaultValue)
    .transform((value, ctx) => {
      const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
      if (Number.isNaN(parsed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected an integer value' });
        return z.NEVER;
      }
      return parsed;
    });

/**
 * A fixed-point decimal carried as a string.
 *
 * Deliberately not parsed into a JavaScript `number`. Fees, capital and
 * slippage end up in Decimal arithmetic in the Python data plane and in
 * Prisma `Decimal` columns; round-tripping them through a binary float here
 * would introduce exactly the representation error the rest of the platform
 * takes care to avoid. The value is validated as finite and in range, then
 * passed on verbatim.
 */
const decimalFromString = (
  defaultValue: string,
  { min, max }: { min: number; max: number },
) =>
  z
    .union([z.number(), z.string()])
    .default(defaultValue)
    .transform((value, ctx) => {
      const text = typeof value === 'number' ? String(value) : value.trim();
      if (!/^-?\d+(\.\d+)?$/.test(text)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Expected a plain decimal number, for example 0.001',
        });
        return z.NEVER;
      }
      const parsed = Number.parseFloat(text);
      if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Expected a decimal between ${min} and ${max}`,
        });
        return z.NEVER;
      }
      return text;
    });

const csv = (defaultValue: string) =>
  z
    .string()
    .default(defaultValue)
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    );

const jsonRecord = z
  .string()
  .default('{}')
  .transform((value, ctx) => {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected a JSON object' });
        return z.NEVER;
      }
      return parsed as Record<string, string>;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected valid JSON' });
      return z.NEVER;
    }
  });

export const NodeEnvSchema = z.enum(['development', 'test', 'staging', 'production']);
export type NodeEnvironment = z.infer<typeof NodeEnvSchema>;

export const envSchema = z
  .object({
    // Application
    NODE_ENV: NodeEnvSchema.default('development'),
    APP_NAME: z.string().min(1).default('WhiteLabelCopyTrade'),
    API_PORT: intFromString(4000),
    API_HOST: z.string().default('0.0.0.0'),
    API_GLOBAL_PREFIX: z.string().default('api'),
    API_DEFAULT_VERSION: z.string().default('1'),
    API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
    ADMIN_WEB_URL: z.string().url().default('http://localhost:3000'),
    TRUST_PROXY_HOPS: intFromString(1),
    PLATFORM_ROOT_DOMAIN: z.string().default('copytrade.app'),
    DEFAULT_TENANT_SLUG: z.string().default('platform'),

    // Database
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DIRECT_DATABASE_URL: z.string().optional(),
    DATABASE_LOG_QUERIES: booleanFromString.default(false),
    DATABASE_SSL: booleanFromString.default(false),

    // Redis
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: intFromString(6379),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_DB: intFromString(0),
    REDIS_TLS: booleanFromString.default(false),
    REDIS_KEY_PREFIX: z.string().default('wlct:'),

    // JWT
    JWT_ALGORITHM: z.enum(['HS256', 'HS512', 'RS256', 'RS512']).default('HS256'),
    JWT_ACCESS_SECRET: z.string().optional(),
    JWT_REFRESH_SECRET: z.string().optional(),
    JWT_PRIVATE_KEY_BASE64: z.string().optional(),
    JWT_PUBLIC_KEY_BASE64: z.string().optional(),
    JWT_ACCESS_TTL: z.string().default('900s'),
    JWT_REFRESH_TTL: z.string().default('30d'),
    JWT_ISSUER: z.string().default('https://api.copytrade.app'),
    JWT_AUDIENCE: z.string().default('copytrade-clients'),
    MAX_ACTIVE_SESSIONS_PER_USER: intFromString(10),

    // Password / hashing
    PASSWORD_MIN_LENGTH: intFromString(12),
    ARGON2_MEMORY_COST: intFromString(19456),
    ARGON2_TIME_COST: intFromString(2),
    ARGON2_PARALLELISM: intFromString(1),
    LOGIN_MAX_FAILED_ATTEMPTS: intFromString(5),
    LOGIN_FAILED_WINDOW_SECONDS: intFromString(900),
    ACCOUNT_LOCKOUT_SECONDS: intFromString(900),

    // Encryption
    ENCRYPTION_MASTER_KEY_BASE64: z.string().min(1, 'ENCRYPTION_MASTER_KEY_BASE64 is required'),
    ENCRYPTION_KEY_ID: z.string().default('local-dev-v1'),
    ENCRYPTION_PREVIOUS_KEYS_JSON: jsonRecord,
    ENCRYPTION_PROVIDER: z.enum(['local', 'kms']).default('local'),
    KMS_PROVIDER: z.string().optional(),
    KMS_KEY_ARN: z.string().optional(),
    BLIND_INDEX_KEY_BASE64: z.string().min(1, 'BLIND_INDEX_KEY_BASE64 is required'),

    // Two factor
    TWO_FACTOR_ISSUER: z.string().default('CopyTrade'),
    TWO_FACTOR_WINDOW: intFromString(1),
    TWO_FACTOR_DIGITS: intFromString(6),
    TWO_FACTOR_PERIOD: intFromString(30),
    TWO_FACTOR_RECOVERY_CODES: intFromString(10),
    TWO_FACTOR_CHALLENGE_TTL: z.string().default('300s'),
    // How many codes may be tried against ONE challenge token before it is
    // burned. Without a bound the challenge would either be single-use (a
    // mistyped digit forces the user to re-enter their password) or unlimited
    // (a captured challenge could be brute-forced for its whole TTL).
    TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS: intFromString(5),

    // CORS
    CORS_ENABLED: booleanFromString.default(true),
    CORS_ORIGINS: csv('http://localhost:3000'),
    CORS_CREDENTIALS: booleanFromString.default(true),
    CORS_ALLOWED_HEADERS: csv(
      'Content-Type,Authorization,X-Tenant-Slug,X-Request-Id,X-Api-Version,Accept-Language,X-2FA-Token',
    ),
    CORS_EXPOSED_HEADERS: csv('X-Request-Id,X-RateLimit-Limit,X-RateLimit-Remaining'),

    // Rate limiting
    RATE_LIMIT_ENABLED: booleanFromString.default(true),
    RATE_LIMIT_TTL_SECONDS: intFromString(60),
    RATE_LIMIT_MAX: intFromString(120),
    RATE_LIMIT_AUTH_TTL_SECONDS: intFromString(300),
    RATE_LIMIT_AUTH_MAX: intFromString(10),
    RATE_LIMIT_TRUSTED_IPS: csv('127.0.0.1,::1'),

    // Swagger
    SWAGGER_ENABLED: booleanFromString.default(true),
    SWAGGER_PATH: z.string().default('docs'),
    SWAGGER_TITLE: z.string().default('White-Label Copy Trading API'),
    SWAGGER_DESCRIPTION: z.string().default('Multi-tenant crypto copy-trading platform API'),
    SWAGGER_VERSION: z.string().default('1.0.0'),
    SWAGGER_USER: z.string().optional(),
    SWAGGER_PASSWORD: z.string().optional(),

    // Logging
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
    LOG_REQUEST_BODY: booleanFromString.default(false),
    LOG_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
    SENTRY_DSN: z.string().optional(),

    // WebSocket
    WS_ENABLED: booleanFromString.default(true),
    WS_PATH: z.string().default('/realtime'),
    WS_NAMESPACE: z.string().default('/v1'),
    WS_PING_INTERVAL_MS: intFromString(25000),
    WS_PING_TIMEOUT_MS: intFromString(20000),
    WS_MAX_CONNECTIONS_PER_USER: intFromString(5),
    WS_REDIS_ADAPTER: booleanFromString.default(true),

    // Queues
    QUEUE_PREFIX: z.string().default('wlct-queue'),
    QUEUE_DEFAULT_ATTEMPTS: intFromString(5),
    QUEUE_BACKOFF_MS: intFromString(5000),
    QUEUE_REMOVE_ON_COMPLETE: intFromString(1000),
    QUEUE_REMOVE_ON_FAIL: intFromString(5000),
    QUEUE_CONCURRENCY: intFromString(10),
    QUEUE_RUN_INLINE_WORKERS: booleanFromString.default(true),
    BULL_BOARD_ENABLED: booleanFromString.default(false),
    BULL_BOARD_PATH: z.string().default('admin/queues'),

    // Exchanges / internal services
    EXCHANGES_ENABLED: csv('binance,bybit,okx,kraken'),
    EXCHANGE_SANDBOX_MODE: booleanFromString.default(true),
    EXCHANGE_REQUEST_TIMEOUT_MS: intFromString(10000),
    EXCHANGE_MAX_RETRIES: intFromString(3),
    EXECUTION_ENABLED: booleanFromString.default(false),

    // --- Part 5: authenticated execution -------------------------------
    // Every one of these defaults to the safe value. Omission is never
    // consent: an operator who forgets a variable gets paper trading with
    // transmission disabled, not live money.

    /// Venue credentials for the platform-level dev/testnet account. Tenant
    /// accounts keep their own credentials in the database or a secret
    /// manager; these exist so a developer can run the smoke harness without
    /// provisioning a tenant. Never logged, never returned by an endpoint.
    BINANCE_API_KEY: z.string().optional(),
    BINANCE_API_SECRET: z.string().optional(),

    /// The master arming switch. False means no signed order request is ever
    /// transmitted, whatever any per-account flag says.
    LIVE_TRADING_ENABLED: booleanFromString.default(false),
    /// Build and sign the request, validate it, then stop. Nothing leaves the
    /// process and nothing is ever reported as submitted.
    DRY_RUN: booleanFromString.default(true),
    /// Route orders to the simulated venue. Simulated fills are labelled.
    PAPER_TRADING: booleanFromString.default(true),

    /// How long to wait for a submit response before the outcome is treated
    /// as unknown. A timeout is not a rejection.
    ORDER_REQUEST_TIMEOUT_MS: intFromString(10000),
    /// Interval between scheduled reconciliation sweeps.
    ORDER_RECONCILIATION_INTERVAL_MS: intFromString(30000),
    /// Whether the private user-data stream reconnects itself.
    PRIVATE_STREAM_RECONNECT_ENABLED: booleanFromString.default(true),
    /// How often to re-measure the offset between local and venue clocks.
    EXCHANGE_TIME_SYNC_INTERVAL_MS: intFromString(300000),
    /// Lifetime of an idempotency key. Must comfortably exceed the longest
    /// plausible retry window, or a duplicate slips through.
    EXECUTION_IDEMPOTENCY_TTL_SECONDS: intFromString(86400),
    /// Grace period before querying the venue about an unknown order. The
    /// venue may simply not have finished processing it yet.
    ORDER_UNKNOWN_RECONCILIATION_DELAY_MS: intFromString(2000),
    // --- Part 6: strategy engine, paper trading, backtesting -----------
    // The strategy layer produces signals. It cannot submit an order, and
    // none of these variables can enable live trading: that still requires
    // LIVE_TRADING_ENABLED, EXECUTION_ENABLED, DRY_RUN=false, PAPER_TRADING=
    // false and EXCHANGE_SANDBOX_MODE=false to agree, all validated above.

    /// Master switch for the strategy engine. Off by default: a deployment
    /// that has not been asked to run strategies should not run them.
    STRATEGY_ENGINE_ENABLED: booleanFromString.default(false),
    /// Whether paper sessions may be started. Paper sessions route to the
    /// simulated adapter only.
    PAPER_TRADING_ENABLED: booleanFromString.default(true),
    /// Whether backtests may be submitted. A backtest touches no venue.
    BACKTEST_ENABLED: booleanFromString.default(true),

    /// Bound on the in-process market-data queue feeding the strategies. A
    /// bounded queue is what turns a slow strategy into shed load rather than
    /// unbounded memory growth.
    STRATEGY_EVENT_QUEUE_SIZE: intFromString(10000),
    /// Hard cap on concurrently registered strategy instances per process.
    STRATEGY_MAX_INSTANCES: intFromString(50),
    /// Observation budget for one dispatch. Exceeding it increments a counter
    /// and marks the dispatch slow. It is not a latency guarantee and this
    /// platform does not offer one.
    STRATEGY_MAX_PROCESSING_LATENCY_MS: intFromString(50),

    /// A signal older than this is refused by the validator rather than acted
    /// on. Stale intent is how a backlog becomes a bad fill.
    SIGNAL_MAX_AGE_MS: intFromString(2000),
    /// How long a signal identity is remembered for deduplication. This is a
    /// bounded in-memory guard against a strategy repeating itself, not the
    /// order idempotency system, which lives in the execution layer.
    SIGNAL_DEDUP_TTL_SECONDS: intFromString(5),

    /// Defaults applied to a backtest that does not specify its own. They are
    /// assumptions, they are recorded in the configuration hash of every run,
    /// and they do not describe any real account.
    BACKTEST_DEFAULT_INITIAL_CAPITAL: decimalFromString('10000', {
      min: 0.00000001,
      max: 1000000000,
    }),
    /// Fee rates, not basis points: 0.001 is ten basis points.
    BACKTEST_DEFAULT_MAKER_FEE: decimalFromString('0.001', { min: 0, max: 0.1 }),
    BACKTEST_DEFAULT_TAKER_FEE: decimalFromString('0.001', { min: 0, max: 0.1 }),
    /// Slippage in basis points applied against every simulated taker fill.
    BACKTEST_DEFAULT_SLIPPAGE_BPS: decimalFromString('1', { min: 0, max: 1000 }),

    // ---------------------------------------------------------------------
    // Part 7: historical datasets, ingestion, validation, replay
    //
    // None of these can enable live trading, and none of them can make a
    // backtest read a venue: a dataset is a frozen file, fetched by an
    // explicit ingestion job over public data, with no credentials in the
    // picture anywhere. What they govern is storage, validation policy and
    // whether backtests must cite a registered dataset version.

    /// Which storage backend serves datasets. Only local ships; the enum
    /// exists so a future object-storage implementation is a *value change*,
    /// never a schema edit that could silently accept a typo today.
    DATASET_STORAGE_BACKEND: z.enum(['local']).default('local'),
    /// Root for finalised dataset trees. Relative paths are permitted outside
    /// production for developer convenience; production must be absolute
    /// (checked below) because a dataset root under a process CWD that moves
    /// is a dataset that vanishes.
    DATASET_LOCAL_ROOT: z.string().min(1).default('./data/datasets'),
    /// Staging root for in-flight ingestion. MUST live on the same
    /// filesystem as DATASET_LOCAL_ROOT: finalisation is a rename, and a
    /// cross-device rename either fails or silently degrades into a copy.
    DATASET_TEMP_ROOT: z.string().min(1).default('./data/staging'),
    /// Hard ceiling for one partition file, in bytes. Bounds memory in the
    /// writer and in validation re-reads; the reader also uses it to size
    /// its per-file decompression bomb ceiling.
    DATASET_MAX_PARTITION_BYTES: intFromString(268435456),
    /// Streaming reader chunk size. This is the only read-buffer knob a
    /// replay sees; there is no path that grows with file size.
    DATASET_READER_BUFFER_SIZE: intFromString(65536),
    /// Whether newly ingested versions are validated before they become
    /// visible. Turning this off is for emergency re-ingest of data that was
    /// validated elsewhere; the resulting manifest is stamped unvalidated,
    /// so it can never be confused with a validated one.
    DATASET_VALIDATION_ENABLED: booleanFromString.default(true),
    /// Cap on per-stream gap findings retained in a report. The *count* is
    /// always exact; this only bounds how many identical lines the report
    /// repeats.
    DATASET_MAX_GAP_WARNINGS: intFromString(100),
    /// Event ceiling per partition. Sizing policy, not correctness: keeps
    /// files re-readable on modest hardware.
    DATASET_MAX_EVENTS_PER_PARTITION: intFromString(2000000),
    /// Retention policy for NON-validated artefacts (failed staging).
    /// 'retain' keeps everything; 'purge_staging_only' may delete STAGING
    /// areas after a failed job. Quarantined evidence is never deleted by
    /// policy - the name states that limit rather than hiding it.
    DATASET_RETENTION_POLICY: z.enum(['retain', 'purge_staging_only']).default('retain'),
    /// Master switch for ingestion jobs. Off by default and deliberately
    /// never auto-enabled: an ingestion storm from a mis-clicked dashboard is
    /// a storage and egress incident. This is the ONLY thing that lets
    /// POST /datasets/ingest enqueue work.
    HISTORICAL_INGESTION_ENABLED: booleanFromString.default(false),
    /// When true, a backtest submission must name a registered dataset
    /// version (datasetVersionId). This is what stops "latest mutable data"
    /// from becoming an unexamined habit: a run without a pinned, checksumed
    /// dataset version is exactly the anecdote Part 7 exists to abolish.
    BACKTEST_DATASET_REQUIRED: booleanFromString.default(true),

    // ---------------------------------------------------------------------------
    // Part 8: real-time risk engine - control-plane configuration.
    //
    // The API does not evaluate risk; it publishes the *platform default
    // ceilings* below and the per-account versioned configuration documents
    // that the trading worker's RiskGate consumes. What these values are NOT:
    // an allowance for anyone. They are ceilings - the gate resolves
    // GLOBAL -> EXCHANGE -> ACCOUNT -> STRATEGY -> SYMBOL and takes the
    // tightest applicable entry per rule (see wlct_trading.risk.configuration
    // for the single authority on that sentence). What they ARE: the floor
    // of last resort. An unset rule here means "no platform opinion" at the
    // GLOBAL scope - and because child scopes can only tighten, an absent
    // platform ceiling is the ONLY way an account-scoped entry can be wider
    // than nothing; every default below is deliberately conservative, and
    // the doc notes on each state exactly that.
    // ---------------------------------------------------------------------------

    /// Master switch for the extended Part 8 risk gate requirement. TRUE by
    /// default and checked in production: with it on, a trading worker that
    /// starts without a wired RiskGate refuses to boot (fail closed at wiring
    /// time). It cannot disable the Part 2 core gate - no flag does.
    RISK_ENGINE_ENABLED: booleanFromString.default(true),
    /// The engine's governing rule as a startup assertion. Only `true` is a
    /// legal value anywhere; `RISK_FAIL_CLOSED=false` is a configuration
    /// error at parse time, not a mode. A key that can be set to a lethal
    /// value is a key someone will set to a lethal value at 3am.
    RISK_FAIL_CLOSED: booleanFromString.default(true),
    /// How old a hot risk snapshot may be when an order is evaluated
    /// (milliseconds). 2000ms is the default because it is the window in
    /// which a fill or cancel on the same account is *already expected* by
    /// the event pipeline; beyond it, the state is presumed stale and
    /// risk-increasing orders are refused.
    MAX_RISK_STATE_AGE_MS: intFromString(2000),
    /// Cadence at which the state worker republishes account snapshots.
    /// Refresh cannot be slower than the staleness budget or the system is
    /// guaranteed stale; the refine below enforces the ordering.
    RISK_SNAPSHOT_REFRESH_MS: intFromString(250),
    // -- Platform default ceilings (quote-currency notionals; conservative) --
    MAX_ORDER_NOTIONAL: decimalFromString('1000', { min: 0.000001, max: 100000000000 }),
    MAX_POSITION_NOTIONAL: decimalFromString('5000', { min: 0.000001, max: 100000000000 }),
    MAX_ACCOUNT_EXPOSURE: decimalFromString('10000', { min: 0.000001, max: 100000000000 }),
    MAX_STRATEGY_EXPOSURE: decimalFromString('5000', { min: 0.000001, max: 100000000000 }),
    MAX_SYMBOL_EXPOSURE: decimalFromString('5000', { min: 0.000001, max: 100000000000 }),
    MAX_OPEN_ORDERS: intFromString(20),
    MAX_DAILY_LOSS: decimalFromString('500', { min: 0.000001, max: 100000000000 }),
    MAX_STRATEGY_DAILY_LOSS: decimalFromString('250', { min: 0.000001, max: 100000000000 }),
    /// Drawdown against peak equity, percent. 10% default: an account that
    /// has lost a tenth of its high-water mark has already exceeded what any
    /// strategy was designed through.
    MAX_DRAWDOWN: decimalFromString('10', { min: 0.01, max: 100 }),
    MAX_ORDERS_PER_SECOND: intFromString(2),
    MAX_ORDERS_PER_MINUTE: intFromString(30),
    MAX_CANCELS_PER_SECOND: intFromString(2),
    MAX_CANCELS_PER_MINUTE: intFromString(30),
    /// Fat-finger band for limit prices against the side-touch reference, in
    /// basis points. 250 bps (2.5%) is generous for majors and still refuses
    /// the digit-slip class of error outright.
    MAX_PRICE_DEVIATION_BPS: intFromString(250),
    MAX_CONSECUTIVE_LOSSES: intFromString(5),
    /// Days risk-event rows are retained before the maintenance queue prunes
    /// them (audit rows for the same acts live in the audit log's own
    /// retention; this is the operator-facing trail, not the accounting one).
    RISK_EVENTS_RETENTION_DAYS: intFromString(365),

    // ---------------------------------------------------------------------------
    // Observability & operations (Part 9)
    //
    // These are publication and retention settings - never trading settings.
    // In production the enabled-flags cannot be off: the validation enforces
    // it at parse time, because an operator panel that can be switched away
    // during the incident it exists for is not an operator panel. METRICS_TOKEN
    // is required in production so the /metrics surface is never open on a
    // shared listener; outside production an unauthenticated /metrics is
    // allowed and the endpoint logs that fact once at startup.
    // ---------------------------------------------------------------------------
    OBSERVABILITY_ENABLED: booleanFromString.default(true),
    METRICS_ENABLED: booleanFromString.default(true),
    HEALTH_ENABLED: booleanFromString.default(true),
    PROMETHEUS_ENABLED: booleanFromString.default(true),
    PROMETHEUS_PATH: z
      .string()
      .regex(/^\/[a-z0-9\/_-]{1,63}$/, 'PROMETHEUS_PATH must be a simple absolute path')
      .default('/metrics'),
    METRICS_TOKEN: z
      .string()
      .min(16, 'METRICS_TOKEN must be at least 16 characters when set')
      .optional(),
    ALERTING_ENABLED: booleanFromString.default(true),
    /// Occurrences reported by a publisher are cumulative; the dedupe window
    /// governs how long a *missing* publisher mirror is tolerated before the
    /// sync job flags it (never before it resolves anything - absence is
    /// flagged, recovery is only ever observed).
    ALERT_DEDUP_WINDOW_MS: intFromString(60_000),
    /// A queue's oldest pending job past this age is an alert. The execution
    /// queue reuses the number but not the severity: its alert is CRITICAL by
    /// the per-queue policy in the sync service, and it fires at half the age
    /// (hard-coded ratio, not a second knob nobody will tune under pressure).
    QUEUE_ALERT_AGE_MS: intFromString(120_000),
    HEALTH_REFRESH_MS: intFromString(5_000),
    METRICS_EXPORT_INTERVAL_MS: intFromString(15_000),
    /// Resolved alerts may be pruned after this many days. OPEN and
    /// ACKNOWLEDGED rows are NEVER pruned regardless of age - an alert that
    /// stayed unresolved is the most important row in the table, not the
    /// first candidate for deletion.
    ALERT_RETENTION_DAYS: intFromString(90),
    INCIDENT_RETENTION_DAYS: intFromString(365),

    // --- Part 10: reliability (tracing, SLO evaluation, fault injection) --
    // Same rule as the Part 9 switches: these govern what telemetry LEAVES
    // and what the panel MEASURES. None of them can loosen a risk gate,
    // approve an order, or silence evidence that already exists.
    /// Master tracing switch for this process. Off by default: a process
    /// pointed at no collector must not pay an HTTP timeout per export.
    OTEL_ENABLED: booleanFromString.default(false),
    /// OTLP/HTTP base URL; spans are POSTed to <endpoint>/v1/traces as
    /// OTLP/JSON. Optional: with OTEL_ENABLED=true and no endpoint, drops
    /// are counted and the export-outcome alert says so - dark on purpose
    /// is different from dark by accident.
    OTEL_ENDPOINT: z.string().url().optional(),
    OTEL_TIMEOUT_MS: intFromString(2_000),
    /// Head-based sampling ratio. Integer ppm arithmetic in the tracer; this
    /// is the single float the operator types, converted once, at the edge.
    OTEL_SAMPLE_RATIO: z.coerce.number().min(0).max(1).default(0.1),
    /// Comma-separated operations exempt from ratio sampling. Bounded by the
    /// engine's TRACED_OPERATIONS allow-list; unknown names are dropped at
    /// the tracer with a counted reason, never guessed at.
    OTEL_PRIORITY_OPERATIONS: z.string().default('execution.transmit'),
    /// Arming switch for the closed fault-point universe. Valid ONLY outside
    /// production and only with the guard below on; the API exposes no lever
    /// that reads or clears these counters (describe only).
    FAILURE_INJECTION_ENABLED: booleanFromString.default(false),
    FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY: booleanFromString.default(true),
    /// The SLO machinery (evaluation job, panel rollup). Default on: the
    /// panel's rollup block must have data to render even where nobody has
    /// configured a collector yet.
    SLO_ENABLED: booleanFromString.default(true),
    /// Minutes between scheduled evaluations. Must not exceed the shortest
    /// SLO window or a window would be judged on fewer ticks than designed.
    SLO_EVALUATION_INTERVAL_MINUTES: intFromString(5),
    /// Evaluation rows older than this are pruned (config rows are NEVER
    /// pruned - they are the versioned promise history). 7-day floor: the
    /// burn windows read up to 7 days back; pruning them away would make
    /// every long-window UNKNOWN.
    SLO_RETENTION_DAYS: intFromString(30),
    /// Default evaluation window (minutes) for definitions published without
    /// one. Mirrors the engine's accepted band.
    SLO_DEFAULT_WINDOW_MINUTES: intFromString(1_440),
    /// Classic multi-window paging thresholds, as decimal strings of the
    /// multiplier (14.4x / 6x); the service converts them to integer ppm.
    /// Strings, not numbers: the config file must not be where a float first
    /// touches a checksummed identity.
    SLO_FAST_BURN_MULTIPLIER: z.string().default('14.4'),
    SLO_SLOW_BURN_MULTIPLIER: z.string().default('6'),

    // --- Part 11: trading-worker plane ---------------------------------
    // Two independent knobs share a philosophy: everything defaults to
    // "do less until explicitly configured". The API process never hosts
    // worker consumers at all (the worker module is only imported by
    // src/worker.ts); these values exist for that process.
    /// Worker entry-point latch. False makes the worker boot refuse to
    /// consume (it exits nonzero with a reason) rather than run a
    /// quietly-idle consumer - an operator who started a worker expects it
    /// to work, and one who did not should not have started it.
    WORKER_ENABLED: booleanFromString.default(true),
    /// Stable identity for partition claims and logs. Left unset, the
    /// runtime composes `host:pid:<uuid>`; set it per-replica in compose /
    /// k8s so a restart reclaims its own partitions rather than racing.
    WORKER_ID: z.string().min(1).max(128).optional(),
    /// The membership the deterministic assignment is computed over, as a
    /// comma-separated list of worker ids. Empty means "this worker alone".
    /// Membership is a COORDINATED config value (every replica must see the
    /// same list); the claims are what make a stale list harmless - a worker
    /// that is not actually the owner will fail to claim and defer.
    WORKER_MEMBERSHIP: z.string().max(2048).default(''),
    /// Which SOURCE live membership comes from. 'config' is Part 11's
    /// behaviour (the list above IS the fleet). 'registry' makes workers
    /// self-register through the Redis heartbeat zset (Part 12): the config
    /// list degrades to the documented fallback for the first tick and for
    /// registry-outage ticks. Neither mode changes the authority law -
    /// membership says who WANTS a partition, claims decide who HAS one -
    /// so 'registry' can be flipped per-deployment without a flag day.
    WORKER_MEMBERSHIP_MODE: z.enum(['config', 'registry']).default('config'),
    /// How long one missed heartbeats' worth of silence survives in the
    /// registry, in ms. Floor 1000: below one second this is jitter noise.
    /// The registry mode adds a cross-law (below): it must outlive two full
    /// coordination ticks, or a single lost ping demotes a live worker from
    /// membership while its claims are still fresh - churn with no gain.
    WORKER_MEMBERSHIP_TTL_MS: intFromString(30_000),
    /// Width of the partitioned keyspace. Changing this rescales the
    /// assignment for EVERY worker at once - it is a coordinated config
    /// change, not a tuning knob, and the fixture ceiling (4096) holds it.
    WORKER_PARTITION_COUNT: intFromString(8),
    WORKER_PARTITION_LEASE_TTL_MS: intFromString(15_000),
    /// Cadence of the claim-renewal tick between job batches.
    WORKER_PARTITION_RETRY_MS: intFromString(2_500),
    /// How long a deferred (not-owned-by-this-worker) job waits before
    /// redelivery. Floor 250ms: below that this is a spin lock wearing a
    /// queue's clothes.
    WORKER_DEFER_DELAY_MS: intFromString(3_000),
    /// Consecutive defers tolerated before the job fails visibly. Deferring
    /// does not consume BullMQ attempts, so without a ceiling a job whose
    /// partition nobody can claim pends forever and nothing alerts.
    WORKER_MAX_DEFERS: intFromString(30),
    /// Graceful-shutdown budget: close the consumer, finish in-flight jobs,
    /// release held claims. Past it, claims are released by TTL instead -
    /// which is exactly the degraded path the coordination layer supports.
    WORKER_SHUTDOWN_TIMEOUT_MS: intFromString(10_000),

    /// The execution engine (services/execution-engine) the worker
    /// forwards venue-side commands to. It holds the credentials; this
    /// process holds the queue.
    EXECUTION_ENGINE_URL: z.string().url().default('http://127.0.0.1:8093'),
    /// Shared secret with the execution engine. Optional at schema level
    /// because the API does not need it; the worker boot refuses without
    /// it (32 chars minimum, enforced both here and at the engine).
    EXECUTION_ENGINE_TOKEN: z.string().min(32).optional(),

    // --- Part 11: read-replica policy -----------------------------------
    /// Off until BOTH the URL and this flag are set: a deployment that
    /// configures only the URL gets a boot error naming the missing half,
    /// never a silently-disabled replica the operator believes is live.
    DATABASE_READ_ENABLED: booleanFromString.default(false),
    DATABASE_READ_URL: z.string().optional(),
    /// Freshness ceiling for replica-eligible reads. When lag exceeds it,
    /// the read goes to the PRIMARY (slower, correct), and the excess is a
    /// metric, not an error.
    DATABASE_READ_MAX_LAG_MS: intFromString(1_500),

    TRADING_ENGINE_URL: z.string().url().default('http://localhost:8001'),
    TRADING_ENGINE_HEALTH_PATH: z.string().default('/health'),
    MARKET_DATA_URL: z.string().url().default('http://localhost:8002'),
    MARKET_DATA_HEALTH_PATH: z.string().default('/health'),
    NOTIFICATION_SERVICE_URL: z.string().url().default('http://localhost:8003'),
    NOTIFICATION_SERVICE_HEALTH_PATH: z.string().default('/health'),
    INTERNAL_SERVICE_TOKEN: z.string().min(16, 'INTERNAL_SERVICE_TOKEN must be at least 16 chars'),
    EXCHANGE_WEBHOOK_SIGNING_SECRET: z.string().min(16),

    // Email
    MAIL_DRIVER: z.enum(['smtp', 'ses', 'postmark', 'console']).default('console'),
    MAIL_FROM_NAME: z.string().default('CopyTrade'),
    MAIL_FROM_ADDRESS: z.string().email().default('no-reply@copytrade.app'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: intFromString(587),
    SMTP_SECURE: booleanFromString.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),

    // Notifications
    NOTIFICATIONS_ENABLED: booleanFromString.default(true),
    FIREBASE_PROJECT_ID: z.string().optional(),
    FIREBASE_CLIENT_EMAIL: z.string().optional(),
    FIREBASE_PRIVATE_KEY_BASE64: z.string().optional(),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM_NUMBER: z.string().optional(),

    // Localisation / currency
    DEFAULT_LOCALE: z.string().default('en'),
    SUPPORTED_LOCALES: csv('en,es,ar,bn,tr'),
    DEFAULT_CURRENCY: z.string().default('USD'),
    SUPPORTED_CURRENCIES: csv('USD,EUR,GBP,AED,BDT,TRY'),
    FX_RATES_PROVIDER: z.string().default('none'),
    FX_RATES_API_KEY: z.string().optional(),

    // KYC
    KYC_PROVIDER: z.enum(['none', 'sumsub', 'onfido', 'shufti']).default('none'),
    KYC_API_URL: z.string().optional(),
    KYC_APP_TOKEN: z.string().optional(),
    KYC_SECRET_KEY: z.string().optional(),
    KYC_WEBHOOK_SECRET: z.string().optional(),

    // Billing
    BILLING_PROVIDER: z.enum(['none', 'stripe', 'nowpayments']).default('none'),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    NOWPAYMENTS_API_KEY: z.string().optional(),
    NOWPAYMENTS_IPN_SECRET: z.string().optional(),

    // Seed
    SEED_SUPER_ADMIN_EMAIL: z.string().email().default('superadmin@copytrade.app'),
    SEED_SUPER_ADMIN_PASSWORD: z.string().optional(),
    SEED_TENANT_ADMIN_EMAIL: z.string().email().default('admin@acme-capital.test'),
    SEED_TENANT_ADMIN_PASSWORD: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const symmetric = env.JWT_ALGORITHM.startsWith('HS');
    if (symmetric) {
      if (!env.JWT_ACCESS_SECRET || env.JWT_ACCESS_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: 'JWT_ACCESS_SECRET must be at least 32 characters when using an HS algorithm',
        });
      }
      if (!env.JWT_REFRESH_SECRET || env.JWT_REFRESH_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message: 'JWT_REFRESH_SECRET must be at least 32 characters when using an HS algorithm',
        });
      }
      if (
        env.JWT_ACCESS_SECRET &&
        env.JWT_REFRESH_SECRET &&
        env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message: 'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET',
        });
      }
    } else {
      if (!env.JWT_PRIVATE_KEY_BASE64) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_PRIVATE_KEY_BASE64'],
          message: 'JWT_PRIVATE_KEY_BASE64 is required for RS algorithms',
        });
      }
      if (!env.JWT_PUBLIC_KEY_BASE64) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_PUBLIC_KEY_BASE64'],
          message: 'JWT_PUBLIC_KEY_BASE64 is required for RS algorithms',
        });
      }
    }

    const masterKey = Buffer.from(env.ENCRYPTION_MASTER_KEY_BASE64, 'base64');
    if (masterKey.length !== 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ENCRYPTION_MASTER_KEY_BASE64'],
        message: 'ENCRYPTION_MASTER_KEY_BASE64 must decode to exactly 32 bytes (AES-256)',
      });
    }

    const blindIndexKey = Buffer.from(env.BLIND_INDEX_KEY_BASE64, 'base64');
    if (blindIndexKey.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BLIND_INDEX_KEY_BASE64'],
        message: 'BLIND_INDEX_KEY_BASE64 must decode to at least 32 bytes',
      });
    }

    if (env.NODE_ENV === 'production') {
      if (env.SWAGGER_ENABLED && !env.SWAGGER_PASSWORD) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SWAGGER_PASSWORD'],
          message: 'Swagger must be protected with basic auth in production',
        });
      }
    }

    // -----------------------------------------------------------------------
    // Part 5: execution mode coherence
    // -----------------------------------------------------------------------
    // These combinations are contradictory. The platform refuses to boot
    // rather than pick one, because every possible automatic resolution is
    // either surprising or dangerous, and "surprising" on a money path is
    // just "dangerous" with a delay.

    if (env.LIVE_TRADING_ENABLED && env.DRY_RUN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DRY_RUN'],
        message:
          'LIVE_TRADING_ENABLED=true conflicts with DRY_RUN=true. ' +
          'Dry run never transmits, so live trading could not work; and silently ' +
          'preferring either one would mean guessing whether you wanted real ' +
          'orders. Set exactly one of them.',
      });
    }

    if (env.LIVE_TRADING_ENABLED && env.PAPER_TRADING) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAPER_TRADING'],
        message:
          'LIVE_TRADING_ENABLED=true conflicts with PAPER_TRADING=true. ' +
          'Set PAPER_TRADING=false to trade live, or LIVE_TRADING_ENABLED=false ' +
          'to keep simulating.',
      });
    }

    if (env.LIVE_TRADING_ENABLED && !env.EXECUTION_ENABLED) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EXECUTION_ENABLED'],
        message:
          'LIVE_TRADING_ENABLED=true requires EXECUTION_ENABLED=true. ' +
          'The execution pipeline is the thing that enforces the risk engine ' +
          'and the kill switches; arming live trading without it is not a ' +
          'configuration this platform will run.',
      });
    }

    if (env.LIVE_TRADING_ENABLED && env.EXCHANGE_SANDBOX_MODE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EXCHANGE_SANDBOX_MODE'],
        message:
          'LIVE_TRADING_ENABLED=true conflicts with EXCHANGE_SANDBOX_MODE=true. ' +
          'Sandbox mode points the adapters at testnet endpoints.',
      });
    }

    // A credential pair is all-or-nothing. A key without its secret produces a
    // signature failure on the first live request, which is a confusing way to
    // discover a typo in a .env file.
    if (Boolean(env.BINANCE_API_KEY) !== Boolean(env.BINANCE_API_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [env.BINANCE_API_KEY ? 'BINANCE_API_SECRET' : 'BINANCE_API_KEY'],
        message:
          'BINANCE_API_KEY and BINANCE_API_SECRET must be provided together, or ' +
          'both omitted.',
      });
    }

    if (env.LIVE_TRADING_ENABLED && env.ORDER_REQUEST_TIMEOUT_MS < 1000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ORDER_REQUEST_TIMEOUT_MS'],
        message:
          'ORDER_REQUEST_TIMEOUT_MS below 1000ms will manufacture unknown order ' +
          'results under normal network jitter. Each one blocks the order until ' +
          'reconciliation resolves it.',
      });
    }

    // The idempotency key must outlive the reconciliation of the order it
    // guards. If it expires first, a retry of the same intent is no longer
    // recognised as a duplicate and becomes a second real position.
    const idempotencyTtlMs = env.EXECUTION_IDEMPOTENCY_TTL_SECONDS * 1000;
    if (idempotencyTtlMs <= env.ORDER_RECONCILIATION_INTERVAL_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EXECUTION_IDEMPOTENCY_TTL_SECONDS'],
        message:
          'EXECUTION_IDEMPOTENCY_TTL_SECONDS must exceed ' +
          'ORDER_RECONCILIATION_INTERVAL_MS. An idempotency key that expires ' +
          'before its order is reconciled stops preventing duplicates.',
      });
    }

    // --- Part 6 -------------------------------------------------------

    // A strategy engine with nowhere to send a signal is a misconfiguration,
    // not a safe default: it burns CPU on every market-data event and silently
    // discards every decision.
    if (
      env.STRATEGY_ENGINE_ENABLED &&
      !env.PAPER_TRADING_ENABLED &&
      !env.BACKTEST_ENABLED &&
      !env.EXECUTION_ENABLED
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRATEGY_ENGINE_ENABLED'],
        message:
          'STRATEGY_ENGINE_ENABLED=true requires at least one consumer: ' +
          'PAPER_TRADING_ENABLED, BACKTEST_ENABLED or EXECUTION_ENABLED. ' +
          'Enabling the engine alone processes every event and discards every ' +
          'signal.',
      });
    }

    // The dedup window must outlive the signals it deduplicates. If it expires
    // first, a strategy repeating itself produces a second order while the
    // first is still considered current.
    if (env.SIGNAL_DEDUP_TTL_SECONDS * 1000 < env.SIGNAL_MAX_AGE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SIGNAL_DEDUP_TTL_SECONDS'],
        message:
          'SIGNAL_DEDUP_TTL_SECONDS must cover at least SIGNAL_MAX_AGE_MS. A ' +
          'dedup entry that expires while the signal it guards is still valid ' +
          'stops preventing duplicate signals.',
      });
    }

    // A processing budget larger than the signal validity window would make
    // every signal stale by construction.
    if (env.STRATEGY_MAX_PROCESSING_LATENCY_MS >= env.SIGNAL_MAX_AGE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRATEGY_MAX_PROCESSING_LATENCY_MS'],
        message:
          'STRATEGY_MAX_PROCESSING_LATENCY_MS must be well below ' +
          'SIGNAL_MAX_AGE_MS, otherwise a dispatch that merely hits its budget ' +
          'produces a signal the validator will refuse as stale.',
      });
    }

    if (env.STRATEGY_EVENT_QUEUE_SIZE < 100 || env.STRATEGY_EVENT_QUEUE_SIZE > 1000000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRATEGY_EVENT_QUEUE_SIZE'],
        message:
          'STRATEGY_EVENT_QUEUE_SIZE must be between 100 and 1000000. Too small ' +
          'sheds load on every burst; too large defers backpressure until the ' +
          'process runs out of memory.',
      });
    }

    if (env.STRATEGY_MAX_INSTANCES < 1 || env.STRATEGY_MAX_INSTANCES > 1000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRATEGY_MAX_INSTANCES'],
        message: 'STRATEGY_MAX_INSTANCES must be between 1 and 1000.',
      });
    }

    if (Number.parseFloat(env.BACKTEST_DEFAULT_INITIAL_CAPITAL) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BACKTEST_DEFAULT_INITIAL_CAPITAL'],
        message: 'BACKTEST_DEFAULT_INITIAL_CAPITAL must be greater than zero.',
      });
    }

    // Zero fees and zero slippage are permitted, because an operator may want
    // to isolate the effect of costs. They are also the single most flattering
    // pair of assumptions available, so the combination is called out.
    if (
      env.BACKTEST_ENABLED &&
      Number.parseFloat(env.BACKTEST_DEFAULT_TAKER_FEE) === 0 &&
      Number.parseFloat(env.BACKTEST_DEFAULT_SLIPPAGE_BPS) === 0 &&
      env.NODE_ENV === 'production'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BACKTEST_DEFAULT_TAKER_FEE'],
        message:
          'Refusing zero taker fee together with zero slippage in production. ' +
          'That combination produces backtest results no real account could ' +
          'achieve. Set realistic venue costs, or run this configuration ' +
          'outside production.',
      });
    }

    // --- Part 7 -------------------------------------------------------

    if (env.DATASET_MAX_PARTITION_BYTES < 1048576 || env.DATASET_MAX_PARTITION_BYTES > 4294967296) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATASET_MAX_PARTITION_BYTES'],
        message:
          'DATASET_MAX_PARTITION_BYTES must be between 1 MiB and 4 GiB. Smaller ' +
          'creates millions of files; larger defeats the bounded re-reads the ' +
          'storage layer promises.',
      });
    }

    if (env.DATASET_READER_BUFFER_SIZE < 4096 || env.DATASET_READER_BUFFER_SIZE > 67108864) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATASET_READER_BUFFER_SIZE'],
        message: 'DATASET_READER_BUFFER_SIZE must be between 4 KiB and 64 MiB.',
      });
    }

    if (env.DATASET_MAX_EVENTS_PER_PARTITION < 1000 || env.DATASET_MAX_EVENTS_PER_PARTITION > 50000000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATASET_MAX_EVENTS_PER_PARTITION'],
        message: 'DATASET_MAX_EVENTS_PER_PARTITION must be between 1,000 and 50,000,000.',
      });
    }

    if (env.DATASET_MAX_GAP_WARNINGS < 0 || env.DATASET_MAX_GAP_WARNINGS > 10000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATASET_MAX_GAP_WARNINGS'],
        message: 'DATASET_MAX_GAP_WARNINGS must be between 0 and 10,000.',
      });
    }

    // A relative dataset root in production is a dataset tree under wherever
    // the process happened to start, and it moves with the next deployment
    // layout change. Loud refusal beats a disappearing registry.
    const absolute = (value: string): boolean => value.startsWith('/');
    if (env.NODE_ENV === 'production') {
      for (const [path, value] of [
        ['DATASET_LOCAL_ROOT', env.DATASET_LOCAL_ROOT],
        ['DATASET_TEMP_ROOT', env.DATASET_TEMP_ROOT],
      ] as const) {
        if (!absolute(value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [path],
            message: `${path} must be an absolute path in production.`,
          });
        }
      }
    }

    // Staging inside the dataset root would make the finalisation rename a
    // move-within-tree; the local storage refuses equal roots, and this
    // refuses staging nested under it, for the same reason.
    if (
      env.DATASET_TEMP_ROOT === env.DATASET_LOCAL_ROOT ||
      env.DATASET_TEMP_ROOT.startsWith(env.DATASET_LOCAL_ROOT + '/') ||
      env.DATASET_LOCAL_ROOT.startsWith(env.DATASET_TEMP_ROOT + '/')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATASET_TEMP_ROOT'],
        message:
          'DATASET_TEMP_ROOT and DATASET_LOCAL_ROOT must be disjoint paths: ' +
          'atomic finalisation depends on staging being invisible until the ' +
          'rename, which it is not when it lives inside the visible tree.',
      });
    }

    if (env.ORDER_UNKNOWN_RECONCILIATION_DELAY_MS >= env.ORDER_RECONCILIATION_INTERVAL_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ORDER_UNKNOWN_RECONCILIATION_DELAY_MS'],
        message:
          'ORDER_UNKNOWN_RECONCILIATION_DELAY_MS must be shorter than ' +
          'ORDER_RECONCILIATION_INTERVAL_MS, otherwise an unknown order waits a ' +
          'full extra sweep before anyone asks the venue about it.',
      });
    }

    // --- Part 8 -------------------------------------------------------
    // Risk control-plane coherence. These checks refuse deployments where
    // the safety timing contradicts itself; none of them can loosen a limit.

    if (env.RISK_FAIL_CLOSED !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RISK_FAIL_CLOSED'],
        message:
          'RISK_FAIL_CLOSED has exactly one legal value: true. The engine ' +
          'refusing an order it cannot prove safe is the whole design; a ' +
          'toggle to disable it would be the bypass the risk layer exists to ' +
          'make impossible. Remove the variable or set it to true.',
      });
    }

    if (env.MAX_RISK_STATE_AGE_MS < 100 || env.MAX_RISK_STATE_AGE_MS > 60_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MAX_RISK_STATE_AGE_MS'],
        message: 'MAX_RISK_STATE_AGE_MS must be between 100 and 60000.',
      });
    }

    // The refresh cadence and the staleness budget must be consistent or the
    // deployment is GUARANTEED stale: a snapshot older than the budget on
    // every evaluation denies every risk-increasing order forever. A one-shot
    // startup refusal beats that silent outage.
    if (env.RISK_SNAPSHOT_REFRESH_MS >= env.MAX_RISK_STATE_AGE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RISK_SNAPSHOT_REFRESH_MS'],
        message:
          'RISK_SNAPSHOT_REFRESH_MS must be shorter than MAX_RISK_STATE_AGE_MS, ' +
          'otherwise every snapshot is older than the budget when it is read ' +
          'and the gate - correctly - denies everything.',
      });
    }

    if (env.MAX_ORDERS_PER_MINUTE < env.MAX_ORDERS_PER_SECOND) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MAX_ORDERS_PER_MINUTE'],
        message:
          'MAX_ORDERS_PER_MINUTE must be at least MAX_ORDERS_PER_SECOND: a ' +
          'per-minute budget smaller than the per-second budget makes the ' +
          'second ceiling unreachable and invites an operator to "fix" the ' +
          'wrong one of the two.',
      });
    }
    if (env.MAX_CANCELS_PER_MINUTE < env.MAX_CANCELS_PER_SECOND) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MAX_CANCELS_PER_MINUTE'],
        message:
          'MAX_CANCELS_PER_MINUTE must be at least MAX_CANCELS_PER_SECOND, for ' +
          'the same reason as the order windows.',
      });
    }

    if (
      env.NODE_ENV === 'production' &&
      env.RISK_ENGINE_ENABLED !== true
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RISK_ENGINE_ENABLED'],
        message:
          'RISK_ENGINE_ENABLED=false in production: the extended risk gate is ' +
          'optional for local tooling and mandatory for real money. A ' +
          'production deployment must boot the full rule catalog or not boot.',
      });
    }
  })
  // Part 9: chained onto the SAME schema rather than a standalone statement -
  // zod's .superRefine returns a wrapper instead of mutating in place, so a
  // discarded expression would silently never run inside envSchema.safeParse.
  .superRefine((env, ctx) => {
    // Part 9: mandatory-in-production flags. The message tells the operator
    // WHICH flag and WHY, in the order they will hit them during a 3am.
    const mandatory = [
      ['OBSERVABILITY_ENABLED', 'the operations panel, health mirror and alert stream'],
      ['METRICS_ENABLED', 'the Prometheus exposition every dashboard and alert rule derives from'],
      ['HEALTH_ENABLED', 'the liveness/readiness probes the orchestrator and the API itself consume'],
      ['PROMETHEUS_ENABLED', 'the metrics endpoint (disabling it while METRICS_ENABLED is a config mistake)'],
      ['ALERTING_ENABLED', 'the alert fold that turns engine conditions into durable, deduped history'],
    ] as const;
    for (const [key, why] of mandatory) {
      if (env.NODE_ENV === 'production' && env[key] !== true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key}=false in production: a production deployment of a real-money platform ships with ${why}. Boot with them on, or run local tooling.`,
        });
      }
    }
    if (env.NODE_ENV === 'production' && !env.METRICS_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['METRICS_TOKEN'],
        message:
          'METRICS_TOKEN is required in production so the metrics exposition is ' +
          'never reachable unauthenticated on a shared listener. Provide one via ' +
          'the secret store; do not commit it.',
      });
    }
    if (env.ALERT_RETENTION_DAYS < 7) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ALERT_RETENTION_DAYS'],
        message: 'ALERT_RETENTION_DAYS cannot go below 7: a week is the floor for post-incident review.',
      });
    }
    if (env.INCIDENT_RETENTION_DAYS < 30) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['INCIDENT_RETENTION_DAYS'],
        message: 'INCIDENT_RETENTION_DAYS cannot go below 30: incidents are reviewed after the month they happened in.',
      });
    }
    if (env.ALERT_DEDUP_WINDOW_MS < env.HEALTH_REFRESH_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ALERT_DEDUP_WINDOW_MS'],
        message: 'ALERT_DEDUP_WINDOW_MS must be >= HEALTH_REFRESH_MS: a flag younger than the publish cadence is noise, not signal.',
      });
    }
  })
  // Part 10: chained onto the SAME schema (same discipline as the Part 9
  // block above - a discarded .superRefine expression never runs).
  .superRefine((env, ctx) => {
    // Production keeps its eyes open: with the Part 9 flags mandatory, a
    // tracing-enabled production process with nowhere to send spans is the
    // one combination that reads as 'on' and means 'off'.
    if (env.NODE_ENV === 'production' && env.OTEL_ENABLED === true && env.OTEL_ENDPOINT === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OTEL_ENDPOINT'],
        message:
          'OTEL_ENDPOINT is mandatory in production when OTEL_ENABLED=true: ' +
          'telemetry with nowhere to go is silent telemetry, and ' +
          'silent telemetry is what this whole part exists to forbid.',
      });
    }

    // Fault injection: never in production, and never unguarded. Setting
    // the non-production-only guard to false does NOT unlock production -
    // it disables the feature outright (fail closed in both directions).
    if (env.FAILURE_INJECTION_ENABLED === true) {
      if (env.FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY !== true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY'],
          message:
            'FAILURE_INJECTION_ENABLED=true requires the ' +
            'FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY guard to be true; ' +
            'disabling the guard disables the feature, it does not unlock more.',
        });
      }
      if (env.NODE_ENV === 'production') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['FAILURE_INJECTION_ENABLED'],
          message:
            'FAILURE_INJECTION_ENABLED=true is a test-harness switch; ' +
            'production refuses to boot with it armed.',
        });
      }
    }

    // SLO coherence: the retention floor must outlive the longest window the
    // evaluator reads; the cadence must not exceed the configured default
    // window; the paging multipliers must be finite decimals with slow <=
    // fast (the engine refuses the inverse construction; startup must not
    // discover at 3am what boot could have refused).
    if (env.SLO_RETENTION_DAYS < 7) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SLO_RETENTION_DAYS'],
        message:
          'SLO_RETENTION_DAYS cannot go below 7: burn windows read back a ' +
          'week, and rows they read must still exist.',
      });
    }
    if (
      env.SLO_DEFAULT_WINDOW_MINUTES < 5 ||
      env.SLO_DEFAULT_WINDOW_MINUTES > 10_080
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SLO_DEFAULT_WINDOW_MINUTES'],
        message: 'SLO_DEFAULT_WINDOW_MINUTES must be between 5 and 10080.',
      });
    }
    if (env.SLO_EVALUATION_INTERVAL_MINUTES > env.SLO_DEFAULT_WINDOW_MINUTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SLO_EVALUATION_INTERVAL_MINUTES'],
        message:
          'SLO_EVALUATION_INTERVAL_MINUTES must not exceed ' +
          'SLO_DEFAULT_WINDOW_MINUTES: a cadence slower than the window it ' +
          'judges evaluates every window at most once and calls the rest ' +
          'of the gap coverage.',
      });
    }
    const multipliers: Array<[string, string]> = [
      ['SLO_FAST_BURN_MULTIPLIER', env.SLO_FAST_BURN_MULTIPLIER],
      ['SLO_SLOW_BURN_MULTIPLIER', env.SLO_SLOW_BURN_MULTIPLIER],
    ];
    const parsed = new Map<string, number>();
    for (const [key, raw] of multipliers) {
      if (!/^\d+(?:\.\d{1,4})?$/.test(raw)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} must be a plain decimal multiplier string (at most 4 decimal places).`,
        });
        continue;
      }
      parsed.set(key, Number(raw));
    }
    if (
      parsed.has('SLO_FAST_BURN_MULTIPLIER') &&
      parsed.has('SLO_SLOW_BURN_MULTIPLIER') &&
      (parsed.get('SLO_SLOW_BURN_MULTIPLIER') as number) >
        (parsed.get('SLO_FAST_BURN_MULTIPLIER') as number)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SLO_SLOW_BURN_MULTIPLIER'],
        message:
          'SLO_SLOW_BURN_MULTIPLIER must not exceed SLO_FAST_BURN_MULTIPLIER ' +
          '(the engine refuses the inverse construction for the same reason).',
      });
    }
  })
  // Part 11: worker-plane and replica coherence, chained onto the same
  // schema like every part before it.
  .superRefine((env, ctx) => {
    if (env.WORKER_PARTITION_COUNT < 1 || env.WORKER_PARTITION_COUNT > 4096) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WORKER_PARTITION_COUNT'],
        message:
          'WORKER_PARTITION_COUNT must be within 1..4096 (the coordination ' +
          'assignment ceiling both languages share; docs/fixtures/' +
          'coordination_fixtures.json pins it).',
      });
    }
    if (env.WORKER_PARTITION_LEASE_TTL_MS < 1000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WORKER_PARTITION_LEASE_TTL_MS'],
        message: 'WORKER_PARTITION_LEASE_TTL_MS below 1000 flaps on network jitter.',
      });
    }
    if (env.WORKER_PARTITION_RETRY_MS < 250) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WORKER_PARTITION_RETRY_MS'],
        message:
          'WORKER_PARTITION_RETRY_MS below 250 is a busy loop, not a cadence.',
      });
    }
    if (env.WORKER_DEFER_DELAY_MS < 250) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WORKER_DEFER_DELAY_MS'],
        message: 'WORKER_DEFER_DELAY_MS below 250 turns deferral into spinning.',
      });
    }
    if (env.WORKER_MAX_DEFERS < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WORKER_MAX_DEFERS'],
        message: 'WORKER_MAX_DEFERS must be >= 1 (0 would fail every job unclaimed).',
      });
    }
    if (env.WORKER_SHUTDOWN_TIMEOUT_MS < 1000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WORKER_SHUTDOWN_TIMEOUT_MS'],
        message:
          'WORKER_SHUTDOWN_TIMEOUT_MS below 1000 cannot drain even one slow ' +
          'venue round-trip; shutdown would ALWAYS take the TTL-expiry path.',
      });
    }
    // The deferral cadence and the claim renewal cadence must not fight: a
    // job re-delivered faster than claims renew would ping-pong while a
    // partition is moving, which is the one shape of churn that reads as a
    // bug in the partitioner rather than in the clock.
    if (env.WORKER_DEFER_DELAY_MS < env.WORKER_PARTITION_RETRY_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WORKER_DEFER_DELAY_MS'],
        message:
          'WORKER_DEFER_DELAY_MS must be >= WORKER_PARTITION_RETRY_MS: ' +
          'deferred jobs must not outpace claim renewal.',
      });
    }
    if (env.WORKER_MEMBERSHIP_TTL_MS < 1_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WORKER_MEMBERSHIP_TTL_MS'],
        message:
          'WORKER_MEMBERSHIP_TTL_MS below 1000 flaps on network jitter; ' +
          'the expiry law needs a human-scale window to be a safety net.',
      });
    }
    if (
      env.WORKER_MEMBERSHIP_MODE === 'registry' &&
      env.WORKER_MEMBERSHIP_TTL_MS < 2 * env.WORKER_PARTITION_RETRY_MS
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WORKER_MEMBERSHIP_TTL_MS'],
        message:
          'WORKER_MEMBERSHIP_MODE=registry requires WORKER_MEMBERSHIP_TTL_MS ' +
          '>= 2 * WORKER_PARTITION_RETRY_MS: the membership heartbeat reuses ' +
          'the coordination tick, and a TTL shorter than two ticks lets one ' +
          'lost ping age a live worker out of the fleet while it still holds ' +
          'fresh claims - pure churn, zero safety.',
      });
    }
    if (env.DATABASE_READ_ENABLED && !(env.DATABASE_READ_URL && env.DATABASE_READ_URL.length > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_READ_URL'],
        message:
          'DATABASE_READ_ENABLED=true requires DATABASE_READ_URL; a replica ' +
          'flag without a replica connection is configuration wishful thinking.',
      });
    }
    if (env.DATABASE_READ_URL && !env.DATABASE_READ_ENABLED) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_READ_ENABLED'],
        message:
          'DATABASE_READ_URL is set but DATABASE_READ_ENABLED=false: refusing ' +
          'to start rather than run a deployment half-replica-configured. ' +
          'Set the flag to enable, or remove the URL.',
      });
    }
    if (env.DATABASE_READ_MAX_LAG_MS < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_READ_MAX_LAG_MS'],
        message: 'DATABASE_READ_MAX_LAG_MS cannot be negative (0 means primary-only).',
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export interface EnvValidationFailure {
  path: string;
  message: string;
}

export class EnvValidationError extends Error {
  public readonly failures: EnvValidationFailure[];

  constructor(failures: EnvValidationFailure[]) {
    super(
      `Invalid environment configuration:\n${failures
        .map((failure) => `  - ${failure.path}: ${failure.message}`)
        .join('\n')}`,
    );
    this.name = 'EnvValidationError';
    this.failures = failures;
  }
}

/**
 * Parses and validates `process.env`. Throws {@link EnvValidationError} listing
 * every problem at once so operators can fix configuration in a single pass.
 */
export function validateEnv(source: Record<string, unknown> = process.env): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const failures = result.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    }));
    throw new EnvValidationError(failures);
  }
  return result.data;
}
```

FILE: packages/config/src/index.ts

```typescript
export * from './env.schema';
export * from './constants';
```

FILE: packages/config/tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

FILE: packages/shared-types/package.json

```json
{
  "name": "@wlct/shared-types",
  "version": "1.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "rimraf dist && tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "rimraf": "^5.0.7",
    "typescript": "^5.5.4"
  }
}
```

FILE: packages/shared-types/src/audit.ts

```typescript
import type { ISODateString, UUID } from './common';

export enum AuditAction {
  // Auth
  USER_REGISTERED = 'USER_REGISTERED',
  USER_LOGIN_SUCCEEDED = 'USER_LOGIN_SUCCEEDED',
  USER_LOGIN_FAILED = 'USER_LOGIN_FAILED',
  USER_LOGGED_OUT = 'USER_LOGGED_OUT',
  TOKEN_REFRESHED = 'TOKEN_REFRESHED',
  TOKEN_REUSE_DETECTED = 'TOKEN_REUSE_DETECTED',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  PASSWORD_RESET_REQUESTED = 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED = 'PASSWORD_RESET_COMPLETED',
  TWO_FACTOR_ENABLED = 'TWO_FACTOR_ENABLED',
  TWO_FACTOR_DISABLED = 'TWO_FACTOR_DISABLED',
  TWO_FACTOR_VERIFIED = 'TWO_FACTOR_VERIFIED',
  TWO_FACTOR_FAILED = 'TWO_FACTOR_FAILED',
  SESSION_REVOKED = 'SESSION_REVOKED',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED = 'ACCOUNT_UNLOCKED',

  // Administration
  TENANT_CREATED = 'TENANT_CREATED',
  TENANT_UPDATED = 'TENANT_UPDATED',
  TENANT_SUSPENDED = 'TENANT_SUSPENDED',
  TENANT_DELETED = 'TENANT_DELETED',
  TENANT_BRANDING_UPDATED = 'TENANT_BRANDING_UPDATED',
  TENANT_SETTING_UPDATED = 'TENANT_SETTING_UPDATED',
  TENANT_DOMAIN_ADDED = 'TENANT_DOMAIN_ADDED',
  TENANT_DOMAIN_REMOVED = 'TENANT_DOMAIN_REMOVED',
  USER_CREATED = 'USER_CREATED',
  USER_UPDATED = 'USER_UPDATED',
  USER_DELETED = 'USER_DELETED',
  USER_SUSPENDED = 'USER_SUSPENDED',
  USER_REINSTATED = 'USER_REINSTATED',
  ROLE_CREATED = 'ROLE_CREATED',
  ROLE_UPDATED = 'ROLE_UPDATED',
  ROLE_DELETED = 'ROLE_DELETED',
  ROLE_ASSIGNED = 'ROLE_ASSIGNED',
  ROLE_REVOKED = 'ROLE_REVOKED',
  FEATURE_FLAG_UPDATED = 'FEATURE_FLAG_UPDATED',
  SUBSCRIPTION_CREATED = 'SUBSCRIPTION_CREATED',
  SUBSCRIPTION_UPDATED = 'SUBSCRIPTION_UPDATED',
  SUBSCRIPTION_CANCELED = 'SUBSCRIPTION_CANCELED',
  PLAN_CREATED = 'PLAN_CREATED',
  PLAN_UPDATED = 'PLAN_UPDATED',

  // Trading domain (emitted from Part 2 onwards)
  EXCHANGE_ACCOUNT_LINKED = 'EXCHANGE_ACCOUNT_LINKED',
  EXCHANGE_ACCOUNT_UNLINKED = 'EXCHANGE_ACCOUNT_UNLINKED',
  EXCHANGE_CREDENTIAL_ROTATED = 'EXCHANGE_CREDENTIAL_ROTATED',
  COPY_SUBSCRIPTION_STARTED = 'COPY_SUBSCRIPTION_STARTED',
  COPY_SUBSCRIPTION_STOPPED = 'COPY_SUBSCRIPTION_STOPPED',
  ORDER_SUBMITTED = 'ORDER_SUBMITTED',
  RISK_LIMIT_BREACHED = 'RISK_LIMIT_BREACHED',

  // Authenticated execution (Part 5).
  //
  // Every action here changes what the platform is permitted to do with real
  // money, or closes a question about what already happened to it. They are
  // written with `recordImmediate` rather than buffered: an audit record that
  // is still in a process buffer when the process dies is not an audit record.
  ORDER_CANCEL_REQUESTED = 'ORDER_CANCEL_REQUESTED',
  ORDER_STATE_TRANSITION_REJECTED = 'ORDER_STATE_TRANSITION_REJECTED',
  EXCHANGE_ACCOUNT_ENABLED = 'EXCHANGE_ACCOUNT_ENABLED',
  EXCHANGE_ACCOUNT_DISABLED = 'EXCHANGE_ACCOUNT_DISABLED',
  EXCHANGE_ACCOUNT_VERIFIED = 'EXCHANGE_ACCOUNT_VERIFIED',
  EXCHANGE_ACCOUNT_VERIFICATION_FAILED = 'EXCHANGE_ACCOUNT_VERIFICATION_FAILED',
  LIVE_TRADING_ENABLED = 'LIVE_TRADING_ENABLED',
  LIVE_TRADING_DISABLED = 'LIVE_TRADING_DISABLED',
  PRIVATE_STREAM_ENABLED = 'PRIVATE_STREAM_ENABLED',
  PRIVATE_STREAM_DISABLED = 'PRIVATE_STREAM_DISABLED',
  KILL_SWITCH_ENGAGED = 'KILL_SWITCH_ENGAGED',
  KILL_SWITCH_RELEASED = 'KILL_SWITCH_RELEASED',
  RECONCILIATION_TRIGGERED = 'RECONCILIATION_TRIGGERED',
  RECONCILIATION_DISCREPANCY_RESOLVED = 'RECONCILIATION_DISCREPANCY_RESOLVED',
  EXECUTION_INCIDENT_RAISED = 'EXECUTION_INCIDENT_RAISED',
  EXECUTION_INCIDENT_RESOLVED = 'EXECUTION_INCIDENT_RESOLVED',
  BALANCE_REFRESH_REQUESTED = 'BALANCE_REFRESH_REQUESTED',

  // Strategy layer (Part 6).
  //
  // None of these move money. They are recorded anyway, because "who started
  // this strategy, with what parameters, and when" is the first question asked
  // after a strategy does something surprising, and reconstructing it from
  // application logs afterwards is not an answer.
  STRATEGY_INSTANCE_CREATED = 'STRATEGY_INSTANCE_CREATED',
  STRATEGY_INSTANCE_UPDATED = 'STRATEGY_INSTANCE_UPDATED',
  STRATEGY_INSTANCE_ENABLED = 'STRATEGY_INSTANCE_ENABLED',
  STRATEGY_INSTANCE_DISABLED = 'STRATEGY_INSTANCE_DISABLED',
  STRATEGY_CONFIGURATION_ACTIVATED = 'STRATEGY_CONFIGURATION_ACTIVATED',
  STRATEGY_INSTANCE_QUARANTINED = 'STRATEGY_INSTANCE_QUARANTINED',
  STRATEGY_INCIDENT_RAISED = 'STRATEGY_INCIDENT_RAISED',
  STRATEGY_INCIDENT_RESOLVED = 'STRATEGY_INCIDENT_RESOLVED',
  BACKTEST_SUBMITTED = 'BACKTEST_SUBMITTED',
  BACKTEST_CANCELLED = 'BACKTEST_CANCELLED',
  PAPER_SESSION_STARTED = 'PAPER_SESSION_STARTED',
  PAPER_SESSION_STOPPED = 'PAPER_SESSION_STOPPED',

  // Dataset layer (Part 7).
  //
  // Datasets are public market data, so none of these move money either -
  // what they protect is REPRODUCIBILITY: "who ingested this version, who
  // withdrew it, who was told it was corrupt" is the chain a disputed
  // backtest result is settled with.
  DATASET_INGESTION_REQUESTED = 'DATASET_INGESTION_REQUESTED',
  DATASET_VERSION_REGISTERED = 'DATASET_VERSION_REGISTERED',
  DATASET_VALIDATION_REQUESTED = 'DATASET_VALIDATION_REQUESTED',
  DATASET_VERSION_QUARANTINED = 'DATASET_VERSION_QUARANTINED',
  DATASET_VERSION_ARCHIVED = 'DATASET_VERSION_ARCHIVED',

  // Part 8: the risk control plane. Configuration mutations, switch
  // lifecycle transitions that operators (not the engine) performed, and
  // snapshot invalidation - the audit answer to "who changed the limits".
  // Engine-emitted breaches live in the risk_events table; an audit row
  // exists for HUMAN acts, which is why there is no RISK_LIMIT_BREACHED
  // action here and there is a RISK_KILL_SWITCH_CLEARED one.
  RISK_CONFIG_UPDATED = 'RISK_CONFIG_UPDATED',
  RISK_CONFIG_ROLLED_BACK = 'RISK_CONFIG_ROLLED_BACK',
  RISK_SNAPSHOT_INVALIDATED = 'RISK_SNAPSHOT_INVALIDATED',
  RISK_KILL_SWITCH_ACKNOWLEDGED = 'RISK_KILL_SWITCH_ACKNOWLEDGED',
  RISK_KILL_SWITCH_CLEARED = 'RISK_KILL_SWITCH_CLEARED',
  RISK_PROTECTION_CLEARED = 'RISK_PROTECTION_CLEARED',

  // Part 9 (operations). Acknowledging an alert says "a human has this";
  // force-resolving it without an observed recovery says "and we are
  // dismissing it anyway" - which is exactly why it needs its own action,
  // a typed phrase and a long reason.
  OPS_ALERT_ACKNOWLEDGED = 'OPS_ALERT_ACKNOWLEDGED',
  OPS_ALERT_FORCE_RESOLVED = 'OPS_ALERT_FORCE_RESOLVED',
  OPS_INCIDENT_STATUS_CHANGED = 'OPS_INCIDENT_STATUS_CHANGED',

  // Part 10 (reliability). Writing an SLO definition changes what future
  // evidence MEANS (which burn rate pages, which window is judged), so it is
  // audited like the human-side risk actions: typed action, versioned
  // payload, no silent in-place edit. A manual evaluation tick is also
  // audited: the console asked the platform to measure itself now, and the
  // log says so even when the verdict is HEALTHY.
  SLO_CONFIG_UPDATED = 'SLO_CONFIG_UPDATED',
  SLO_EVALUATE_REQUESTED = 'SLO_EVALUATE_REQUESTED',
}

export enum AuditActorType {
  USER = 'USER',
  SYSTEM = 'SYSTEM',
  SERVICE = 'SERVICE',
  API_KEY = 'API_KEY',
}

export enum AuditOutcome {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
  DENIED = 'DENIED',
}

export interface AuditLogDto {
  id: UUID;
  tenantId: UUID | null;
  actorType: AuditActorType;
  actorId: UUID | null;
  actorEmail: string | null;
  action: AuditAction | string;
  outcome: AuditOutcome;
  resourceType: string | null;
  resourceId: string | null;
  description: string | null;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  metadata: Record<string, unknown> | null;
  ipHash: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: ISODateString;
}

export enum SecurityEventType {
  SUSPICIOUS_LOGIN = 'SUSPICIOUS_LOGIN',
  NEW_DEVICE_LOGIN = 'NEW_DEVICE_LOGIN',
  IMPOSSIBLE_TRAVEL = 'IMPOSSIBLE_TRAVEL',
  BRUTE_FORCE_SUSPECTED = 'BRUTE_FORCE_SUSPECTED',
  CREDENTIAL_STUFFING_SUSPECTED = 'CREDENTIAL_STUFFING_SUSPECTED',
  TOKEN_REUSE = 'TOKEN_REUSE',
  RATE_LIMIT_ABUSE = 'RATE_LIMIT_ABUSE',
  PERMISSION_ESCALATION_ATTEMPT = 'PERMISSION_ESCALATION_ATTEMPT',
  TENANT_ISOLATION_VIOLATION = 'TENANT_ISOLATION_VIOLATION',
  ENCRYPTION_FAILURE = 'ENCRYPTION_FAILURE',
}

export enum SecuritySeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export interface SecurityEventDto {
  id: UUID;
  tenantId: UUID | null;
  userId: UUID | null;
  type: SecurityEventType;
  severity: SecuritySeverity;
  description: string;
  metadata: Record<string, unknown> | null;
  ipHash: string | null;
  resolved: boolean;
  resolvedAt: ISODateString | null;
  createdAt: ISODateString;
}
```

FILE: packages/shared-types/src/auth.ts

```typescript
import type { ISODateString, SupportedLocale, UUID } from './common';
import type { UserDto } from './user';

export interface LoginInput {
  email: string;
  password: string;
  deviceId: string;
  deviceName?: string;
  platform?: string;
  appVersion?: string;
  rememberDevice?: boolean;
}

export interface RegisterInput {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  locale?: SupportedLocale;
  referralCode?: string;
  acceptedTerms: boolean;
  deviceId: string;
  deviceName?: string;
  platform?: string;
}

export interface TokenPairDto {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface AuthenticatedSessionDto {
  tokens: TokenPairDto;
  user: UserDto;
  sessionId: UUID;
}

/** Returned when the password step succeeds but 2FA is still outstanding. */
export interface TwoFactorChallengeDto {
  twoFactorRequired: true;
  challengeToken: string;
  expiresIn: number;
  methods: TwoFactorMethod[];
}

export type LoginResultDto = AuthenticatedSessionDto | TwoFactorChallengeDto;

export function isTwoFactorChallenge(result: LoginResultDto): result is TwoFactorChallengeDto {
  return (result as TwoFactorChallengeDto).twoFactorRequired === true;
}

export enum TwoFactorMethod {
  TOTP = 'TOTP',
  RECOVERY_CODE = 'RECOVERY_CODE',
  EMAIL = 'EMAIL',
  SMS = 'SMS',
}

export interface TwoFactorSetupDto {
  method: TwoFactorMethod;
  secretIssuedAt: ISODateString;
  otpauthUrl: string;
  qrCodeDataUrl: string;
  recoveryCodes: string[];
}

export interface RefreshTokenInput {
  refreshToken: string;
  deviceId: string;
}

/** Decoded access-token payload. Never contains PII beyond the subject id. */
export interface JwtAccessPayload {
  sub: UUID;
  sid: UUID;
  tid: UUID;
  typ: 'access';
  roles: string[];
  perms: string[];
  plat: boolean;
  /**
   * The user's `sessionVersion` at the moment the token was minted.
   *
   * Bumped by the server on password change and on "sign out of all devices".
   * The auth strategy compares this claim with the stored counter on every
   * request, so those actions invalidate live access tokens immediately instead
   * of waiting for them to expire. An integer comparison is used rather than a
   * timestamp comparison because `iat` only has one-second resolution, which
   * makes any time-based check ambiguous for tokens issued in the same second
   * as the change.
   */
  sv: number;
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface JwtRefreshPayload {
  sub: UUID;
  sid: UUID;
  tid: UUID;
  typ: 'refresh';
  fam: string;
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface JwtTwoFactorPayload {
  sub: UUID;
  tid: UUID;
  typ: '2fa_challenge';
  did: string;
  jti: string;
  iat: number;
  exp: number;
}

/** Request-scoped identity assembled by the authentication guard. */
export interface AuthenticatedActor {
  userId: UUID;
  tenantId: UUID;
  sessionId: UUID;
  roles: string[];
  permissions: string[];
  isPlatformUser: boolean;
  tokenId: string;
}
```

FILE: packages/shared-types/src/billing.ts

```typescript
import type { DecimalString, ISODateString, SupportedCurrency, UUID } from './common';

export enum BillingInterval {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY',
  LIFETIME = 'LIFETIME',
}

export enum SubscriptionStatus {
  TRIALING = 'TRIALING',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELED = 'CANCELED',
  EXPIRED = 'EXPIRED',
  PAUSED = 'PAUSED',
}

export enum PlanAudience {
  TENANT = 'TENANT',
  END_USER = 'END_USER',
}

export interface PlanLimits {
  maxUsers: number | null;
  maxTraders: number | null;
  maxFollowersPerTrader: number | null;
  maxExchangeAccountsPerUser: number | null;
  maxCopySubscriptionsPerFollower: number | null;
  maxApiRequestsPerMinute: number | null;
  websocketConnections: number | null;
  customDomain: boolean;
  whiteLabelMobileApp: boolean;
  prioritySupport: boolean;
}

export interface SubscriptionPlanDto {
  id: UUID;
  tenantId: UUID | null;
  code: string;
  name: string;
  description: string | null;
  audience: PlanAudience;
  price: DecimalString;
  currency: SupportedCurrency;
  interval: BillingInterval;
  trialDays: number;
  performanceFeeBps: number;
  platformFeeBps: number;
  limits: PlanLimits;
  features: string[];
  isActive: boolean;
  sortOrder: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface TenantSubscriptionDto {
  id: UUID;
  tenantId: UUID;
  planId: UUID;
  plan?: SubscriptionPlanDto;
  status: SubscriptionStatus;
  currentPeriodStart: ISODateString;
  currentPeriodEnd: ISODateString;
  trialEndsAt: ISODateString | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: ISODateString | null;
  externalCustomerId: string | null;
  externalSubscriptionId: string | null;
  seatsPurchased: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
```

FILE: packages/shared-types/src/common.ts

```typescript
/**
 * Primitive and envelope contracts shared by every application in the monorepo.
 * The API, the Next.js admin and (through code generation) the Flutter client
 * all derive their response handling from these shapes.
 */

/** RFC 4122 UUID v4 string. */
export type UUID = string;

/** ISO-8601 timestamp string, always serialised in UTC. */
export type ISODateString = string;

/** Decimal values crossing the wire are strings to avoid float precision loss. */
export type DecimalString = string;

export type Nullable<T> = T | null;

export interface RequestContextMeta {
  requestId: string;
  timestamp: ISODateString;
  version: string;
}

/** Successful envelope returned by every REST endpoint. */
export interface ApiSuccessResponse<TData> {
  success: true;
  data: TData;
  meta: RequestContextMeta;
}

/** Failure envelope returned by the global exception filter. */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    statusCode: number;
    details?: ValidationErrorDetail[];
  };
  meta: RequestContextMeta;
}

export type ApiResponse<TData> = ApiSuccessResponse<TData> | ApiErrorResponse;

export interface ValidationErrorDetail {
  field: string;
  constraint: string;
  message: string;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: SortOrder;
  search?: string;
}

export type SortOrder = 'asc' | 'desc';

export interface PaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedResult<TItem> {
  items: TItem[];
  pagination: PaginationMeta;
}

export interface HealthIndicatorResult {
  status: 'up' | 'down';
  message?: string;
  responseTimeMs?: number;
}

export interface HealthCheckResponse {
  status: 'ok' | 'error' | 'shutting_down';
  uptimeSeconds: number;
  version: string;
  environment: string;
  checks: Record<string, HealthIndicatorResult>;
}

export type SupportedLocale = 'en' | 'es' | 'ar' | 'bn' | 'tr';

export type SupportedCurrency = 'USD' | 'EUR' | 'GBP' | 'AED' | 'BDT' | 'TRY';

export interface MoneyAmount {
  amount: DecimalString;
  currency: SupportedCurrency;
}
```

FILE: packages/shared-types/src/errors.ts

```typescript
/**
 * Canonical machine-readable error codes. Clients switch on these values, never
 * on human readable messages (which are localised and may change).
 */
export enum ErrorCode {
  // Generic
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  NOT_FOUND = 'NOT_FOUND',
  BAD_REQUEST = 'BAD_REQUEST',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  CONFLICT = 'CONFLICT',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE = 'UNSUPPORTED_MEDIA_TYPE',

  // Authentication
  UNAUTHORIZED = 'UNAUTHORIZED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  TOKEN_REVOKED = 'TOKEN_REVOKED',
  REFRESH_TOKEN_REUSE_DETECTED = 'REFRESH_TOKEN_REUSE_DETECTED',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  ACCOUNT_DISABLED = 'ACCOUNT_DISABLED',
  ACCOUNT_PENDING_VERIFICATION = 'ACCOUNT_PENDING_VERIFICATION',
  EMAIL_ALREADY_REGISTERED = 'EMAIL_ALREADY_REGISTERED',
  PASSWORD_POLICY_VIOLATION = 'PASSWORD_POLICY_VIOLATION',

  // Two factor
  TWO_FACTOR_REQUIRED = 'TWO_FACTOR_REQUIRED',
  TWO_FACTOR_INVALID = 'TWO_FACTOR_INVALID',
  TWO_FACTOR_ALREADY_ENABLED = 'TWO_FACTOR_ALREADY_ENABLED',
  TWO_FACTOR_NOT_ENABLED = 'TWO_FACTOR_NOT_ENABLED',

  // Authorization
  FORBIDDEN = 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  TENANT_MISMATCH = 'TENANT_MISMATCH',
  TENANT_NOT_FOUND = 'TENANT_NOT_FOUND',
  TENANT_SUSPENDED = 'TENANT_SUSPENDED',
  FEATURE_DISABLED = 'FEATURE_DISABLED',
  SUBSCRIPTION_REQUIRED = 'SUBSCRIPTION_REQUIRED',
  SUBSCRIPTION_LIMIT_REACHED = 'SUBSCRIPTION_LIMIT_REACHED',

  // Exchange / trading domain (used from Part 2 onwards)
  EXCHANGE_NOT_SUPPORTED = 'EXCHANGE_NOT_SUPPORTED',
  EXCHANGE_CREDENTIALS_INVALID = 'EXCHANGE_CREDENTIALS_INVALID',
  EXCHANGE_PERMISSION_DENIED = 'EXCHANGE_PERMISSION_DENIED',
  EXCHANGE_RATE_LIMITED = 'EXCHANGE_RATE_LIMITED',
  EXCHANGE_UNAVAILABLE = 'EXCHANGE_UNAVAILABLE',
  EXECUTION_DISABLED = 'EXECUTION_DISABLED',
  RISK_LIMIT_BREACHED = 'RISK_LIMIT_BREACHED',

  // Compliance
  KYC_REQUIRED = 'KYC_REQUIRED',
  KYC_PENDING = 'KYC_PENDING',
  KYC_REJECTED = 'KYC_REJECTED',
}

/** Default HTTP status mapping used by the API exception factory. */
export const ERROR_CODE_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = Object.freeze({
  [ErrorCode.INTERNAL_SERVER_ERROR]: 500,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.BAD_REQUEST]: 400,
  [ErrorCode.VALIDATION_ERROR]: 422,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 429,
  [ErrorCode.PAYLOAD_TOO_LARGE]: 413,
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]: 415,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.INVALID_CREDENTIALS]: 401,
  [ErrorCode.TOKEN_EXPIRED]: 401,
  [ErrorCode.TOKEN_INVALID]: 401,
  [ErrorCode.TOKEN_REVOKED]: 401,
  [ErrorCode.REFRESH_TOKEN_REUSE_DETECTED]: 401,
  [ErrorCode.ACCOUNT_LOCKED]: 423,
  [ErrorCode.ACCOUNT_DISABLED]: 403,
  [ErrorCode.ACCOUNT_PENDING_VERIFICATION]: 403,
  [ErrorCode.EMAIL_ALREADY_REGISTERED]: 409,
  [ErrorCode.PASSWORD_POLICY_VIOLATION]: 422,
  [ErrorCode.TWO_FACTOR_REQUIRED]: 401,
  [ErrorCode.TWO_FACTOR_INVALID]: 401,
  [ErrorCode.TWO_FACTOR_ALREADY_ENABLED]: 409,
  [ErrorCode.TWO_FACTOR_NOT_ENABLED]: 409,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.INSUFFICIENT_PERMISSIONS]: 403,
  [ErrorCode.TENANT_MISMATCH]: 403,
  [ErrorCode.TENANT_NOT_FOUND]: 404,
  [ErrorCode.TENANT_SUSPENDED]: 403,
  [ErrorCode.FEATURE_DISABLED]: 403,
  [ErrorCode.SUBSCRIPTION_REQUIRED]: 402,
  [ErrorCode.SUBSCRIPTION_LIMIT_REACHED]: 402,
  [ErrorCode.EXCHANGE_NOT_SUPPORTED]: 400,
  [ErrorCode.EXCHANGE_CREDENTIALS_INVALID]: 400,
  [ErrorCode.EXCHANGE_PERMISSION_DENIED]: 403,
  [ErrorCode.EXCHANGE_RATE_LIMITED]: 429,
  [ErrorCode.EXCHANGE_UNAVAILABLE]: 503,
  [ErrorCode.EXECUTION_DISABLED]: 503,
  [ErrorCode.RISK_LIMIT_BREACHED]: 422,
  [ErrorCode.KYC_REQUIRED]: 403,
  [ErrorCode.KYC_PENDING]: 403,
  [ErrorCode.KYC_REJECTED]: 403,
});
```

FILE: packages/shared-types/src/exchange.ts

```typescript
/**
 * Exchange integration contracts.
 *
 * The platform is strictly non-custodial: followers connect their own exchange
 * accounts using trade-enabled, withdrawal-disabled API keys. Secrets are
 * encrypted at rest with envelope encryption and are never returned by the API.
 */
export enum ExchangeId {
  BINANCE = 'binance',
  BYBIT = 'bybit',
  OKX = 'okx',
  KRAKEN = 'kraken',
}

export enum ExchangeMarketType {
  SPOT = 'SPOT',
  MARGIN = 'MARGIN',
  FUTURES_USDT = 'FUTURES_USDT',
  FUTURES_COIN = 'FUTURES_COIN',
}

export enum ExchangeCredentialStatus {
  PENDING_VALIDATION = 'PENDING_VALIDATION',
  ACTIVE = 'ACTIVE',
  INVALID = 'INVALID',
  REVOKED = 'REVOKED',
  PERMISSION_INSUFFICIENT = 'PERMISSION_INSUFFICIENT',
  WITHDRAWAL_ENABLED_REJECTED = 'WITHDRAWAL_ENABLED_REJECTED',
}

export interface ExchangeCapabilities {
  id: ExchangeId;
  displayName: string;
  marketTypes: ExchangeMarketType[];
  supportsUserDataStream: boolean;
  supportsWebhooks: boolean;
  requiresPassphrase: boolean;
  supportsSandbox: boolean;
  maxLeverage: number;
  weightLimitPerMinute: number;
}

export const EXCHANGE_CAPABILITIES: Readonly<Record<ExchangeId, ExchangeCapabilities>> =
  Object.freeze({
    [ExchangeId.BINANCE]: {
      id: ExchangeId.BINANCE,
      displayName: 'Binance',
      marketTypes: [
        ExchangeMarketType.SPOT,
        ExchangeMarketType.MARGIN,
        ExchangeMarketType.FUTURES_USDT,
        ExchangeMarketType.FUTURES_COIN,
      ],
      supportsUserDataStream: true,
      supportsWebhooks: false,
      requiresPassphrase: false,
      supportsSandbox: true,
      maxLeverage: 125,
      weightLimitPerMinute: 6000,
    },
    [ExchangeId.BYBIT]: {
      id: ExchangeId.BYBIT,
      displayName: 'Bybit',
      marketTypes: [
        ExchangeMarketType.SPOT,
        ExchangeMarketType.FUTURES_USDT,
        ExchangeMarketType.FUTURES_COIN,
      ],
      supportsUserDataStream: true,
      supportsWebhooks: false,
      requiresPassphrase: false,
      supportsSandbox: true,
      maxLeverage: 100,
      weightLimitPerMinute: 600,
    },
    [ExchangeId.OKX]: {
      id: ExchangeId.OKX,
      displayName: 'OKX',
      marketTypes: [
        ExchangeMarketType.SPOT,
        ExchangeMarketType.MARGIN,
        ExchangeMarketType.FUTURES_USDT,
      ],
      supportsUserDataStream: true,
      supportsWebhooks: false,
      requiresPassphrase: true,
      supportsSandbox: true,
      maxLeverage: 125,
      weightLimitPerMinute: 1200,
    },
    [ExchangeId.KRAKEN]: {
      id: ExchangeId.KRAKEN,
      displayName: 'Kraken',
      marketTypes: [ExchangeMarketType.SPOT, ExchangeMarketType.FUTURES_USDT],
      supportsUserDataStream: true,
      supportsWebhooks: false,
      requiresPassphrase: false,
      supportsSandbox: false,
      maxLeverage: 50,
      weightLimitPerMinute: 900,
    },
  });

/**
 * Safe projection of an exchange connection. Deliberately contains no secret
 * material: only a masked key fragment for user recognition.
 */
export interface ExchangeAccountPublicDto {
  id: string;
  tenantId: string;
  userId: string;
  exchange: ExchangeId;
  label: string;
  marketType: ExchangeMarketType;
  apiKeyMasked: string;
  status: ExchangeCredentialStatus;
  isSandbox: boolean;
  permissions: {
    canRead: boolean;
    canTrade: boolean;
    canWithdraw: boolean;
  };
  lastValidatedAt: string | null;
  createdAt: string;
}
```

FILE: packages/shared-types/src/index.ts

```typescript
export * from './common';
export * from './auth';
export * from './rbac';
export * from './tenant';
export * from './user';
export * from './billing';
export * from './audit';
export * from './realtime';
export * from './notification';
export * from './exchange';
export * from './trading';
export * from './slo';
export * from './errors';
```

FILE: packages/shared-types/src/notification.ts

```typescript
import type { ISODateString, UUID } from './common';

export enum NotificationChannel {
  IN_APP = 'IN_APP',
  EMAIL = 'EMAIL',
  PUSH = 'PUSH',
  SMS = 'SMS',
  WEBHOOK = 'WEBHOOK',
  TELEGRAM = 'TELEGRAM',
}

export enum NotificationCategory {
  ACCOUNT = 'account',
  SECURITY = 'security',
  BILLING = 'billing',
  TRADING = 'trading',
  GENERAL = 'general',
}

export interface NotificationDto {
  id: UUID;
  tenantId: UUID;
  userId: UUID;
  channel: NotificationChannel;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: ISODateString | null;
  deliveredAt: ISODateString | null;
  createdAt: ISODateString;
}

export interface NotificationPreferenceDto {
  id: UUID;
  userId: UUID;
  category: string;
  channel: NotificationChannel;
  enabled: boolean;
  updatedAt: ISODateString;
}

/** Payload published on the notification queue. */
export interface TransactionalNotificationJob {
  tenantId: UUID;
  userId: UUID;
  type: string;
  locale: string;
  data: Record<string, unknown>;
  /** Optional explicit channel restriction; defaults to the template fan-out. */
  channels?: NotificationChannel[];
  requestId?: string;
}

/** Payload published on the email queue for the notification-service worker. */
export interface EmailJob {
  tenantId: UUID;
  userId: UUID | null;
  to: string;
  locale: string;
  subject: string;
  body: string;
  templateType: string;
  /** Branding snapshot so the worker never needs a database round-trip. */
  branding: {
    appName: string;
    logoUrl: string | null;
    primaryColor: string;
    supportEmail: string | null;
  };
  data: Record<string, unknown>;
}
```

FILE: packages/shared-types/src/rbac.ts

```typescript
/**
 * Role Based Access Control contracts.
 *
 * Roles are data (rows in the `Role` table) so tenants can define custom roles,
 * but the platform ships a fixed set of system roles that cannot be deleted.
 * Authorization decisions are always made against *permissions*, never against
 * role names, which is what allows new roles to be introduced without touching
 * guards or controllers.
 */

export enum SystemRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  TENANT_ADMIN = 'TENANT_ADMIN',
  TRADER = 'TRADER',
  FOLLOWER = 'FOLLOWER',
  SUPPORT = 'SUPPORT',
  FINANCE = 'FINANCE',
  COMPLIANCE = 'COMPLIANCE',
}

/** Scope at which a role may be granted. */
export enum RoleScope {
  PLATFORM = 'PLATFORM',
  TENANT = 'TENANT',
}

/**
 * Permission strings follow `resource:action`. Wildcards are supported on the
 * action segment (`tenant:*`) and globally (`*`) for the platform super admin.
 *
 * One exception, introduced with Part 5 and enforced by `permissionMatches`:
 * a small set of permissions that move real money or disarm a safety control
 * are excluded from action wildcards. See `NON_WILDCARD_PERMISSIONS`.
 */
export enum Permission {
  ALL = '*',

  // Platform level
  PLATFORM_MANAGE = 'platform:manage',
  PLATFORM_READ_METRICS = 'platform:read_metrics',
  PLATFORM_IMPERSONATE = 'platform:impersonate',

  // Tenants
  TENANT_CREATE = 'tenant:create',
  TENANT_READ = 'tenant:read',
  TENANT_UPDATE = 'tenant:update',
  TENANT_DELETE = 'tenant:delete',
  TENANT_SUSPEND = 'tenant:suspend',
  TENANT_BRANDING_READ = 'tenant_branding:read',
  TENANT_BRANDING_UPDATE = 'tenant_branding:update',
  TENANT_SETTINGS_READ = 'tenant_settings:read',
  TENANT_SETTINGS_UPDATE = 'tenant_settings:update',
  TENANT_DOMAIN_MANAGE = 'tenant_domain:manage',

  // Users
  USER_CREATE = 'user:create',
  USER_READ = 'user:read',
  USER_UPDATE = 'user:update',
  USER_DELETE = 'user:delete',
  USER_SUSPEND = 'user:suspend',
  USER_ASSIGN_ROLE = 'user:assign_role',
  USER_RESET_PASSWORD = 'user:reset_password',
  USER_READ_SESSIONS = 'user:read_sessions',
  USER_REVOKE_SESSIONS = 'user:revoke_sessions',

  // RBAC
  ROLE_CREATE = 'role:create',
  ROLE_READ = 'role:read',
  ROLE_UPDATE = 'role:update',
  ROLE_DELETE = 'role:delete',
  PERMISSION_READ = 'permission:read',

  // Billing
  PLAN_READ = 'plan:read',
  PLAN_MANAGE = 'plan:manage',
  SUBSCRIPTION_READ = 'subscription:read',
  SUBSCRIPTION_MANAGE = 'subscription:manage',
  INVOICE_READ = 'invoice:read',
  PAYOUT_MANAGE = 'payout:manage',

  // Feature flags
  FEATURE_FLAG_READ = 'feature_flag:read',
  FEATURE_FLAG_MANAGE = 'feature_flag:manage',

  // Compliance / audit
  AUDIT_LOG_READ = 'audit_log:read',
  SECURITY_EVENT_READ = 'security_event:read',
  KYC_READ = 'kyc:read',
  KYC_REVIEW = 'kyc:review',

  // Trading domain (enforced from Part 2, declared now so policies are stable)
  EXCHANGE_ACCOUNT_READ = 'exchange_account:read',
  EXCHANGE_ACCOUNT_MANAGE = 'exchange_account:manage',
  STRATEGY_READ = 'strategy:read',
  STRATEGY_MANAGE = 'strategy:manage',
  COPY_SUBSCRIPTION_READ = 'copy_subscription:read',
  COPY_SUBSCRIPTION_MANAGE = 'copy_subscription:manage',
  ORDER_READ = 'order:read',
  ORDER_MANAGE = 'order:manage',
  POSITION_READ = 'position:read',
  PORTFOLIO_READ = 'portfolio:read',
  REPORT_READ = 'report:read',
  SUPPORT_TICKET_READ = 'support_ticket:read',
  SUPPORT_TICKET_MANAGE = 'support_ticket:manage',
  NOTIFICATION_SEND = 'notification:send',

  // ---------------------------------------------------------------------
  // Part 5 - authenticated execution
  // ---------------------------------------------------------------------
  // Separated from the Part 2 trading permissions on purpose. `order:read`
  // lets a follower see their own order history; `execution:submit` lets a
  // caller push a signed request at a real exchange with real money behind it.
  // Collapsing those into one permission is how a support agent ends up able
  // to trade.

  /** View execution pipeline state: engine health, gates, latency observations. */
  EXECUTION_READ = 'execution:read',
  /** Submit an order through the execution engine. Never granted to SUPPORT. */
  EXECUTION_SUBMIT = 'execution:submit',
  /** Cancel a working order. Separate from submit: cancelling is risk-reducing. */
  EXECUTION_CANCEL = 'execution:cancel',

  /** Read the immutable order event / audit trail for an order. */
  ORDER_EVENT_READ = 'order_event:read',
  /** Read normalised fills. */
  FILL_READ = 'fill:read',

  /** Read venue balances as last observed. */
  BALANCE_READ = 'balance:read',
  /** Force a balance refresh against the venue. Costs rate-limit weight. */
  BALANCE_REFRESH = 'balance:refresh',

  /** Run a credential check against the venue for an exchange account. */
  EXCHANGE_ACCOUNT_VERIFY = 'exchange_account:verify',
  /** Replace the stored credential or its secret-manager pointer. */
  EXCHANGE_ACCOUNT_ROTATE_CREDENTIALS = 'exchange_account:rotate_credentials',
  /**
   * Arm live trading on one account. The single most dangerous permission in
   * the platform: it is the human half of the LIVE_TRADING_ENABLED gate.
   * Excluded from wildcards.
   */
  EXCHANGE_ACCOUNT_ENABLE_LIVE = 'exchange_account:enable_live',

  /** Observe private user-data stream session health. */
  PRIVATE_STREAM_READ = 'private_stream:read',
  /** Start, stop or force-reconnect a private user-data stream. */
  PRIVATE_STREAM_MANAGE = 'private_stream:manage',

  /** Read reconciliation runs and their discrepancies. */
  RECONCILIATION_READ = 'reconciliation:read',
  /** Trigger an out-of-band reconciliation pass for an account. */
  RECONCILIATION_TRIGGER = 'reconciliation:trigger',
  /**
   * Mark a discrepancy as accepted after human review. This is the only way a
   * disagreement between local state and the venue is ever closed - the
   * service itself never silently repairs one. Excluded from wildcards.
   */
  RECONCILIATION_RESOLVE = 'reconciliation:resolve',

  /** Read execution incidents. */
  EXECUTION_INCIDENT_READ = 'execution_incident:read',
  /** Close an execution incident with a resolution note. */
  EXECUTION_INCIDENT_RESOLVE = 'execution_incident:resolve',

  /** Read kill switch state. */
  KILL_SWITCH_READ = 'kill_switch:read',
  /**
   * Engage or release a kill switch. Engaging is always allowed to anyone
   * holding this; the danger is releasing one, which is why it is excluded
   * from wildcards.
   */
  KILL_SWITCH_OPERATE = 'kill_switch:operate',

  // ---------------------------------------------------------------------
  // Part 6 - strategy layer
  // ---------------------------------------------------------------------
  // `strategy:read` and `strategy:manage` already existed and keep their
  // Part 2 meaning: the catalogue and the strategy record. The permissions
  // below are about the running instance, because reading a strategy's
  // definition and starting it against a live market feed are not the same
  // act and must not be grantable with one click.
  //
  // None of these can enable live trading. Enabling an instance makes it emit
  // signals; whether a signal becomes an order is still decided by the risk
  // engine and the Part 5 execution gates.

  /** Read published strategy versions and their parameter schemas. */
  STRATEGY_VERSION_READ = 'strategy_version:read',

  /** Read strategy instances: configuration, health, run history. */
  STRATEGY_INSTANCE_READ = 'strategy_instance:read',
  /** Create an instance or change its configuration. Does not start it. */
  STRATEGY_INSTANCE_MANAGE = 'strategy_instance:manage',
  /**
   * Start an instance so it begins consuming market data and emitting signals.
   * Excluded from wildcards: `strategy_instance:*` granted to let someone tidy
   * up configuration must not also let them put a strategy into production.
   */
  STRATEGY_INSTANCE_ENABLE = 'strategy_instance:enable',
  /**
   * Stop an instance. Deliberately NOT excluded from wildcards and granted
   * widely: stopping a strategy is risk-reducing, and a permission check is
   * the wrong thing to be arguing with while something misbehaves.
   */
  STRATEGY_INSTANCE_DISABLE = 'strategy_instance:disable',

  /** Read strategy incidents. */
  STRATEGY_INCIDENT_READ = 'strategy_incident:read',
  /** Close a strategy incident with a resolution note. */
  STRATEGY_INCIDENT_RESOLVE = 'strategy_incident:resolve',

  /** Read strategy engine counters and latency observations. */
  STRATEGY_METRICS_READ = 'strategy_metrics:read',

  /** Read backtest runs and their results. */
  BACKTEST_READ = 'backtest:read',
  /** Submit a backtest. Touches no venue; it replays stored data. */
  BACKTEST_SUBMIT = 'backtest:submit',

  /** Read paper trading sessions and their simulated portfolios. */
  PAPER_SESSION_READ = 'paper_session:read',
  /** Start or stop a paper session. Simulated fills only, never a venue. */
  PAPER_SESSION_OPERATE = 'paper_session:operate',

  // ---------------------------------------------------------------------
  // Part 7 - historical datasets
  //
  // Datasets are public market data: no user funds, no credentials, no
  // orders. The write permissions are about STORAGE INTEGRITY and AVAIL-
  // ABILITY, which is why they are graded the way they are:
  //
  //   * read   - what exists, is it valid, what covers my window;
  //   * ingest - queue an ingestion job (bounded storage work);
  //   * validate - queue a re-validation of a version;
  //   * quarantine - withdraw a version from use (risk-reducing, so wild-
  //     cards may grant it, like strategy_instance:disable);
  //   * archive - retire a version (excluded from wildcards: it removes a
  //     reproducibility resource others may still be citing in results).
  //
  // None of these can enable live trading, and no dataset permission can
  // mutate the payload of a VALIDATED version - that is enforced in the
  // service layer, not merely in these names.

  /** Read dataset metadata, versions, validation reports and coverage. */
  DATASET_READ = 'dataset:read',
  /** Queue a historical ingestion job. Storage and bandwidth, no venue calls. */
  DATASET_INGEST = 'dataset:ingest',
  /** Queue a re-validation of a dataset version. Read-only over the bytes. */
  DATASET_VALIDATE = 'dataset:validate',
  /** Withdraw a dataset version from normal replay use. */
  DATASET_QUARANTINE = 'dataset:quarantine',
  /** Retire a dataset version. Never deletes payload data. */
  DATASET_ARCHIVE = 'dataset:archive',

  // ---------------------------------------------------------------------------
  // Part 8: the risk engine's control surface.
  //
  // The shape deliberately mirrors the execution permissions: reading risk
  // state is safe and wide, changing limits is narrow and explicit, and
  // disarming protection is narrowest of all. There is no permission that
  // approves an order - that verdict belongs to the engine's rule table and
  // nothing in the API can overrule it.
  // ---------------------------------------------------------------------------

  /** Read risk status, snapshots, limits, exposure, events and PnL summaries. */
  RISK_READ = 'risk:read',
  /** Publish a new versioned risk-limit configuration. Tighten freely; the
   *  service still validates domain and hierarchy, never blind-widens. */
  RISK_CONFIG_UPDATE = 'risk:config:update',
  /** Engage or release kill switches on the risk surface (the Part 5
   *  KILL_SWITCH_OPERATE still governs the execution-admin route; the two
   *  write the same durable rows, and this permission exists so a tenant can
   *  hand the *risk* console its own narrow grant). */
  RISK_KILL_SWITCH_UPDATE = 'risk:kill_switch_update',
  /** Clear or acknowledge an automatic-protection trip. Separate from
   *  RISK_KILL_SWITCH_UPDATE because releasing a PROTECTION - a halt the
   *  engine imposed on itself after a breach - deserves its own name on an
   *  audit line and its own role on the org chart. */
  RISK_PROTECTION_CLEAR = 'risk:protection_clear',

  // ---------------------------------------------------------------------------
  // Operations / observability (Part 9)
  //
  // Reading the operations panel is deliberately broad; mutating an alert is
  // narrow and explicit, because force-resolving an alert is dismissing
  // operational evidence. There is no permission that disables observability
  // at runtime (that is a redeploy decision enforced by env validation) and
  // none that approves trading: readiness reports, the risk gate decides.
  // ---------------------------------------------------------------------------

  /** Read health, trading readiness, alerts, incidents and the panel
   *  documents. Never grants the metrics scrape endpoint itself: /metrics is
   *  a machine surface secured by METRICS_TOKEN and network isolation. */
  OPERATIONS_READ = 'operations:read',
  /** Acknowledge or force-resolve an operational alert. */
  OPERATIONS_ALERTS_UPDATE = 'operations:alerts_update',

  // ---------------------------------------------------------------------------
  // Part 10: reliability (SLO definitions, evaluations, tracing posture).
  //
  // Only one write permission exists here, and it writes OBJECTIVES, never
  // outcomes: an SLO states what operators expect of the platform; it can
  // never authorise a trade. Reads ride OPERATIONS_READ (the SLO panel is
  // part of the operations panel); evaluation rows are machine-written by
  // the maintenance job and manual evaluation ticks are audited.
  // ---------------------------------------------------------------------------

  /** Publish a new versioned SLO definition (or disable one). Mirrors the
   *  risk-config discipline: versioned append, checksummed payload, every
   *  write audited; no permission here changes what a failed objective does
   *  beyond firing burn-rate alerts. */
  OPERATIONS_SLO_UPDATE = 'operations:slo_update',
}

/**
 * Permissions that a `resource:*` wildcard does NOT grant.
 *
 * Wildcards are a convenience for building custom roles, and the failure mode
 * of a convenience is that someone grants `exchange_account:*` meaning "let
 * support fix API keys" and hands out the ability to arm live trading. These
 * must be listed explicitly on a role.
 *
 * The platform super admin's global `*` still matches: that role is the
 * break-glass identity and restricting it would only produce a system nobody
 * can operate in an incident.
 */
export const NON_WILDCARD_PERMISSIONS: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    Permission.EXCHANGE_ACCOUNT_ENABLE_LIVE,
    Permission.EXCHANGE_ACCOUNT_ROTATE_CREDENTIALS,
    Permission.EXECUTION_SUBMIT,
    Permission.KILL_SWITCH_OPERATE,
    Permission.RECONCILIATION_RESOLVE,
    Permission.PLATFORM_IMPERSONATE,
    Permission.STRATEGY_INSTANCE_ENABLE,
    // Starting an ingestion spends bounded storage and bandwidth against an
    // external archive, and archiving removes a reproducibility resource;
    // neither should arrive as a wildcard side effect. Quarantine is
    // deliberately NOT here: withdrawing corrupt data is a safety action,
    // and a permission argument is the wrong thing to be having during one.
    Permission.DATASET_INGEST,
    Permission.DATASET_ARCHIVE,
    // Part 8. Widening a risk limit and disarming a protection both make the
    // system MORE willing to trade; neither may arrive as a wildcard side
    // effect. RISK_READ and (deliberately) the kill-switch engage path stay
    // wildcardable: reading is harmless, and engaging a switch only ever
    // stops things - a wildcard that lets you halt trading is fine.
    Permission.RISK_CONFIG_UPDATE,
    Permission.RISK_PROTECTION_CLEAR,
    // Part 9. Dismissing operational evidence must never arrive as a
    // wildcard side effect. Acknowledge is *not* in this set - like
    // engaging a kill switch, it only ever means "seen, on it"; what needs
    // explicit listing is the resolve half, which the same permission
    // carries - so the whole update permission stays explicit. The
    // justification is the resolve; the name is the one permission.
    Permission.OPERATIONS_ALERTS_UPDATE,
    // Part 10. Redefining what the platform PROMISES (the SLO objective a
    // burn-rate alert fires against) moves the evidentiary baseline the same
    // way dismissing evidence does: explicit grant or nothing.
    Permission.OPERATIONS_SLO_UPDATE,
  ]),
);

/**
 * Every Part 5 permission, in declaration order. Exported so the seed script
 * and the admin UI enumerate the execution surface without hard-coding it.
 */
export const EXECUTION_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.EXECUTION_READ,
  Permission.EXECUTION_SUBMIT,
  Permission.EXECUTION_CANCEL,
  Permission.ORDER_EVENT_READ,
  Permission.FILL_READ,
  Permission.BALANCE_READ,
  Permission.BALANCE_REFRESH,
  Permission.EXCHANGE_ACCOUNT_VERIFY,
  Permission.EXCHANGE_ACCOUNT_ROTATE_CREDENTIALS,
  Permission.EXCHANGE_ACCOUNT_ENABLE_LIVE,
  Permission.PRIVATE_STREAM_READ,
  Permission.PRIVATE_STREAM_MANAGE,
  Permission.RECONCILIATION_READ,
  Permission.RECONCILIATION_TRIGGER,
  Permission.RECONCILIATION_RESOLVE,
  Permission.EXECUTION_INCIDENT_READ,
  Permission.EXECUTION_INCIDENT_RESOLVE,
  Permission.KILL_SWITCH_READ,
  Permission.KILL_SWITCH_OPERATE,
]);

/**
 * Every Part 6 permission, in declaration order. Exported for the same reason
 * as `EXECUTION_PERMISSIONS`: the seed script and the admin UI enumerate the
 * strategy surface from one list rather than each keeping their own copy.
 */
export const STRATEGY_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.STRATEGY_VERSION_READ,
  Permission.STRATEGY_INSTANCE_READ,
  Permission.STRATEGY_INSTANCE_MANAGE,
  Permission.STRATEGY_INSTANCE_ENABLE,
  Permission.STRATEGY_INSTANCE_DISABLE,
  Permission.STRATEGY_INCIDENT_READ,
  Permission.STRATEGY_INCIDENT_RESOLVE,
  Permission.STRATEGY_METRICS_READ,
  Permission.BACKTEST_READ,
  Permission.BACKTEST_SUBMIT,
  Permission.PAPER_SESSION_READ,
  Permission.PAPER_SESSION_OPERATE,
]);

/**
 * The read-only subset of the strategy surface.
 *
 * This is what the mobile application is allowed to hold, and what a support
 * or compliance role is granted. Nothing in this list starts, stops or
 * reconfigures anything.
 */
export const STRATEGY_READ_ONLY_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.STRATEGY_READ,
  Permission.STRATEGY_VERSION_READ,
  Permission.STRATEGY_INSTANCE_READ,
  Permission.STRATEGY_INCIDENT_READ,
  Permission.STRATEGY_METRICS_READ,
  Permission.BACKTEST_READ,
  Permission.PAPER_SESSION_READ,
]);

/**
 * Every Part 7 permission, in declaration order. Exported for the same
 * reason as STRATEGY_PERMISSIONS: one list, enumerated by seed and admin,
 * never re-typed by hand.
 */
export const DATASET_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.DATASET_READ,
  Permission.DATASET_INGEST,
  Permission.DATASET_VALIDATE,
  Permission.DATASET_QUARANTINE,
  Permission.DATASET_ARCHIVE,
]);

/** The read-only dataset surface: metadata, validity, coverage. Nothing here
 *  starts work or changes state. */
export const DATASET_READ_ONLY_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.DATASET_READ,
]);

/**
 * Every Part 8 permission, in declaration order - the same single-list rule
 * used for the execution, strategy and dataset surfaces so seed, admin UI
 * and API enumerate one source of truth instead of three hand-copied ones.
 *
 * KILL_SWITCH_READ/OPERATE (Part 5) remain the execution-console names for
 * the same durable switch rows; RISK_KILL_SWITCH_UPDATE exists so the risk
 * console can be granted without the execution console. Both routes call
 * the same service; there is no second switch state to drift.
 */
export const RISK_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.RISK_READ,
  Permission.RISK_CONFIG_UPDATE,
  Permission.RISK_KILL_SWITCH_UPDATE,
  Permission.RISK_PROTECTION_CLEAR,
]);

export const OPERATIONS_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.OPERATIONS_READ,
  Permission.OPERATIONS_ALERTS_UPDATE,
  Permission.OPERATIONS_SLO_UPDATE,
]);

/** The read-only risk surface: status, snapshot metadata, limits, exposure,
 *  events. This is the mobile grant and the support/compliance grant. */
export const RISK_READ_ONLY_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.RISK_READ,
]);

export interface PermissionDefinition {
  key: Permission;
  resource: string;
  action: string;
  description: string;
  /** True when a `resource:*` wildcard will not grant this permission. */
  requiresExplicitGrant: boolean;
}

export interface RoleDefinition {
  key: SystemRole;
  name: string;
  description: string;
  scope: RoleScope;
  isSystem: true;
  permissions: Permission[];
}

const TRADER_PERMISSIONS: Permission[] = [
  Permission.EXCHANGE_ACCOUNT_READ,
  Permission.EXCHANGE_ACCOUNT_MANAGE,
  Permission.STRATEGY_READ,
  Permission.STRATEGY_MANAGE,
  Permission.DATASET_READ,
  Permission.ORDER_READ,
  Permission.ORDER_MANAGE,
  Permission.POSITION_READ,
  Permission.PORTFOLIO_READ,
  Permission.COPY_SUBSCRIPTION_READ,
  Permission.REPORT_READ,

  // Part 5. A trader may trade their own account and see why an order was
  // refused, but may not arm live trading, rotate a credential, release a kill
  // switch or close a reconciliation discrepancy. Those are operator actions.
  Permission.EXECUTION_READ,
  Permission.EXECUTION_SUBMIT,
  Permission.EXECUTION_CANCEL,
  Permission.ORDER_EVENT_READ,
  Permission.FILL_READ,
  Permission.BALANCE_READ,
  Permission.BALANCE_REFRESH,
  Permission.EXCHANGE_ACCOUNT_VERIFY,
  Permission.PRIVATE_STREAM_READ,
  Permission.RECONCILIATION_READ,
  Permission.EXECUTION_INCIDENT_READ,
  Permission.KILL_SWITCH_READ,

  // Part 6. A trader owns their strategies end to end: configure, backtest,
  // paper trade, start and stop. What they cannot do is make any of that reach
  // a venue on its own - that still needs the account armed for live trading,
  // which is a tenant-administrator action.
  Permission.STRATEGY_VERSION_READ,
  Permission.STRATEGY_INSTANCE_READ,
  Permission.STRATEGY_INSTANCE_MANAGE,
  Permission.STRATEGY_INSTANCE_ENABLE,
  Permission.STRATEGY_INSTANCE_DISABLE,
  Permission.STRATEGY_INCIDENT_READ,
  Permission.STRATEGY_METRICS_READ,
  Permission.BACKTEST_READ,
  Permission.BACKTEST_SUBMIT,
  Permission.PAPER_SESSION_READ,
  Permission.PAPER_SESSION_OPERATE,

  // Part 8. A trader sees their risk posture and can STOP things (the
  // engage permission only ever halts trading); re-versioning limits and
  // clearing a triggered protection are administrator acts. The asymmetry
  // is the point: "why is my strategy blocked" must be answerable by the
  // person running the strategy - "what unblocks it" is not theirs to press.
  Permission.RISK_READ,
  Permission.RISK_KILL_SWITCH_UPDATE,
];

const FOLLOWER_PERMISSIONS: Permission[] = [
  Permission.EXCHANGE_ACCOUNT_READ,
  Permission.EXCHANGE_ACCOUNT_MANAGE,
  Permission.COPY_SUBSCRIPTION_READ,
  Permission.COPY_SUBSCRIPTION_MANAGE,
  Permission.ORDER_READ,
  Permission.POSITION_READ,
  Permission.PORTFOLIO_READ,
  Permission.STRATEGY_READ,

  // Part 5. A follower's orders originate from a copy subscription, not from
  // the follower pressing a button, so EXECUTION_SUBMIT is deliberately absent.
  // Cancel is present: a user must always be able to stop something that is
  // already working against them.
  Permission.EXECUTION_CANCEL,
  Permission.ORDER_EVENT_READ,
  Permission.FILL_READ,
  Permission.BALANCE_READ,
  Permission.BALANCE_REFRESH,
  Permission.EXCHANGE_ACCOUNT_VERIFY,
  Permission.PRIVATE_STREAM_READ,
  Permission.RECONCILIATION_READ,
  Permission.EXECUTION_INCIDENT_READ,

  // Part 6. A follower copies a trader; they do not run strategies. They may
  // see which strategy is behind what they are copying, and nothing more.
  Permission.STRATEGY_VERSION_READ,
];

/**
 * Default permission matrix seeded into the database. Tenant admins may clone
 * these roles and tune the permission set per brand.
 */
export const SYSTEM_ROLE_DEFINITIONS: readonly RoleDefinition[] = Object.freeze([
  {
    key: SystemRole.SUPER_ADMIN,
    name: 'Super Administrator',
    description: 'Platform owner. Unrestricted access across every tenant.',
    scope: RoleScope.PLATFORM,
    isSystem: true,
    permissions: [Permission.ALL],
  },
  {
    key: SystemRole.TENANT_ADMIN,
    name: 'Tenant Administrator',
    description: 'Full administrative control limited to a single tenant.',
    scope: RoleScope.TENANT,
    isSystem: true,
    permissions: [
      Permission.TENANT_READ,
      Permission.TENANT_UPDATE,
      Permission.TENANT_BRANDING_READ,
      Permission.TENANT_BRANDING_UPDATE,
      Permission.TENANT_SETTINGS_READ,
      Permission.TENANT_SETTINGS_UPDATE,
      Permission.TENANT_DOMAIN_MANAGE,
      Permission.USER_CREATE,
      Permission.USER_READ,
      Permission.USER_UPDATE,
      Permission.USER_DELETE,
      Permission.USER_SUSPEND,
      Permission.USER_ASSIGN_ROLE,
      Permission.USER_RESET_PASSWORD,
      Permission.USER_READ_SESSIONS,
      Permission.USER_REVOKE_SESSIONS,
      Permission.ROLE_CREATE,
      Permission.ROLE_READ,
      Permission.ROLE_UPDATE,
      Permission.ROLE_DELETE,
      Permission.PERMISSION_READ,
      Permission.PLAN_READ,
      Permission.SUBSCRIPTION_READ,
      Permission.SUBSCRIPTION_MANAGE,
      Permission.INVOICE_READ,
      Permission.FEATURE_FLAG_READ,
      Permission.FEATURE_FLAG_MANAGE,
      Permission.AUDIT_LOG_READ,
      Permission.SECURITY_EVENT_READ,
      Permission.KYC_READ,
      Permission.EXCHANGE_ACCOUNT_READ,
      Permission.STRATEGY_READ,
      Permission.STRATEGY_MANAGE,
      Permission.COPY_SUBSCRIPTION_READ,
      Permission.ORDER_READ,
      Permission.POSITION_READ,
      Permission.PORTFOLIO_READ,
      Permission.REPORT_READ,
      Permission.SUPPORT_TICKET_READ,
      Permission.SUPPORT_TICKET_MANAGE,
      Permission.NOTIFICATION_SEND,

      // Part 5. The tenant administrator is the operator role: it owns the
      // safety controls for its own tenant. It holds ENABLE_LIVE and
      // KILL_SWITCH_OPERATE because someone inside the tenant must be able to
      // stop trading at 3am without a platform escalation. It does NOT hold
      // EXECUTION_SUBMIT - administering a brand is not trading it, and an
      // admin who wants to trade can be granted the TRADER role as well.
      Permission.EXECUTION_READ,
      Permission.EXECUTION_CANCEL,
      Permission.ORDER_EVENT_READ,
      Permission.FILL_READ,
      Permission.BALANCE_READ,
      Permission.BALANCE_REFRESH,
      Permission.EXCHANGE_ACCOUNT_VERIFY,
      Permission.EXCHANGE_ACCOUNT_ROTATE_CREDENTIALS,
      Permission.EXCHANGE_ACCOUNT_ENABLE_LIVE,
      Permission.PRIVATE_STREAM_READ,
      Permission.PRIVATE_STREAM_MANAGE,
      Permission.RECONCILIATION_READ,
      Permission.RECONCILIATION_TRIGGER,
      Permission.RECONCILIATION_RESOLVE,
      Permission.EXECUTION_INCIDENT_READ,
      Permission.EXECUTION_INCIDENT_RESOLVE,
      Permission.KILL_SWITCH_READ,
      Permission.KILL_SWITCH_OPERATE,

      // Part 6. The operator role for the strategy layer too: it can stop
      // anything, resolve incidents and see everything. It can also enable an
      // instance, because an administrator who can arm live trading on an
      // account but cannot start a paper strategy would be an odd shape.
      Permission.STRATEGY_VERSION_READ,
      Permission.STRATEGY_INSTANCE_READ,
      Permission.STRATEGY_INSTANCE_MANAGE,
      Permission.STRATEGY_INSTANCE_ENABLE,
      Permission.STRATEGY_INSTANCE_DISABLE,
      Permission.STRATEGY_INCIDENT_READ,
      Permission.STRATEGY_INCIDENT_RESOLVE,
      Permission.STRATEGY_METRICS_READ,
      Permission.BACKTEST_READ,
      Permission.BACKTEST_SUBMIT,
      Permission.PAPER_SESSION_READ,

      // Part 7. The dataset surface is storage and integrity administration;
      // the tenant administrator owns it entirely. Reading a dataset is not
      // sensitive (public market data), but ingesting, validating and
      // withdrawing versions are operator acts and they live here.
      ...DATASET_PERMISSIONS,
      Permission.PAPER_SESSION_OPERATE,

      // Part 8. The whole risk control plane: read, re-version limits,
      // engage stops, clear protections. Named entry by entry rather than
      // spread, so the explicit-grant rule on the two power permissions
      // stays visible at the grant site too.
      Permission.RISK_READ,
      Permission.RISK_CONFIG_UPDATE,
      Permission.RISK_KILL_SWITCH_UPDATE,
      Permission.RISK_PROTECTION_CLEAR,

      // Part 9. The operator role reads the operations panel and owns its
      // tenant's alert lifecycle. Platform-infrastructure alerts (tenant
      // null) are readable here but only resolvable by the platform break-
      // glass role; the service enforces that split, and it is stated here
      // so the grant list tells the whole story.
      Permission.OPERATIONS_READ,
      Permission.OPERATIONS_ALERTS_UPDATE,
      // Part 10. Setting an error objective for the tenant's operational
      // surface is an admin act like the alert lifecycle above it; it grants
      // no power over trading and no power over evidence already recorded.
      Permission.OPERATIONS_SLO_UPDATE,
    ],
  },
  {
    key: SystemRole.TRADER,
    name: 'Trader',
    description: 'Publishes strategies that followers can copy.',
    scope: RoleScope.TENANT,
    isSystem: true,
    permissions: TRADER_PERMISSIONS,
  },
  {
    key: SystemRole.FOLLOWER,
    name: 'Follower',
    description: 'Copies traders using their own non-custodial exchange keys.',
    scope: RoleScope.TENANT,
    isSystem: true,
    permissions: FOLLOWER_PERMISSIONS,
  },
  {
    key: SystemRole.SUPPORT,
    name: 'Support Agent',
    description: 'Read-mostly access for customer support operations.',
    scope: RoleScope.TENANT,
    isSystem: true,
    permissions: [
      Permission.USER_READ,
      Permission.USER_READ_SESSIONS,
      Permission.TENANT_READ,
      Permission.SUBSCRIPTION_READ,
      Permission.ORDER_READ,
      Permission.POSITION_READ,
      Permission.PORTFOLIO_READ,
      Permission.COPY_SUBSCRIPTION_READ,
      Permission.SUPPORT_TICKET_READ,
      Permission.SUPPORT_TICKET_MANAGE,
      Permission.AUDIT_LOG_READ,

      // Part 5. Read-only, and not one write anywhere on the money path.
      // Support answers "what happened to my order", which needs the event
      // trail and the incident, and nothing else.
      Permission.ORDER_EVENT_READ,
      Permission.FILL_READ,
      Permission.BALANCE_READ,
      Permission.EXECUTION_READ,
      Permission.PRIVATE_STREAM_READ,
      Permission.RECONCILIATION_READ,
      Permission.EXECUTION_INCIDENT_READ,
      Permission.KILL_SWITCH_READ,

      // Part 6. Read-only, so that support can answer "why did my strategy
      // stop" without being able to start it again.
      Permission.STRATEGY_INSTANCE_READ,
      Permission.STRATEGY_INCIDENT_READ,
      Permission.STRATEGY_METRICS_READ,
      Permission.PAPER_SESSION_READ,

      // Part 7. Read-only: "which data did that backtest use" is a support
      // question once results are shown in the console. Writing anything on
      // this surface is not.
      Permission.DATASET_READ,

      // Part 8. Read-only posture: "why is trading halted, and who said
      // so" is a support question, and the switch lifecycle now answers it.
      // No grant here moves money, limits or halts.
      Permission.RISK_READ,
      Permission.OPERATIONS_READ,
    ],
  },
  {
    key: SystemRole.FINANCE,
    name: 'Finance',
    description: 'Billing, invoicing, payouts and revenue reporting.',
    scope: RoleScope.TENANT,
    isSystem: true,
    permissions: [
      Permission.TENANT_READ,
      Permission.USER_READ,
      Permission.PLAN_READ,
      Permission.SUBSCRIPTION_READ,
      Permission.SUBSCRIPTION_MANAGE,
      Permission.INVOICE_READ,
      Permission.PAYOUT_MANAGE,
      Permission.REPORT_READ,
      Permission.AUDIT_LOG_READ,

      // Part 5. Fee and payout calculations are derived from fills and
      // balances, so finance needs to read them. Nothing else.
      Permission.FILL_READ,
      Permission.BALANCE_READ,
    ],
  },
  {
    key: SystemRole.COMPLIANCE,
    name: 'Compliance Officer',
    description: 'KYC review, audit trail inspection and security oversight.',
    scope: RoleScope.TENANT,
    isSystem: true,
    permissions: [
      Permission.TENANT_READ,
      Permission.USER_READ,
      Permission.USER_SUSPEND,
      Permission.KYC_READ,
      Permission.KYC_REVIEW,
      Permission.AUDIT_LOG_READ,
      Permission.SECURITY_EVENT_READ,
      Permission.REPORT_READ,

      // Part 5. Compliance reads the whole execution audit trail and can
      // engage a kill switch - stopping trading is never the wrong call for a
      // compliance officer to be able to make.
      Permission.ORDER_EVENT_READ,
      Permission.FILL_READ,
      Permission.BALANCE_READ,
      Permission.EXECUTION_READ,
      Permission.RECONCILIATION_READ,
      Permission.EXECUTION_INCIDENT_READ,
      Permission.KILL_SWITCH_READ,
      Permission.KILL_SWITCH_OPERATE,

      // Part 6. Compliance reads the whole strategy trail - what ran, what it
      // was configured with, what it was told about itself - and can stop an
      // instance, which is never the wrong call for a compliance officer to be
      // able to make.
      Permission.STRATEGY_VERSION_READ,
      Permission.STRATEGY_INSTANCE_READ,
      Permission.STRATEGY_INSTANCE_DISABLE,
      Permission.STRATEGY_INCIDENT_READ,
      Permission.STRATEGY_METRICS_READ,
      Permission.BACKTEST_READ,
      Permission.PAPER_SESSION_READ,

      // Part 7. Compliance reads dataset provenance (a backtest's data is
      // part of its audit trail) and can quarantine a version - withdrawing
      // suspect data is risk-reducing, in the same family as stopping a
      // strategy or a kill switch.
      Permission.DATASET_READ,
      Permission.DATASET_QUARANTINE,

      // Part 8. Compliance reads the risk posture and can pull stops, which
      // is consistent with the KILL_SWITCH_OPERATE grant above - engaging
      // only ever halts trading. Widening limits (RISK_CONFIG_UPDATE) and
      // clearing a triggered protection (RISK_PROTECTION_CLEAR) are
      // deliberately NOT granted here: neither is a risk-reducing act.
      Permission.RISK_READ,
      Permission.RISK_KILL_SWITCH_UPDATE,
      Permission.OPERATIONS_READ,
    ],
  },
]);

/**
 * Splits `resource:action` and evaluates wildcard matching.
 *
 * Order of checks matters:
 *   1. the global `*` grants everything, including non-wildcard permissions;
 *   2. an exact string match always grants;
 *   3. a `resource:*` wildcard grants every action on that resource EXCEPT
 *      those listed in `NON_WILDCARD_PERMISSIONS`.
 */
export function permissionMatches(granted: string, required: string): boolean {
  if (granted === Permission.ALL) {
    return true;
  }
  if (granted === required) {
    return true;
  }
  const [grantedResource, grantedAction] = granted.split(':');
  const [requiredResource, requiredAction] = required.split(':');
  if (!grantedResource || !requiredResource) {
    return false;
  }
  if (grantedResource !== requiredResource) {
    return false;
  }
  if (grantedAction !== '*' || requiredAction === undefined) {
    return false;
  }
  // A wildcard never reaches a permission that arms live trading, rotates a
  // credential, releases a kill switch or closes a discrepancy.
  return !NON_WILDCARD_PERMISSIONS.has(required);
}

export function hasPermission(grantedPermissions: readonly string[], required: string): boolean {
  return grantedPermissions.some((granted) => permissionMatches(granted, required));
}

export function hasAllPermissions(
  grantedPermissions: readonly string[],
  required: readonly string[],
): boolean {
  return required.every((permission) => hasPermission(grantedPermissions, permission));
}

export function hasAnyPermission(
  grantedPermissions: readonly string[],
  required: readonly string[],
): boolean {
  return required.some((permission) => hasPermission(grantedPermissions, permission));
}

/** Derives resource/action metadata for every declared permission. */
export function describePermissions(): PermissionDefinition[] {
  return Object.values(Permission)
    .filter((value) => value !== Permission.ALL)
    .map((value) => {
      const [resource, action] = value.split(':');
      return {
        key: value,
        resource,
        action,
        description: `Allows the "${action}" action on the "${resource}" resource.`,
        requiresExplicitGrant: NON_WILDCARD_PERMISSIONS.has(value),
      };
    });
}
```

FILE: packages/shared-types/src/realtime.ts

```typescript
import type { ISODateString, UUID } from './common';

/** Socket.IO event names shared by server and clients. */
export enum RealtimeEvent {
  CONNECTION_ESTABLISHED = 'connection.established',
  CONNECTION_ERROR = 'connection.error',
  SUBSCRIBE = 'subscribe',
  UNSUBSCRIBE = 'unsubscribe',
  SUBSCRIPTION_ACK = 'subscription.ack',
  HEARTBEAT = 'heartbeat',

  NOTIFICATION_CREATED = 'notification.created',
  SECURITY_ALERT = 'security.alert',
  SESSION_REVOKED = 'session.revoked',
  TENANT_CONFIG_UPDATED = 'tenant.config.updated',
  FEATURE_FLAG_UPDATED = 'feature_flag.updated',

  // Trading channels are declared now so client code stays stable across parts
  MARKET_TICKER = 'market.ticker',
  MARKET_ORDERBOOK = 'market.orderbook',
  ORDER_UPDATED = 'order.updated',
  POSITION_UPDATED = 'position.updated',
  PORTFOLIO_UPDATED = 'portfolio.updated',
  COPY_TRADE_EXECUTED = 'copy_trade.executed',
}

export enum RealtimeChannel {
  USER = 'user',
  TENANT = 'tenant',
  MARKET = 'market',
  TRADER = 'trader',
}

export interface RealtimeSubscribePayload {
  channel: RealtimeChannel;
  /** Resource identifier, e.g. a symbol for market channels. */
  target?: string;
}

export interface RealtimeEnvelope<TPayload> {
  event: RealtimeEvent;
  channel: string;
  tenantId: UUID;
  emittedAt: ISODateString;
  payload: TPayload;
}

export function userRoom(tenantId: string, userId: string): string {
  return `tenant:${tenantId}:user:${userId}`;
}

export function tenantRoom(tenantId: string): string {
  return `tenant:${tenantId}`;
}

export function marketRoom(symbol: string): string {
  return `market:${symbol.toUpperCase()}`;
}

export function traderRoom(tenantId: string, traderId: string): string {
  return `tenant:${tenantId}:trader:${traderId}`;
}
```

FILE: packages/shared-types/src/slo.ts

```typescript
/**
 * Part 10 (reliability) wire types for the SLO surface.
 *
 * The engine-side authority for all of this is the Python package
 * `wlct_trading.slo` (model.py, budget.py, burn.py, evaluate.py,
 * catalog.py); these TypeScript declarations mirror it and are
 * parity-tested against the committed vectors in
 * `docs/fixtures/reliability_fixtures.json`. Two rules travel with every
 * number here:
 *
 * 1. Every comparable quantity is an INTEGER in ppm or a canonical DECIMAL
 *    STRING - never a float. The same discipline as money everywhere else on
 *    this platform; the reason is identical (checksums must not wobble).
 * 2. These views MEASURE and PAGE. They never authorise: nothing on this
 *    surface can widen, unlock, or resume anything. A red SLO is a question
 *    for a human, answered elsewhere.
 */

/** The five evaluation states (mirror of wlct_trading.slo.model.SloState). */
export enum SloState {
  HEALTHY = 'HEALTHY',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
  EXHAUSTED = 'EXHAUSTED',
  /** Measurement missing or incomplete. Renders as UNKNOWN in the panel -
   *  never as HEALTHY ("no data" is not "all good") and never as a failure
   *  count. */
  UNKNOWN = 'UNKNOWN',
}

/** The nine closed indicator families (mirror of SloIndicator). No generic
 *  expression escape hatch exists on either side by design. */
export enum SloIndicator {
  AVAILABILITY = 'availability',
  REQUEST_SUCCESS_RATIO = 'request_success_ratio',
  QUEUE_PROCESSING_SUCCESS = 'queue_processing_success',
  QUEUE_FRESHNESS = 'queue_freshness',
  MARKET_DATA_FRESHNESS = 'market_data_freshness',
  RISK_STATE_FRESHNESS = 'risk_state_freshness',
  RECONCILIATION_FRESHNESS = 'reconciliation_freshness',
  LATENCY_THRESHOLD_COMPLIANCE = 'latency_threshold_compliance',
  ERROR_RATE_COMPLIANCE = 'error_rate_compliance',
}

/** Which window a burn-rate number belongs to (mirror of SloWindowKind). */
export enum SloWindowKind {
  SHORT = 'short',
  LONG = 'long',
}

/** The AND-window alert verdict for one evaluation tick. `fast` and `slow`
 *  map to their paging rules; `both` is what a >= fast breach reports when
 *  the fast threshold is at or above the slow one (documented degeneracy of
 *  the classic multi-window design, parity-pinned). */
export enum SloBurnAlertKind {
  NONE = 'none',
  FAST = 'fast',
  SLOW = 'slow',
  BOTH = 'both',
}

/** The closed fault-point universe (mirror of wlct_trading.observability.
 *  faults.FAULT_POINTS). Listing these is READ-ONLY documentation of what
 *  a configuration could arm in a non-production deployment; there is no
 *  API that arms anything, by either name, at runtime. */
export enum SloFaultPoint {
  METRICS_EXPORT_UNAVAILABLE = 'metrics_export_unavailable',
  TRACE_EXPORT_UNAVAILABLE = 'trace_export_unavailable',
  REDIS_HEALTH_PROBE_UNAVAILABLE = 'redis_health_probe_unavailable',
  POSTGRES_HEALTH_PROBE_UNAVAILABLE = 'postgres_health_probe_unavailable',
  QUEUE_OBSERVED_DELAY = 'queue_observed_delay',
  QUEUE_OBSERVED_FAILURE = 'queue_observed_failure',
  MARKET_DATA_STALE_SIMULATED = 'market_data_stale_simulated',
  RISK_SNAPSHOT_STALE_SIMULATED = 'risk_snapshot_stale_simulated',
  RECONCILIATION_DELAY_SIMULATED = 'reconciliation_delay_simulated',
  ALERT_PERSISTENCE_FAILURE = 'alert_persistence_failure',
}

/** One SLO definition as the panel renders it. `objective` is the canonical
 *  decimal STRING exactly as the engine stores it ("99.5"); ppm integers
 *  carry the derived quantities. */
export interface SloDefinitionView {
  sloId: string;
  version: number;
  service: string;
  owner: string;
  description: string;
  indicator: SloIndicator;
  objective: string;
  objectivePpm: number;
  allowedPpm: number;
  windowMinutes: number;
  shortWindowMinutes: number;
  goodEvent: string;
  badEvent: string;
  warningBurnPpm: number;
  criticalBurnPpm: number;
  /** Microseconds as decimal strings (the platform 64-bit rule), null
   *  exactly when the indicator shape forbids the field. */
  maxAgeMicros: string | null;
  latencyThresholdMicros: string | null;
  enabled: boolean;
  checksum: string;
  createdAt: string;
  updatedAt: string;
}

/** One evaluation row. Null ppm fields mean "undefined for this window",
 *  never zero. */
export interface SloEvaluationView {
  sloId: string;
  version: number;
  checksum: string;
  indicator: SloIndicator;
  service: string;
  state: SloState;
  evaluatedAtMicros: string;
  windowMinutes: number;
  shortWindowMinutes: number;
  targetPpm: number;
  actualPpm: number | null;
  budgetTotalEvents: number;
  budgetConsumedEvents: number;
  budgetRemainingEvents: number;
  remainingRatioPpm: number | null;
  longBurnPpm: number | null;
  shortBurnPpm: number | null;
  alertKind: SloBurnAlertKind;
  samplesGood: number;
  samplesBad: number;
  dataComplete: boolean;
  reason: string | null;
}

/** Definition plus its latest evaluation (and the burn alert that follows
 *  from it), the unit the panel table renders. */
export interface SloStatusView {
  definition: SloDefinitionView;
  latest: SloEvaluationView | null;
  /** True when the latest evaluation's burn verdict pages (both-window AND). */
  burnAlerting: boolean;
}

/** The scorecard rollup: counts, the worst remaining budget, and which SLOs
 *  currently fail. Feeds the observability panel; feeds nothing else. */
export interface SloReadinessView {
  evaluatedAtMicros: string;
  total: number;
  byState: Record<SloState, number>;
  /** Minimum remaining-budget ratio across evidenced SLOs (ppm), null when
   *  nothing is evidenced. The floor, not the average: one exhausted
   *  objective is the headline. */
  worstRemainingRatioPpm: number | null;
  /** Maximum long-window burn across evidenced SLOs (ppm). */
  maxLongBurnPpm: number | null;
  /** sloIds in a paging state right now (CRITICAL/EXHAUSTED or alerting). */
  pagingSloIds: string[];
  /** sloIds whose latest tick is UNKNOWN - a measurement gap, listed so it
   *  cannot be silently averaged away. */
  unmeasuredSloIds: string[];
  /** Always present; always says the quiet part: these numbers may measure
   *  and page, they never authorise. */
  note: string;
}

/** Command body accepted by POST /v1/operational/slos/:sloId/config. The
 *  objective travels as a string for the reasons stated at the top of this
 *  file; the server re-canonicalises and re-checksums. */
export interface SloConfigUpdateDto {
  objective: string;
  windowMinutes: number;
  shortWindowMinutes: number;
  owner: string;
  description: string;
  goodEvent: string;
  badEvent: string;
  warningBurnPpm?: number;
  criticalBurnPpm?: number;
  maxAgeMicros?: string | null;
  latencyThresholdMicros?: string | null;
  enabled?: boolean;
}

/** Result envelope for a published definition or a manual evaluation. */
export interface SloCommandResultView {
  accepted: boolean;
  sloId: string;
  version: number;
  checksum: string;
  evaluation: SloEvaluationView | null;
}

/** Tracing posture of the API process (and, via the mirrored engines, of
 *  the plane - this view reports what THIS process knows). */
export interface TracingStatusView {
  enabled: boolean;
  endpointConfigured: boolean;
  sampleRatio: number;
  priorityOperations: string[];
  bufferedSpans: number;
  exportedTotal: number;
  droppedTotal: number;
  consecutiveExportFailures: number;
  lastExportOutcome: string | null;
}

/** The current request's trace identity, for the console's "copy trace id"
 *  affordance and nothing else. */
export interface CurrentTraceView {
  traceparent: string | null;
  traceId: string | null;
  spanId: string | null;
  sampled: boolean;
}

/** Fault-injection posture (read-only describe of the config-armed plan;
 *  `enabled` here reflects what the environment armed, nothing more). */
export interface FaultsStatusView {
  enabled: boolean;
  production: boolean;
  activePoints: SloFaultPoint[];
}
```

FILE: packages/shared-types/src/tenant.ts

```typescript
import type { ISODateString, SupportedCurrency, SupportedLocale, UUID } from './common';

export enum TenantStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  ARCHIVED = 'ARCHIVED',
}

export enum TenantDomainStatus {
  PENDING_DNS = 'PENDING_DNS',
  PENDING_CERTIFICATE = 'PENDING_CERTIFICATE',
  ACTIVE = 'ACTIVE',
  FAILED = 'FAILED',
}

export interface TenantBrandingDto {
  id: UUID;
  tenantId: UUID;
  appName: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  themeMode: 'light' | 'dark' | 'system';
  supportEmail: string | null;
  supportUrl: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  customCss: string | null;
  socialLinks: Record<string, string>;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface TenantSettingDto {
  id: UUID;
  tenantId: UUID;
  key: string;
  value: unknown;
  category: string;
  isSecret: boolean;
  description: string | null;
  updatedAt: ISODateString;
}

export interface TenantDomainDto {
  id: UUID;
  tenantId: UUID;
  domain: string;
  isPrimary: boolean;
  status: TenantDomainStatus;
  verificationToken: string;
  verifiedAt: ISODateString | null;
  createdAt: ISODateString;
}

export interface TenantDto {
  id: UUID;
  slug: string;
  name: string;
  legalName: string | null;
  status: TenantStatus;
  ownerUserId: UUID | null;
  defaultLocale: SupportedLocale;
  supportedLocales: SupportedLocale[];
  defaultCurrency: SupportedCurrency;
  supportedCurrencies: SupportedCurrency[];
  timezone: string;
  contactEmail: string | null;
  contactPhone: string | null;
  countryCode: string | null;
  platformFeeBps: number;
  performanceFeeBps: number;
  maxUsers: number | null;
  maxTraders: number | null;
  branding?: TenantBrandingDto;
  domains?: TenantDomainDto[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt: ISODateString | null;
}

export interface FeatureFlagDto {
  id: UUID;
  key: string;
  name: string;
  description: string | null;
  isGlobalDefault: boolean;
  rolloutPercentage: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface TenantFeatureFlagDto {
  id: UUID;
  tenantId: UUID;
  featureFlagId: UUID;
  key: string;
  enabled: boolean;
  rolloutPercentage: number | null;
  metadata: Record<string, unknown>;
  updatedAt: ISODateString;
}

/** Public, unauthenticated bootstrap payload used by mobile + web clients. */
export interface TenantPublicConfigDto {
  tenantId: UUID;
  slug: string;
  name: string;
  status: TenantStatus;
  branding: Omit<TenantBrandingDto, 'tenantId' | 'id' | 'createdAt' | 'updatedAt'>;
  defaultLocale: SupportedLocale;
  supportedLocales: SupportedLocale[];
  defaultCurrency: SupportedCurrency;
  supportedCurrencies: SupportedCurrency[];
  features: Record<string, boolean>;
  registrationEnabled: boolean;
  twoFactorRequired: boolean;
}
```

FILE: packages/shared-types/src/trading.ts

```typescript
/**
 * Trading domain contracts (Part 2).
 *
 * These types are the wire contract between the NestJS API, the Next.js admin
 * console and the Flutter app. They mirror the Python definitions in
 * `libs/trading-core/wlct_trading/enums.py`; the string values are identical on
 * both sides and are persisted to PostgreSQL, so renaming one requires a
 * migration and a coordinated change in both languages.
 *
 * SECURITY: nothing in this file describes a credential. There is deliberately
 * no `apiKey`, `apiSecret` or `passphrase` field on any view type. The only
 * credential-adjacent value a client ever receives is
 * `TradingAccountView.apiKeyLastFour`, which is four non-secret characters kept
 * purely so a user can tell two of their own keys apart.
 */

// `DecimalString` is defined once in `./common` and re-used here rather than
// redeclared: `number` is IEEE-754 and cannot represent `0.1` exactly, so
// serialising a price through it silently corrupts the value.
import type { DecimalString } from './common';

// -----------------------------------------------------------------------------
// Enumerations
// -----------------------------------------------------------------------------

export enum TradingVenue {
  BINANCE = 'BINANCE',
  BYBIT = 'BYBIT',
  OKX = 'OKX',
  KRAKEN = 'KRAKEN',
  /** Simulated venue. Every fill it produces is flagged as simulated. */
  PAPER = 'PAPER',
}

export enum TradingMarketType {
  SPOT = 'SPOT',
  MARGIN = 'MARGIN',
  FUTURES_USDT = 'FUTURES_USDT',
  FUTURES_COIN = 'FUTURES_COIN',
}

export enum TradingAccountStatus {
  PENDING_VALIDATION = 'PENDING_VALIDATION',
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
  CREDENTIALS_INVALID = 'CREDENTIALS_INVALID',
  WITHDRAWAL_ENABLED_REJECTED = 'WITHDRAWAL_ENABLED_REJECTED',
}

/**
 * Resolved trading mode.
 *
 * `DISABLED` is the default in every environment. Reaching `LIVE` requires the
 * account setting, `TRADING_ENABLED`, `TRADING_MODE=LIVE` and
 * `LIVE_TRADING_CONFIRMED` to all agree — an omitted variable can therefore
 * never produce live trading.
 */
export enum TradingMode {
  DISABLED = 'DISABLED',
  PAPER = 'PAPER',
  LIVE = 'LIVE',
}

export enum StrategyStatus {
  DRAFT = 'DRAFT',
  ENABLED = 'ENABLED',
  DISABLED = 'DISABLED',
  ERROR = 'ERROR',
}

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP = 'STOP',
  STOP_LIMIT = 'STOP_LIMIT',
}

export enum TimeInForce {
  GTC = 'GTC',
  IOC = 'IOC',
  FOK = 'FOK',
  DAY = 'DAY',
}

export enum OrderStatus {
  PENDING = 'PENDING',
  SUBMITTED = 'SUBMITTED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCEL_REQUESTED = 'CANCEL_REQUESTED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  FAILED = 'FAILED',
}

/** Statuses from which no further transition is possible. */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = Object.freeze([
  OrderStatus.FILLED,
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
  OrderStatus.EXPIRED,
  OrderStatus.FAILED,
]);

/** Statuses in which the order still consumes exposure and open-order budget. */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = Object.freeze([
  OrderStatus.PENDING,
  OrderStatus.SUBMITTED,
  OrderStatus.ACKNOWLEDGED,
  OrderStatus.PARTIALLY_FILLED,
  OrderStatus.CANCEL_REQUESTED,
]);

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

export function isOpenOrderStatus(status: OrderStatus): boolean {
  return OPEN_ORDER_STATUSES.includes(status);
}

export enum PositionSide {
  LONG = 'LONG',
  SHORT = 'SHORT',
  FLAT = 'FLAT',
}

export enum SignalAction {
  BUY = 'BUY',
  SELL = 'SELL',
  CLOSE = 'CLOSE',
  HOLD = 'HOLD',
}

/**
 * The scopes at which trading can be halted, broadest first.
 *
 * Part 5 shipped GLOBAL/EXCHANGE/STRATEGY/SYMBOL for operational halts.
 * Part 8 added ACCOUNT (halt one trading account) and RISK (the engine's
 * emergency brake, target `account:<id>` - halts new risk-bearing
 * submissions while letting risk-reducing orders through). The EXECUTION
 * console cannot operate the two new scopes; the risk console operates
 * ACCOUNT/STRATEGY/SYMBOL and never GLOBAL/EXCHANGE. The split is enforced
 * at each surface's DTO, not by this enum.
 */
export enum KillSwitchScope {
  GLOBAL = 'GLOBAL',
  EXCHANGE = 'EXCHANGE',
  ACCOUNT = 'ACCOUNT',
  RISK = 'RISK',
  STRATEGY = 'STRATEGY',
  SYMBOL = 'SYMBOL',
}

export enum RiskEventType {
  LIMIT_BREACHED = 'LIMIT_BREACHED',
  ORDER_REJECTED = 'ORDER_REJECTED',
  KILL_SWITCH_ENGAGED = 'KILL_SWITCH_ENGAGED',
  KILL_SWITCH_RELEASED = 'KILL_SWITCH_RELEASED',
  STALE_MARKET_DATA = 'STALE_MARKET_DATA',
  RISK_STATE_UNAVAILABLE = 'RISK_STATE_UNAVAILABLE',
  DUPLICATE_ORDER_BLOCKED = 'DUPLICATE_ORDER_BLOCKED',
  ORDER_BOOK_RESYNC = 'ORDER_BOOK_RESYNC',
}

export enum RiskEventSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
}

/** Machine-readable reason the risk engine approved or refused an intent. */
export enum RiskDecisionCode {
  APPROVED = 'APPROVED',
  KILL_SWITCH_ENGAGED = 'KILL_SWITCH_ENGAGED',
  TRADING_DISABLED = 'TRADING_DISABLED',
  STRATEGY_DISABLED = 'STRATEGY_DISABLED',
  MAX_ORDER_SIZE_EXCEEDED = 'MAX_ORDER_SIZE_EXCEEDED',
  MAX_ORDER_NOTIONAL_EXCEEDED = 'MAX_ORDER_NOTIONAL_EXCEEDED',
  MAX_POSITION_SIZE_EXCEEDED = 'MAX_POSITION_SIZE_EXCEEDED',
  MAX_SYMBOL_EXPOSURE_EXCEEDED = 'MAX_SYMBOL_EXPOSURE_EXCEEDED',
  MAX_ACCOUNT_EXPOSURE_EXCEEDED = 'MAX_ACCOUNT_EXPOSURE_EXCEEDED',
  MAX_OPEN_ORDERS_EXCEEDED = 'MAX_OPEN_ORDERS_EXCEEDED',
  ORDER_RATE_EXCEEDED = 'ORDER_RATE_EXCEEDED',
  DAILY_LOSS_LIMIT_BREACHED = 'DAILY_LOSS_LIMIT_BREACHED',
  STRATEGY_LOSS_LIMIT_BREACHED = 'STRATEGY_LOSS_LIMIT_BREACHED',
  PRICE_DEVIATION_EXCEEDED = 'PRICE_DEVIATION_EXCEEDED',
  STALE_MARKET_DATA = 'STALE_MARKET_DATA',
  DUPLICATE_ORDER = 'DUPLICATE_ORDER',
  INVALID_INTENT = 'INVALID_INTENT',
  SYMBOL_NOT_TRADEABLE = 'SYMBOL_NOT_TRADEABLE',
  RISK_STATE_UNAVAILABLE = 'RISK_STATE_UNAVAILABLE',
}

export enum TradingSessionStatus {
  STARTING = 'STARTING',
  RUNNING = 'RUNNING',
  DEGRADED = 'DEGRADED',
  STOPPING = 'STOPPING',
  STOPPED = 'STOPPED',
  FAILED = 'FAILED',
}

/** Whether an order book may be trusted for pricing. Only `OK` qualifies. */
export enum OrderBookHealth {
  OK = 'OK',
  UNINITIALISED = 'UNINITIALISED',
  RESYNC_REQUIRED = 'RESYNC_REQUIRED',
  STALE = 'STALE',
  CROSSED = 'CROSSED',
}

/** Every event that can travel on the internal trading event bus. */
export enum TradingEventType {
  MARKET_DATA_RECEIVED = 'MarketDataReceived',
  ORDER_BOOK_UPDATED = 'OrderBookUpdated',
  TRADE_RECEIVED = 'TradeReceived',
  SIGNAL_GENERATED = 'SignalGenerated',
  RISK_CHECK_REQUESTED = 'RiskCheckRequested',
  ORDER_REQUESTED = 'OrderRequested',
  ORDER_SUBMITTED = 'OrderSubmitted',
  ORDER_ACCEPTED = 'OrderAccepted',
  ORDER_REJECTED = 'OrderRejected',
  ORDER_PARTIALLY_FILLED = 'OrderPartiallyFilled',
  ORDER_FILLED = 'OrderFilled',
  ORDER_CANCELLED = 'OrderCancelled',
  POSITION_UPDATED = 'PositionUpdated',
  RISK_LIMIT_BREACHED = 'RiskLimitBreached',
}

// -----------------------------------------------------------------------------
// Read models returned by the API
// -----------------------------------------------------------------------------

export interface ExchangeView {
  id: string;
  venue: TradingVenue;
  name: string;
  isEnabled: boolean;
  tradingEnabled: boolean;
  supportedMarketTypes: TradingMarketType[];
  requiresPassphrase: boolean;
  supportsSandbox: boolean;
  maxLeverage: number;
  weightLimitPerMinute: number;
  maxOrdersPerSecond: number;
}

/**
 * A tenant's connection to a venue.
 *
 * Contains no credential material by construction. `apiKeyLastFour` is the only
 * key-derived value present and is not secret.
 */
export interface TradingAccountView {
  id: string;
  tenantId: string;
  exchangeId: string;
  venue: TradingVenue;
  userId: string | null;
  label: string;
  status: TradingAccountStatus;
  marketType: TradingMarketType;
  tradingMode: TradingMode;
  isSandbox: boolean;
  apiKeyLastFour: string;
  canTrade: boolean;
  canReadData: boolean;
  /** Always false on a usable account; a true value means the key was refused. */
  canWithdraw: boolean;
  ipRestricted: boolean;
  lastVerifiedAt: string | null;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
}

export interface TradingSymbolView {
  id: string;
  tenantId: string;
  exchangeId: string;
  venue: TradingVenue;
  symbol: string;
  venueSymbol: string;
  baseAsset: string;
  quoteAsset: string;
  marketType: TradingMarketType;
  isTradeable: boolean;
  isSubscribed: boolean;
  priceTick: DecimalString;
  quantityStep: DecimalString;
  minQuantity: DecimalString;
  maxQuantity: DecimalString | null;
  minNotional: DecimalString;
  pricePrecision: number;
  quantityPrecision: number;
  maxOrderNotional: DecimalString | null;
}

export interface StrategyRiskProfileView {
  maxOrderQuantity: DecimalString;
  maxPositionQuantity: DecimalString;
  maxOrderNotional: DecimalString;
  maxDailyLoss: DecimalString;
  maxOpenOrders: number;
  maxOrdersPerMinute: number;
}

export interface StrategyView {
  id: string;
  tenantId: string;
  accountId: string | null;
  name: string;
  kind: string;
  version: string;
  status: StrategyStatus;
  enabled: boolean;
  venue: TradingVenue;
  symbols: string[];
  marketType: TradingMarketType;
  description: string | null;
  riskProfile: StrategyRiskProfileView;
  activeConfigurationVersion: number | null;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyConfigurationView {
  id: string;
  strategyId: string;
  version: number;
  parameters: Record<string, unknown>;
  isActive: boolean;
  activatedAt: string | null;
  changeNote: string | null;
  createdAt: string;
}

export interface OrderView {
  id: string;
  tenantId: string;
  accountId: string;
  strategyId: string | null;
  symbolId: string;
  clientOrderId: string;
  exchangeOrderId: string | null;
  signalId: string | null;
  venue: TradingVenue;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  timeInForce: TimeInForce;
  status: OrderStatus;
  quantity: DecimalString;
  price: DecimalString | null;
  stopPrice: DecimalString | null;
  reduceOnly: boolean;
  filledQuantity: DecimalString;
  remainingQuantity: DecimalString;
  averageFillPrice: DecimalString | null;
  cumulativeFee: DecimalString;
  feeCurrency: string | null;
  /** True when this order was executed on the simulated venue. */
  isSimulated: boolean;
  rejectionCode: string | null;
  rejectionReason: string | null;
  submitLatencyMicros: number | null;
  createdAt: string;
  submittedAt: string | null;
  terminalAt: string | null;
}

export interface OrderEventView {
  id: string;
  orderId: string;
  previousStatus: OrderStatus | null;
  status: OrderStatus;
  reason: string | null;
  occurredAtMicros: string;
  createdAt: string;
}

export interface FillView {
  id: string;
  orderId: string;
  venueTradeId: string;
  price: DecimalString;
  quantity: DecimalString;
  fee: DecimalString;
  feeCurrency: string;
  isMaker: boolean;
  /** True for paper fills. Never mutated after insert. */
  isSimulated: boolean;
  exchangeTimestampMicros: string;
  receivedTimestampMicros: string;
}

export interface PositionView {
  id: string;
  tenantId: string;
  accountId: string;
  symbolId: string;
  venue: TradingVenue;
  symbol: string;
  /** Signed: positive long, negative short, zero flat. */
  quantity: DecimalString;
  side: PositionSide;
  averageEntryPrice: DecimalString | null;
  markPrice: DecimalString | null;
  realisedPnl: DecimalString;
  /** Null when no mark price was available — never defaulted to zero. */
  unrealisedPnl: DecimalString | null;
  cumulativeFee: DecimalString;
  feeCurrency: string | null;
  /** True if any contributing fill was simulated. Sticky once set. */
  containsSimulatedFills: boolean;
  fillCount: number;
  openedAt: string | null;
  lastFillAt: string | null;
  updatedAt: string;
}

export interface RiskConfigurationView {
  id: string;
  tenantId: string;
  accountId: string;
  maxOrderQuantity: DecimalString;
  maxOrderNotional: DecimalString;
  maxPositionQuantity: DecimalString;
  maxSymbolExposureNotional: DecimalString;
  maxAccountExposureNotional: DecimalString;
  maxOpenOrders: number;
  maxOrdersPerMinute: number;
  maxDailyLoss: DecimalString;
  maxStrategyLoss: DecimalString;
  maxPriceDeviationPercent: DecimalString;
  maxMarketDataAgeMicros: number;
  tradingHalted: boolean;
  haltedReason: string | null;
  updatedAt: string;
}

export interface RiskEventView {
  id: string;
  tenantId: string;
  accountId: string | null;
  strategyId: string | null;
  orderId: string | null;
  eventType: RiskEventType;
  severity: RiskEventSeverity;
  code: string;
  message: string;
  limitValue: string | null;
  observedValue: string | null;
  venue: TradingVenue | null;
  symbol: string | null;
  correlationId: string | null;
  createdAt: string;
}

export interface KillSwitchView {
  id: string;
  tenantId: string | null;
  scope: KillSwitchScope;
  target: string | null;
  isEngaged: boolean;
  reason: string | null;
  engagedAt: string | null;
  releasedAt: string | null;
  updatedAt: string;
}

export interface TradingSessionView {
  id: string;
  tenantId: string;
  accountId: string | null;
  strategyId: string | null;
  status: TradingSessionStatus;
  tradingMode: TradingMode;
  workerId: string;
  startedAt: string;
  endedAt: string | null;
  heartbeatAt: string;
  signalsGenerated: number;
  ordersRequested: number;
  ordersSubmitted: number;
  ordersFilled: number;
  ordersRejected: number;
  riskRejections: number;
  bookResyncs: number;
  /** Observed measurements. The platform makes no latency guarantee. */
  medianDecisionLatencyMicros: number | null;
  p99DecisionLatencyMicros: number | null;
  stopReason: string | null;
}

/** Live top-of-book, served from Redis rather than PostgreSQL. */
export interface BookTopView {
  venue: TradingVenue;
  symbol: string;
  bestBid: DecimalString | null;
  bestBidQuantity: DecimalString | null;
  bestAsk: DecimalString | null;
  bestAskQuantity: DecimalString | null;
  midPrice: DecimalString | null;
  spread: DecimalString | null;
  spreadPercent: DecimalString | null;
  sequence: number;
  health: OrderBookHealth;
  exchangeTimestampMicros: string;
  receivedTimestampMicros: string;
}

/** Aggregate answer to "is this tenant trading, and is it safe?". */
export interface TradingStatusView {
  tenantId: string;
  /** Effective mode after every safeguard has been applied. */
  tradingMode: TradingMode;
  tradingEnabled: boolean;
  globalKillSwitchEngaged: boolean;
  engagedKillSwitches: KillSwitchView[];
  activeStrategies: number;
  enabledStrategies: number;
  openOrders: number;
  openPositions: number;
  connectedExchanges: number;
  degradedFeeds: string[];
  /** True when any open position was built from simulated fills. */
  hasSimulatedPositions: boolean;
  asOf: string;
}

// -----------------------------------------------------------------------------
// Write models accepted by the API
// -----------------------------------------------------------------------------

/**
 * Payload for connecting an exchange account.
 *
 * This is the only place an API secret is ever accepted, and only inbound: it
 * is encrypted immediately on receipt and never read back out. The API must
 * reject any key whose venue-reported permissions include withdrawal.
 */
export interface CreateTradingAccountRequest {
  exchangeId: string;
  label: string;
  marketType: TradingMarketType;
  isSandbox: boolean;
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
}

export interface UpdateTradingAccountRequest {
  label?: string;
  tradingMode?: TradingMode;
  status?: TradingAccountStatus.ACTIVE | TradingAccountStatus.DISABLED;
}

export interface UpsertRiskConfigurationRequest {
  maxOrderQuantity: DecimalString;
  maxOrderNotional: DecimalString;
  maxPositionQuantity: DecimalString;
  maxSymbolExposureNotional: DecimalString;
  maxAccountExposureNotional: DecimalString;
  maxOpenOrders: number;
  maxOrdersPerMinute: number;
  maxDailyLoss: DecimalString;
  maxStrategyLoss: DecimalString;
  maxPriceDeviationPercent: DecimalString;
  maxMarketDataAgeMicros: number;
  tradingHalted: boolean;
  haltedReason?: string;
}

export interface CreateStrategyRequest {
  name: string;
  kind: string;
  version: string;
  venue: TradingVenue;
  symbols: string[];
  marketType: TradingMarketType;
  accountId?: string;
  description?: string;
  maxOrderQuantity: DecimalString;
  maxPositionQuantity: DecimalString;
  maxOrderNotional: DecimalString;
  maxDailyLoss: DecimalString;
  maxOpenOrders: number;
  maxOrdersPerMinute: number;
}

export interface UpdateStrategyRequest {
  description?: string;
  accountId?: string;
  symbols?: string[];
  maxOrderQuantity?: DecimalString;
  maxPositionQuantity?: DecimalString;
  maxOrderNotional?: DecimalString;
  maxDailyLoss?: DecimalString;
  maxOpenOrders?: number;
  maxOrdersPerMinute?: number;
}

export interface SetStrategyEnabledRequest {
  enabled: boolean;
  reason?: string;
}

export interface CreateStrategyConfigurationRequest {
  parameters: Record<string, unknown>;
  changeNote?: string;
  activate: boolean;
}

/** Engaging or releasing one of the four kill switches. */
export interface SetKillSwitchRequest {
  scope: KillSwitchScope;
  /** Required for every scope except GLOBAL, which must omit it. */
  target?: string;
  engaged: boolean;
  reason: string;
}

// -----------------------------------------------------------------------------
// Realtime payloads
// -----------------------------------------------------------------------------

/** Envelope for every trading event pushed over the `/realtime` namespace. */
export interface TradingEventEnvelope<T = Record<string, unknown>> {
  eventId: string;
  eventType: TradingEventType;
  tenantId: string | null;
  correlationId: string;
  causationId: string | null;
  source: string;
  occurredAtMicros: string;
  payload: T;
}

/** Socket.IO room names for trading subscriptions. */
export const TRADING_ROOMS = Object.freeze({
  tenantTrading: (tenantId: string): string => `tenant:${tenantId}:trading`,
  account: (tenantId: string, accountId: string): string =>
    `tenant:${tenantId}:account:${accountId}`,
  strategy: (tenantId: string, strategyId: string): string =>
    `tenant:${tenantId}:strategy:${strategyId}`,
  book: (venue: TradingVenue, symbol: string): string => `book:${venue}:${symbol}`,
});

// -----------------------------------------------------------------------------
// Permissions
// -----------------------------------------------------------------------------

/**
 * Trading permissions, added to the 54 defined in Part 1.
 *
 * Read and write are separated everywhere, and the four irreversible or
 * money-moving capabilities — connecting an account, enabling a strategy,
 * changing a risk limit and operating a kill switch — are distinct permissions
 * so they can be granted independently of ordinary read access.
 */
export enum TradingPermission {
  EXCHANGE_READ = 'trading:exchange:read',
  EXCHANGE_MANAGE = 'trading:exchange:manage',

  ACCOUNT_READ = 'trading:account:read',
  ACCOUNT_CONNECT = 'trading:account:connect',
  ACCOUNT_MANAGE = 'trading:account:manage',

  SYMBOL_READ = 'trading:symbol:read',
  SYMBOL_MANAGE = 'trading:symbol:manage',

  STRATEGY_READ = 'trading:strategy:read',
  STRATEGY_MANAGE = 'trading:strategy:manage',
  STRATEGY_TOGGLE = 'trading:strategy:toggle',

  RISK_READ = 'trading:risk:read',
  RISK_MANAGE = 'trading:risk:manage',

  ORDER_READ = 'trading:order:read',
  ORDER_CANCEL = 'trading:order:cancel',

  POSITION_READ = 'trading:position:read',

  SESSION_READ = 'trading:session:read',

  KILL_SWITCH_READ = 'trading:killswitch:read',
  KILL_SWITCH_OPERATE = 'trading:killswitch:operate',
}

export const TRADING_PERMISSIONS: readonly TradingPermission[] = Object.freeze(
  Object.values(TradingPermission),
);
```

FILE: packages/shared-types/src/user.ts

```typescript
import type { ISODateString, SupportedCurrency, SupportedLocale, UUID } from './common';
import type { SystemRole } from './rbac';

export enum UserStatus {
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  LOCKED = 'LOCKED',
  DEACTIVATED = 'DEACTIVATED',
}

export enum KycStatus {
  NOT_STARTED = 'NOT_STARTED',
  PENDING = 'PENDING',
  IN_REVIEW = 'IN_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export interface UserProfileDto {
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  countryCode: string | null;
  timezone: string;
  locale: SupportedLocale;
  preferredCurrency: SupportedCurrency;
  marketingOptIn: boolean;
}

export interface UserRoleDto {
  roleId: UUID;
  key: string;
  name: string;
  scope: string;
  tenantId: UUID | null;
  assignedAt: ISODateString;
  expiresAt: ISODateString | null;
}

export interface UserDto {
  id: UUID;
  tenantId: UUID;
  email: string;
  emailVerifiedAt: ISODateString | null;
  phone: string | null;
  phoneVerifiedAt: ISODateString | null;
  status: UserStatus;
  kycStatus: KycStatus;
  isPlatformUser: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt: ISODateString | null;
  lastLoginIpHash: string | null;
  profile: UserProfileDto;
  roles: UserRoleDto[];
  permissions: string[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt: ISODateString | null;
}

export interface CreateUserInput {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  locale?: SupportedLocale;
  roleKeys?: SystemRole[];
  sendInvite?: boolean;
}

export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  displayName?: string;
  phone?: string;
  avatarUrl?: string;
  bio?: string;
  countryCode?: string;
  timezone?: string;
  locale?: SupportedLocale;
  preferredCurrency?: SupportedCurrency;
  marketingOptIn?: boolean;
}

export interface UserSessionDto {
  id: UUID;
  deviceId: string;
  deviceName: string | null;
  platform: string | null;
  appVersion: string | null;
  ipHash: string;
  approximateLocation: string | null;
  userAgent: string | null;
  isCurrent: boolean;
  trusted: boolean;
  createdAt: ISODateString;
  lastSeenAt: ISODateString;
  expiresAt: ISODateString;
  revokedAt: ISODateString | null;
}
```

FILE: packages/shared-types/tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

FILE: packages/utils/package.json

```json
{
  "name": "@wlct/utils",
  "version": "1.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "rimraf dist && tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@wlct/config": "1.0.0",
    "@wlct/shared-types": "1.0.0"
  },
  "devDependencies": {
    "rimraf": "^5.0.7",
    "typescript": "^5.5.4"
  }
}
```

FILE: packages/utils/src/crypto.ts

```typescript
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Low-level cryptographic primitives shared by the API and worker processes.
 *
 * Exchange API secrets use envelope encryption:
 *   1. A random 256-bit Data Encryption Key (DEK) is generated per record.
 *   2. The payload is sealed with AES-256-GCM under the DEK.
 *   3. The DEK itself is wrapped with the Key Encryption Key (KEK) that lives in
 *      the environment (local provider) or in a managed KMS (kms provider).
 * Rotating the KEK therefore only requires re-wrapping DEKs, not re-encrypting
 * every ciphertext.
 */

const AES_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export interface SealedPayload {
  /** Base64 ciphertext of the plaintext under the DEK. */
  ciphertext: string;
  /** Base64 IV used for the payload cipher. */
  iv: string;
  /** Base64 GCM authentication tag for the payload. */
  authTag: string;
  /** Base64 DEK wrapped under the KEK (iv + tag + ciphertext concatenated). */
  wrappedKey: string;
  /** Identifier of the KEK used, enabling rotation. */
  keyId: string;
  /** Algorithm marker for forward compatibility. */
  algorithm: 'aes-256-gcm';
  /** Encryption schema version. */
  version: 1;
}

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

export function generateKeyBase64(bytes = KEY_LENGTH): string {
  return randomBytes(bytes).toString('base64');
}

export function decodeKey(base64Key: string, expectedLength = KEY_LENGTH): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== expectedLength) {
    throw new CryptoError(
      `Invalid key length: expected ${expectedLength} bytes, received ${key.length}`,
    );
  }
  return key;
}

function aesEncrypt(key: Buffer, plaintext: Buffer, aad?: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  if (aad) {
    cipher.setAAD(aad);
  }
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function aesDecrypt(key: Buffer, payload: Buffer, aad?: Buffer): Buffer {
  if (payload.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new CryptoError('Ciphertext payload is truncated');
  }
  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(AES_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  if (aad) {
    decipher.setAAD(aad);
  }
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Seals plaintext with a freshly generated DEK wrapped by the provided KEK.
 * `aad` binds the ciphertext to a context (for example `${tenantId}:${userId}`)
 * so a row copied into another tenant fails authentication on decrypt.
 */
export function sealWithEnvelope(
  plaintext: string,
  kek: Buffer,
  keyId: string,
  aad?: string,
): SealedPayload {
  const dek = randomBytes(KEY_LENGTH);
  const aadBuffer = aad ? Buffer.from(aad, 'utf8') : undefined;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(AES_ALGORITHM, dek, iv, { authTagLength: AUTH_TAG_LENGTH });
  if (aadBuffer) {
    cipher.setAAD(aadBuffer);
  }
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const wrappedKey = aesEncrypt(kek, dek, aadBuffer);
  dek.fill(0);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    wrappedKey: wrappedKey.toString('base64'),
    keyId,
    algorithm: AES_ALGORITHM,
    version: 1,
  };
}

/** Reverses {@link sealWithEnvelope}. Throws when the payload was tampered with. */
export function openEnvelope(payload: SealedPayload, kek: Buffer, aad?: string): string {
  if (payload.algorithm !== AES_ALGORITHM || payload.version !== 1) {
    throw new CryptoError('Unsupported envelope version or algorithm');
  }
  const aadBuffer = aad ? Buffer.from(aad, 'utf8') : undefined;
  const dek = aesDecrypt(kek, Buffer.from(payload.wrappedKey, 'base64'), aadBuffer);
  try {
    const decipher = createDecipheriv(AES_ALGORITHM, dek, Buffer.from(payload.iv, 'base64'), {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
    if (aadBuffer) {
      decipher.setAAD(aadBuffer);
    }
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  } finally {
    dek.fill(0);
  }
}

/** Deterministic HMAC used for equality lookups on encrypted columns. */
export function blindIndex(value: string, key: Buffer): string {
  return createHmac('sha256', key).update(value.trim().toLowerCase()).digest('hex');
}

/** Non-reversible identifier for IP addresses stored alongside audit records. */
export function hashIpAddress(ip: string, key: Buffer): string {
  return createHmac('sha256', key).update(ip).digest('hex').slice(0, 32);
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Hash used to store refresh tokens: the raw token never touches the database. */
export function hashToken(token: string, pepper: Buffer): string {
  return createHmac('sha512', pepper).update(token).digest('hex');
}

export function generateOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

export function generateNumericCode(digits = 6): string {
  const max = 10 ** digits;
  const value = randomBytes(4).readUInt32BE(0) % max;
  return value.toString().padStart(digits, '0');
}

/** Human friendly recovery code, e.g. `A1B2-C3D4-E5F6`. */
export function generateRecoveryCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  const chars: string[] = [];
  for (let index = 0; index < 12; index += 1) {
    chars.push(alphabet[bytes[index] % alphabet.length]);
  }
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

export function newUuid(): string {
  return randomUUID();
}

/** Constant-time comparison that tolerates differing lengths. */
export function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    // Still perform a comparison to keep the timing profile flat.
    const padded = Buffer.alloc(bufferA.length, 0);
    timingSafeEqual(bufferA, padded);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}
```

FILE: packages/utils/src/index.ts

```typescript
export * from './redaction';
export * from './pagination';
export * from './strings';
export * from './crypto';
export * from './time';
export * from './result';
```

FILE: packages/utils/src/pagination.ts

```typescript
import { PAGINATION_DEFAULTS } from '@wlct/config';
import type { PaginatedResult, PaginationMeta, SortOrder } from '@wlct/shared-types';

export interface NormalisedPagination {
  page: number;
  limit: number;
  skip: number;
  take: number;
  sortBy?: string;
  sortOrder: SortOrder;
  search?: string;
}

export interface PaginationInput {
  page?: number | string;
  limit?: number | string;
  sortBy?: string;
  sortOrder?: string;
  search?: string;
}

function toPositiveInt(value: number | string | undefined, fallback: number): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

/**
 * Clamps client supplied paging parameters. `allowedSortFields` protects the
 * ORDER BY clause from arbitrary column injection.
 */
export function normalisePagination(
  input: PaginationInput = {},
  allowedSortFields: readonly string[] = [],
): NormalisedPagination {
  const page = toPositiveInt(input.page, PAGINATION_DEFAULTS.PAGE);
  const requestedLimit = toPositiveInt(input.limit, PAGINATION_DEFAULTS.LIMIT);
  const limit = Math.min(requestedLimit, PAGINATION_DEFAULTS.MAX_LIMIT);
  const sortOrder: SortOrder = input.sortOrder?.toLowerCase() === 'asc' ? 'asc' : 'desc';
  const sortBy =
    input.sortBy && allowedSortFields.includes(input.sortBy) ? input.sortBy : undefined;
  const search = input.search?.trim() ? input.search.trim().slice(0, 128) : undefined;

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    take: limit,
    sortBy,
    sortOrder,
    search,
  };
}

export function buildPaginationMeta(
  page: number,
  limit: number,
  totalItems: number,
): PaginationMeta {
  const totalPages = limit > 0 ? Math.ceil(totalItems / limit) : 0;
  return {
    page,
    limit,
    totalItems,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && totalItems > 0,
  };
}

export function paginated<TItem>(
  items: TItem[],
  page: number,
  limit: number,
  totalItems: number,
): PaginatedResult<TItem> {
  return { items, pagination: buildPaginationMeta(page, limit, totalItems) };
}
```

FILE: packages/utils/src/redaction.ts

```typescript
import { REDACTED_PLACEHOLDER, SENSITIVE_FIELD_NAMES } from '@wlct/config';

const SENSITIVE_LOOKUP = new Set(SENSITIVE_FIELD_NAMES.map((name) => name.toLowerCase()));

/** Patterns that look like credentials even when the key name is innocuous.
 *  Kept in lockstep with the Python side (`wlct_trading.observability.redaction`);
 *  the Part 9 fixture redaction cases pin both implementations to identical
 *  outputs, so a new leak pattern has to be added to both to pass CI. */
const VALUE_PATTERNS: RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /\bbearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, // Authorization: Bearer text form
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, // Stripe style keys
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, // AWS-style access key ids
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // Connection strings with embedded credentials: the credential part goes,
  // the host after '@' stays (already-visible topology, matching Python).
  /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s]+@/gi,
  // Signed query parameters as exchanges use them.
  /[?&](?:signature|sig|api[_-]?key|access[_-]?token)=[^&\s]+/gi,
];

/** The DSN rule replaces only up to the '@'; every other rule replaces the
 *  whole match. Index-parallel to VALUE_PATTERNS by construction. */
const REPLACEMENTS: string[] = VALUE_PATTERNS.map(() => REDACTED_PLACEHOLDER);
REPLACEMENTS[5] = `${REDACTED_PLACEHOLDER}@`;

/**
 * Exported for the Part 9 label guard and the cross-language redaction
 * parity test: one predicate decides "sensitive field name" for logs,
 * audit payloads and metric labels alike.
 */
export function isSensitiveKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[-_\s]/g, '');
  for (const sensitive of SENSITIVE_LOOKUP) {
    if (normalised === sensitive.toLowerCase().replace(/[-_\s]/g, '')) {
      return true;
    }
  }
  return (
    normalised.includes('password') ||
    normalised.includes('secret') ||
    normalised.includes('privatekey') ||
    normalised.includes('apikey') ||
    normalised.includes('accesstoken') ||
    normalised.includes('refreshtoken') ||
    normalised.includes('token') ||
    normalised.includes('passphrase') ||
    normalised.includes('signedquery') ||
    // Part 9 additions, mirrored on the Python side: the shapes that show up
    // in OPERATIONAL payloads (exception messages, mirror documents) even
    // though they never appeared in request bodies.
    normalised.includes('jwt') ||
    normalised.includes('signature') ||
    normalised.includes('credential') ||
    normalised.includes('dsn') ||
    normalised.includes('connectionstring') ||
    normalised.includes('databaseurl')
  );
}

export function redactString(value: string): string {
  let output = value;
  for (let index = 0; index < VALUE_PATTERNS.length; index += 1) {
    const pattern = VALUE_PATTERNS[index] as RegExp;
    output = output.replace(pattern, REPLACEMENTS[index] as string);
  }
  return output;
}

/**
 * Recursively removes sensitive material from any structure before it reaches a
 * log sink, an audit record, or an error response.
 */
export function redact<T>(input: T, depth = 0): T {
  if (depth > 8) {
    return REDACTED_PLACEHOLDER as unknown as T;
  }
  if (input === null || input === undefined) {
    return input;
  }
  if (typeof input === 'string') {
    return redactString(input) as unknown as T;
  }
  if (typeof input !== 'object') {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((item) => redact(item, depth + 1)) as unknown as T;
  }
  if (input instanceof Date) {
    return input;
  }
  if (Buffer.isBuffer(input)) {
    return REDACTED_PLACEHOLDER as unknown as T;
  }
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    output[key] = isSensitiveKey(key) ? REDACTED_PLACEHOLDER : redact(value, depth + 1);
  }
  return output as unknown as T;
}

/** Masks a credential leaving only enough characters for human recognition. */
export function maskSecret(value: string, visibleStart = 4, visibleEnd = 4): string {
  if (!value) {
    return '';
  }
  if (value.length <= visibleStart + visibleEnd) {
    return '*'.repeat(value.length);
  }
  return `${value.slice(0, visibleStart)}${'*'.repeat(
    Math.max(4, value.length - visibleStart - visibleEnd),
  )}${value.slice(-visibleEnd)}`;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) {
    return maskSecret(email, 1, 0);
  }
  const maskedLocal = local.length <= 2 ? `${local.charAt(0)}*` : `${local.slice(0, 2)}***`;
  return `${maskedLocal}@${domain}`;
}

/** Pino-compatible redaction paths. */
export const PINO_REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-2fa-token"]',
  'req.headers["x-internal-token"]',
  'req.body.password',
  'req.body.newPassword',
  'req.body.currentPassword',
  'req.body.refreshToken',
  'req.body.apiSecret',
  'req.body.apiKey',
  'req.body.passphrase',
  'req.body.totpCode',
  'res.headers["set-cookie"]',
  'password',
  'passwordHash',
  'accessToken',
  'refreshToken',
  'challengeToken',
  'apiSecret',
  'apiKey',
  'passphrase',
  'twoFactorSecret',
  'recoveryCodes',
  'encryptionKey',
  '*.password',
  '*.accessToken',
  '*.refreshToken',
  '*.apiSecret',
];
```

FILE: packages/utils/src/result.ts

```typescript
/** Lightweight result type for flows where exceptions are not appropriate. */

export type Result<TValue, TError = Error> =
  | { ok: true; value: TValue }
  | { ok: false; error: TError };

export function ok<TValue>(value: TValue): Result<TValue, never> {
  return { ok: true, value };
}

export function err<TError>(error: TError): Result<never, TError> {
  return { ok: false, error };
}

export function unwrapOr<TValue, TError>(result: Result<TValue, TError>, fallback: TValue): TValue {
  return result.ok ? result.value : fallback;
}

export async function tryCatch<TValue>(
  operation: () => Promise<TValue>,
): Promise<Result<TValue, Error>> {
  try {
    return ok(await operation());
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
```

FILE: packages/utils/src/strings.ts

```typescript
/** Deterministic string helpers used across services. */

export function slugify(value: string, maxLength = 63): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Extracts the tenant sub-domain from a host header, if any. */
export function extractSubdomain(host: string, rootDomain: string): string | null {
  const hostname = host.split(':')[0].toLowerCase();
  const root = rootDomain.toLowerCase();
  if (hostname === root || !hostname.endsWith(`.${root}`)) {
    return null;
  }
  const prefix = hostname.slice(0, hostname.length - root.length - 1);
  if (!prefix || prefix.includes('.')) {
    return prefix.split('.').pop() ?? null;
  }
  return prefix;
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

export function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
};

/** Defence-in-depth escaping for values echoed into HTML (emails, exports). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'/]/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Removes control characters that could forge log lines. */
export function sanitiseForLog(value: string, maxLength = 512): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, maxLength)
    .trim();
}

export function isValidHexColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
}

export function isValidDomain(value: string): boolean {
  return /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(
    value.toLowerCase(),
  );
}
```

FILE: packages/utils/src/time.ts

```typescript
/** Duration parsing shared by JWT configuration, caches and queue backoffs. */

const DURATION_PATTERN = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|y)?$/i;

const UNIT_MULTIPLIERS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  y: 365 * 24 * 60 * 60 * 1000,
};

export function parseDurationToMs(duration: string | number): number {
  if (typeof duration === 'number') {
    return duration;
  }
  const match = DURATION_PATTERN.exec(duration.trim());
  if (!match) {
    throw new Error(`Invalid duration format: "${duration}"`);
  }
  const value = Number.parseFloat(match[1]);
  const unit = (match[2] ?? 'ms').toLowerCase();
  const multiplier = UNIT_MULTIPLIERS[unit];
  if (multiplier === undefined) {
    throw new Error(`Unsupported duration unit: "${unit}"`);
  }
  return Math.floor(value * multiplier);
}

export function parseDurationToSeconds(duration: string | number): number {
  return Math.floor(parseDurationToMs(duration) / 1000);
}

export function addMilliseconds(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

export function addSeconds(date: Date, seconds: number): Date {
  return addMilliseconds(date, seconds * 1000);
}

export function isExpired(expiresAt: Date | string, now: Date = new Date()): boolean {
  const expiry = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  return expiry.getTime() <= now.getTime();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Exponential backoff with full jitter, capped. */
export function backoffWithJitter(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(Math.random() * exponential);
}
```

FILE: packages/utils/tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

FILE: packages/validation/package.json

```json
{
  "name": "@wlct/validation",
  "version": "1.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "rimraf dist && tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@wlct/config": "1.0.0",
    "@wlct/shared-types": "1.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "rimraf": "^5.0.7",
    "typescript": "^5.5.4"
  }
}
```

FILE: packages/validation/src/auth.schema.ts

```typescript
import { z } from 'zod';
import {
  deviceIdSchema,
  emailSchema,
  localeSchema,
  plainTextSchema,
  recoveryCodeSchema,
  totpCodeSchema,
} from './primitives';
import { passwordSchema } from './password.policy';

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: plainTextSchema(64).optional(),
  lastName: plainTextSchema(64).optional(),
  locale: localeSchema.optional(),
  referralCode: z.string().trim().max(32).optional(),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the terms of service' }),
  }),
  deviceId: deviceIdSchema,
  deviceName: plainTextSchema(64).optional(),
  platform: z.enum(['ios', 'android', 'web', 'desktop']).optional(),
  appVersion: z.string().trim().max(32).optional(),
});
export type RegisterSchema = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
  deviceId: deviceIdSchema,
  deviceName: plainTextSchema(64).optional(),
  platform: z.enum(['ios', 'android', 'web', 'desktop']).optional(),
  appVersion: z.string().trim().max(32).optional(),
  rememberDevice: z.boolean().default(false),
});
export type LoginSchema = z.infer<typeof loginSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(20, 'Refresh token is malformed').max(4096),
  deviceId: deviceIdSchema,
});
export type RefreshTokenSchema = z.infer<typeof refreshTokenSchema>;

export const logoutSchema = z.object({
  refreshToken: z.string().min(20).max(4096).optional(),
  allDevices: z.boolean().default(false),
});
export type LogoutSchema = z.infer<typeof logoutSchema>;

export const verifyTwoFactorSchema = z
  .object({
    challengeToken: z.string().min(20).max(4096),
    code: totpCodeSchema.optional(),
    recoveryCode: recoveryCodeSchema.optional(),
    deviceId: deviceIdSchema,
    trustDevice: z.boolean().default(false),
  })
  .refine((value) => Boolean(value.code) !== Boolean(value.recoveryCode), {
    message: 'Provide either an authenticator code or a recovery code',
    path: ['code'],
  });
export type VerifyTwoFactorSchema = z.infer<typeof verifyTwoFactorSchema>;

export const enableTwoFactorSchema = z.object({
  password: z.string().min(1).max(128),
});
export type EnableTwoFactorSchema = z.infer<typeof enableTwoFactorSchema>;

export const confirmTwoFactorSchema = z.object({
  code: totpCodeSchema,
});
export type ConfirmTwoFactorSchema = z.infer<typeof confirmTwoFactorSchema>;

export const disableTwoFactorSchema = z
  .object({
    password: z.string().min(1).max(128),
    code: totpCodeSchema.optional(),
    recoveryCode: recoveryCodeSchema.optional(),
  })
  .refine((value) => Boolean(value.code) || Boolean(value.recoveryCode), {
    message: 'An authenticator or recovery code is required to disable 2FA',
    path: ['code'],
  });
export type DisableTwoFactorSchema = z.infer<typeof disableTwoFactorSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
    revokeOtherSessions: z.boolean().default(true),
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'New password must differ from the current password',
    path: ['newPassword'],
  });
export type ChangePasswordSchema = z.infer<typeof changePasswordSchema>;

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});
export type RequestPasswordResetSchema = z.infer<typeof requestPasswordResetSchema>;

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(20).max(512),
  newPassword: passwordSchema,
});
export type ConfirmPasswordResetSchema = z.infer<typeof confirmPasswordResetSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(20).max(512),
});
export type VerifyEmailSchema = z.infer<typeof verifyEmailSchema>;

export const revokeSessionSchema = z.object({
  sessionId: z.string().uuid(),
});
export type RevokeSessionSchema = z.infer<typeof revokeSessionSchema>;
```

FILE: packages/validation/src/billing.schema.ts

```typescript
import { z } from 'zod';
import {
  basisPointsSchema,
  currencySchema,
  decimalStringSchema,
  paginationQuerySchema,
  plainTextSchema,
  uuidSchema,
} from './primitives';

export const billingIntervalSchema = z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'LIFETIME']);
export const planAudienceSchema = z.enum(['TENANT', 'END_USER']);
export const subscriptionStatusSchema = z.enum([
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'EXPIRED',
  'PAUSED',
]);

export const planLimitsSchema = z.object({
  maxUsers: z.number().int().positive().nullable().default(null),
  maxTraders: z.number().int().positive().nullable().default(null),
  maxFollowersPerTrader: z.number().int().positive().nullable().default(null),
  maxExchangeAccountsPerUser: z.number().int().positive().nullable().default(null),
  maxCopySubscriptionsPerFollower: z.number().int().positive().nullable().default(null),
  maxApiRequestsPerMinute: z.number().int().positive().nullable().default(null),
  websocketConnections: z.number().int().positive().nullable().default(null),
  customDomain: z.boolean().default(false),
  whiteLabelMobileApp: z.boolean().default(false),
  prioritySupport: z.boolean().default(false),
});
export type PlanLimitsSchema = z.infer<typeof planLimitsSchema>;

export const createPlanSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(48)
    .regex(/^[a-z][a-z0-9_-]*$/, 'Plan codes are lowercase kebab or snake case'),
  name: plainTextSchema(120),
  description: plainTextSchema(500).nullable().optional(),
  audience: planAudienceSchema.default('TENANT'),
  price: decimalStringSchema,
  currency: currencySchema.default('USD'),
  interval: billingIntervalSchema.default('MONTHLY'),
  trialDays: z.number().int().min(0).max(365).default(0),
  performanceFeeBps: basisPointsSchema.default(0),
  platformFeeBps: basisPointsSchema.default(0),
  limits: planLimitsSchema,
  features: z.array(plainTextSchema(120)).max(60).default([]),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  tenantId: uuidSchema.nullable().default(null),
});
export type CreatePlanSchema = z.infer<typeof createPlanSchema>;

export const updatePlanSchema = createPlanSchema
  .partial()
  .omit({ code: true })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdatePlanSchema = z.infer<typeof updatePlanSchema>;

export const listPlansQuerySchema = paginationQuerySchema.extend({
  audience: planAudienceSchema.optional(),
  isActive: z.coerce.boolean().optional(),
});
export type ListPlansQuerySchema = z.infer<typeof listPlansQuerySchema>;

export const assignSubscriptionSchema = z.object({
  planId: uuidSchema,
  seatsPurchased: z.number().int().min(1).max(100000).default(1),
  trialDays: z.number().int().min(0).max(365).optional(),
  startImmediately: z.boolean().default(true),
  externalCustomerId: z.string().trim().max(128).optional(),
  externalSubscriptionId: z.string().trim().max(128).optional(),
});
export type AssignSubscriptionSchema = z.infer<typeof assignSubscriptionSchema>;

export const cancelSubscriptionSchema = z.object({
  cancelAtPeriodEnd: z.boolean().default(true),
  reason: plainTextSchema(500).optional(),
});
export type CancelSubscriptionSchema = z.infer<typeof cancelSubscriptionSchema>;
```

FILE: packages/validation/src/index.ts

```typescript
export * from './primitives';
export * from './password.policy';
export * from './auth.schema';
export * from './user.schema';
export * from './tenant.schema';
export * from './rbac.schema';
export * from './billing.schema';
```

FILE: packages/validation/src/password.policy.ts

```typescript
import { z } from 'zod';

/**
 * Password policy. Deliberately stricter than the NIST minimum because these
 * accounts control API keys that can place live trades.
 */
export interface PasswordPolicyOptions {
  minLength: number;
  maxLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
  forbidCommonPasswords: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicyOptions = {
  minLength: 12,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSymbol: true,
  forbidCommonPasswords: true,
};

/**
 * Small embedded deny-list. In production this is complemented by a breached
 * password check (k-anonymity range query) executed inside the auth service.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd',
  '123456789',
  '1234567890',
  'qwertyuiop',
  'letmein123',
  'welcome123',
  'admin12345',
  'iloveyou123',
  'trustno1234',
  'bitcoin123',
  'crypto1234',
  'binance123',
  'copytrade123',
  'changeme123',
  'sunshine123',
  'football123',
  'dragon12345',
]);

export interface PasswordEvaluation {
  valid: boolean;
  errors: string[];
  score: 0 | 1 | 2 | 3 | 4;
}

function hasSequentialRun(value: string, runLength = 4): boolean {
  let ascending = 1;
  let descending = 1;
  for (let index = 1; index < value.length; index += 1) {
    const delta = value.charCodeAt(index) - value.charCodeAt(index - 1);
    ascending = delta === 1 ? ascending + 1 : 1;
    descending = delta === -1 ? descending + 1 : 1;
    if (ascending >= runLength || descending >= runLength) {
      return true;
    }
  }
  return false;
}

function hasRepeatedRun(value: string, runLength = 4): boolean {
  let run = 1;
  for (let index = 1; index < value.length; index += 1) {
    run = value[index] === value[index - 1] ? run + 1 : 1;
    if (run >= runLength) {
      return true;
    }
  }
  return false;
}

export function evaluatePassword(
  password: string,
  policy: PasswordPolicyOptions = DEFAULT_PASSWORD_POLICY,
  context: { email?: string; name?: string } = {},
): PasswordEvaluation {
  const errors: string[] = [];

  if (password.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters long`);
  }
  if (password.length > policy.maxLength) {
    errors.push(`Password must be at most ${policy.maxLength} characters long`);
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (policy.requireDigit && !/\d/.test(password)) {
    errors.push('Password must contain at least one digit');
  }
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one symbol');
  }
  if (policy.forbidCommonPasswords && COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push('This password appears in common password lists');
  }
  if (hasRepeatedRun(password)) {
    errors.push('Password must not contain 4 or more repeated characters');
  }
  if (hasSequentialRun(password)) {
    errors.push('Password must not contain long character sequences such as "abcd" or "1234"');
  }
  if (context.email) {
    const localPart = context.email.split('@')[0]?.toLowerCase();
    if (localPart && localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
      errors.push('Password must not contain your email address');
    }
  }
  if (context.name && context.name.length >= 3) {
    if (password.toLowerCase().includes(context.name.toLowerCase())) {
      errors.push('Password must not contain your name');
    }
  }

  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) =>
    pattern.test(password),
  ).length;
  const lengthScore = password.length >= 20 ? 2 : password.length >= 14 ? 1 : 0;
  const rawScore = Math.min(4, variety - 1 + lengthScore);
  const score = (errors.length > 0 ? Math.min(rawScore, 1) : Math.max(rawScore, 0)) as
    | 0
    | 1
    | 2
    | 3
    | 4;

  return { valid: errors.length === 0, errors, score };
}

export function buildPasswordSchema(
  policy: PasswordPolicyOptions = DEFAULT_PASSWORD_POLICY,
): z.ZodEffects<z.ZodString, string, string> {
  return z
    .string()
    .min(1, 'Password is required')
    .superRefine((value, ctx) => {
      const evaluation = evaluatePassword(value, policy);
      for (const message of evaluation.errors) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      }
    });
}

export const passwordSchema = buildPasswordSchema();
```

FILE: packages/validation/src/primitives.ts

```typescript
import { z } from 'zod';
import { PAGINATION_DEFAULTS, SUPPORTED_CURRENCIES, SUPPORTED_LOCALES } from '@wlct/config';

export const uuidSchema = z.string().uuid('Must be a valid UUID');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, 'Email is too short')
  .max(254, 'Email is too long')
  .email('Must be a valid email address');

/** E.164 phone numbers only, which keeps SMS/2FA providers happy. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Phone must be in E.164 format, e.g. +8801712345678');

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Slug must be at least 3 characters')
  .max(63, 'Slug must be at most 63 characters')
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Slug may contain lowercase letters, digits and hyphens')
  .refine((value) => !value.includes('--'), 'Slug may not contain consecutive hyphens')
  .refine(
    (value) =>
      ![
        'www',
        'api',
        'admin',
        'app',
        'auth',
        'static',
        'assets',
        'cdn',
        'mail',
        'support',
        'status',
        'docs',
      ].includes(value),
    'This slug is reserved',
  );

export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
    'Must be a valid fully qualified domain name',
  );

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Must be a hex color, e.g. #1B2A4A');

export const urlSchema = z.string().trim().url('Must be a valid URL').max(2048);

export const localeSchema = z.enum(SUPPORTED_LOCALES);

export const currencySchema = z.enum(SUPPORTED_CURRENCIES);

export const timezoneSchema = z
  .string()
  .trim()
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Must be a valid IANA timezone, e.g. Asia/Dhaka');

export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(2, 'Must be a 2-letter ISO 3166-1 alpha-2 country code');

export const deviceIdSchema = z
  .string()
  .trim()
  .min(8, 'Device id is too short')
  .max(128, 'Device id is too long')
  .regex(/^[A-Za-z0-9._:-]+$/, 'Device id contains unsupported characters');

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6,8}$/, 'Authenticator code must be 6-8 digits');

export const recoveryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'Recovery code format is XXXX-XXXX-XXXX');

export const basisPointsSchema = z
  .number()
  .int('Basis points must be an integer')
  .min(0, 'Basis points cannot be negative')
  .max(10000, 'Basis points cannot exceed 10000 (100%)');

export const decimalStringSchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,18}(\.\d{1,18})?$/, 'Must be a decimal number');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION_DEFAULTS.PAGE),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION_DEFAULTS.MAX_LIMIT)
    .default(PAGINATION_DEFAULTS.LIMIT),
  sortBy: z.string().trim().max(64).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(128).optional(),
});

export type PaginationQueryInput = z.infer<typeof paginationQuerySchema>;

/** Rejects strings containing HTML tags or script-ish payloads. */
export const plainTextSchema = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !/<[^>]*>/.test(value), 'HTML markup is not allowed')
    .refine((value) => !/javascript:/i.test(value), 'Unsafe content is not allowed');
```

FILE: packages/validation/src/rbac.schema.ts

```typescript
import { z } from 'zod';
import { paginationQuerySchema, plainTextSchema, uuidSchema } from './primitives';

export const roleScopeSchema = z.enum(['PLATFORM', 'TENANT']);

export const permissionKeySchema = z
  .string()
  .trim()
  .max(64)
  .regex(/^(\*|[a-z][a-z0-9_]*:(\*|[a-z][a-z0-9_]*))$/, 'Permissions use the "resource:action" form');

export const createRoleSchema = z.object({
  key: z
    .string()
    .trim()
    .toUpperCase()
    .min(3)
    .max(64)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Role keys are UPPER_SNAKE_CASE'),
  name: plainTextSchema(120),
  description: plainTextSchema(500).nullable().optional(),
  scope: roleScopeSchema.default('TENANT'),
  permissionKeys: z.array(permissionKeySchema).min(1).max(200),
});
export type CreateRoleSchema = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z
  .object({
    name: plainTextSchema(120).optional(),
    description: plainTextSchema(500).nullable().optional(),
    permissionKeys: z.array(permissionKeySchema).min(1).max(200).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateRoleSchema = z.infer<typeof updateRoleSchema>;

export const listRolesQuerySchema = paginationQuerySchema.extend({
  scope: roleScopeSchema.optional(),
  includeSystem: z.coerce.boolean().default(true),
});
export type ListRolesQuerySchema = z.infer<typeof listRolesQuerySchema>;

export const revokeRoleSchema = z.object({
  roleId: uuidSchema,
});
export type RevokeRoleSchema = z.infer<typeof revokeRoleSchema>;
```

FILE: packages/validation/src/tenant.schema.ts

```typescript
import { z } from 'zod';
import {
  basisPointsSchema,
  countryCodeSchema,
  currencySchema,
  domainSchema,
  emailSchema,
  hexColorSchema,
  localeSchema,
  paginationQuerySchema,
  phoneSchema,
  plainTextSchema,
  slugSchema,
  timezoneSchema,
  urlSchema,
  uuidSchema,
} from './primitives';
import { passwordSchema } from './password.policy';

export const tenantStatusSchema = z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED']);

export const brandingSchema = z.object({
  appName: plainTextSchema(64),
  logoUrl: urlSchema.nullable().optional(),
  logoDarkUrl: urlSchema.nullable().optional(),
  faviconUrl: urlSchema.nullable().optional(),
  primaryColor: hexColorSchema.default('#1B2A4A'),
  secondaryColor: hexColorSchema.default('#0F172A'),
  accentColor: hexColorSchema.default('#22C55E'),
  backgroundColor: hexColorSchema.default('#FFFFFF'),
  textColor: hexColorSchema.default('#0B1220'),
  fontFamily: plainTextSchema(64).default('Inter'),
  themeMode: z.enum(['light', 'dark', 'system']).default('system'),
  supportEmail: emailSchema.nullable().optional(),
  supportUrl: urlSchema.nullable().optional(),
  termsUrl: urlSchema.nullable().optional(),
  privacyUrl: urlSchema.nullable().optional(),
  /** Custom CSS is sanitised server-side before it is served to browsers. */
  customCss: z.string().max(20000).nullable().optional(),
  socialLinks: z.record(z.string().max(32), urlSchema).default({}),
});
export type BrandingSchema = z.infer<typeof brandingSchema>;

export const updateBrandingSchema = brandingSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one branding field must be provided' },
);
export type UpdateBrandingSchema = z.infer<typeof updateBrandingSchema>;

export const createTenantSchema = z.object({
  slug: slugSchema,
  name: plainTextSchema(120),
  legalName: plainTextSchema(160).optional(),
  contactEmail: emailSchema,
  contactPhone: phoneSchema.optional(),
  countryCode: countryCodeSchema.optional(),
  defaultLocale: localeSchema.default('en'),
  supportedLocales: z.array(localeSchema).min(1).default(['en']),
  defaultCurrency: currencySchema.default('USD'),
  supportedCurrencies: z.array(currencySchema).min(1).default(['USD']),
  timezone: timezoneSchema.default('UTC'),
  platformFeeBps: basisPointsSchema.default(0),
  performanceFeeBps: basisPointsSchema.default(2000),
  maxUsers: z.number().int().positive().max(1_000_000).nullable().default(null),
  maxTraders: z.number().int().positive().max(100_000).nullable().default(null),
  planId: uuidSchema.optional(),
  branding: brandingSchema.partial().optional(),
  owner: z
    .object({
      email: emailSchema,
      password: passwordSchema,
      firstName: plainTextSchema(64).optional(),
      lastName: plainTextSchema(64).optional(),
    })
    .optional(),
});
export type CreateTenantSchema = z.infer<typeof createTenantSchema>;

export const updateTenantSchema = z
  .object({
    name: plainTextSchema(120).optional(),
    legalName: plainTextSchema(160).nullable().optional(),
    contactEmail: emailSchema.optional(),
    contactPhone: phoneSchema.nullable().optional(),
    countryCode: countryCodeSchema.nullable().optional(),
    defaultLocale: localeSchema.optional(),
    supportedLocales: z.array(localeSchema).min(1).optional(),
    defaultCurrency: currencySchema.optional(),
    supportedCurrencies: z.array(currencySchema).min(1).optional(),
    timezone: timezoneSchema.optional(),
    platformFeeBps: basisPointsSchema.optional(),
    performanceFeeBps: basisPointsSchema.optional(),
    maxUsers: z.number().int().positive().max(1_000_000).nullable().optional(),
    maxTraders: z.number().int().positive().max(100_000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateTenantSchema = z.infer<typeof updateTenantSchema>;

export const updateTenantStatusSchema = z.object({
  status: tenantStatusSchema,
  reason: plainTextSchema(500).optional(),
});
export type UpdateTenantStatusSchema = z.infer<typeof updateTenantStatusSchema>;

export const listTenantsQuerySchema = paginationQuerySchema.extend({
  status: tenantStatusSchema.optional(),
  includeDeleted: z.coerce.boolean().default(false),
});
export type ListTenantsQuerySchema = z.infer<typeof listTenantsQuerySchema>;

export const tenantSettingSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z][a-z0-9_.]*$/, 'Setting keys are lowercase dot/underscore separated'),
  value: z.unknown(),
  category: z.string().trim().min(2).max(32).default('general'),
  description: plainTextSchema(240).nullable().optional(),
});
export type TenantSettingSchema = z.infer<typeof tenantSettingSchema>;

export const upsertTenantSettingsSchema = z.object({
  settings: z.array(tenantSettingSchema).min(1).max(50),
});
export type UpsertTenantSettingsSchema = z.infer<typeof upsertTenantSettingsSchema>;

export const createTenantDomainSchema = z.object({
  domain: domainSchema,
  isPrimary: z.boolean().default(false),
});
export type CreateTenantDomainSchema = z.infer<typeof createTenantDomainSchema>;

export const toggleFeatureFlagSchema = z.object({
  enabled: z.boolean(),
  rolloutPercentage: z.number().int().min(0).max(100).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type ToggleFeatureFlagSchema = z.infer<typeof toggleFeatureFlagSchema>;

export const createFeatureFlagSchema = z.object({
  key: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'Feature flag keys are lowercase snake_case'),
  name: plainTextSchema(120),
  description: plainTextSchema(500).nullable().optional(),
  isGlobalDefault: z.boolean().default(false),
  rolloutPercentage: z.number().int().min(0).max(100).default(100),
});
export type CreateFeatureFlagSchema = z.infer<typeof createFeatureFlagSchema>;
```

FILE: packages/validation/src/user.schema.ts

```typescript
import { z } from 'zod';
import {
  countryCodeSchema,
  currencySchema,
  emailSchema,
  localeSchema,
  paginationQuerySchema,
  phoneSchema,
  plainTextSchema,
  timezoneSchema,
  urlSchema,
  uuidSchema,
} from './primitives';
import { passwordSchema } from './password.policy';

export const userStatusSchema = z.enum([
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'LOCKED',
  'DEACTIVATED',
]);

export const kycStatusSchema = z.enum([
  'NOT_STARTED',
  'PENDING',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
]);

export const createUserSchema = z.object({
  email: emailSchema,
  password: passwordSchema.optional(),
  firstName: plainTextSchema(64).optional(),
  lastName: plainTextSchema(64).optional(),
  phone: phoneSchema.optional(),
  locale: localeSchema.optional(),
  preferredCurrency: currencySchema.optional(),
  countryCode: countryCodeSchema.optional(),
  timezone: timezoneSchema.optional(),
  roleKeys: z.array(z.string().trim().min(2).max(64)).max(10).default([]),
  sendInvite: z.boolean().default(true),
});
export type CreateUserSchema = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    firstName: plainTextSchema(64).optional(),
    lastName: plainTextSchema(64).optional(),
    displayName: plainTextSchema(64).optional(),
    phone: phoneSchema.nullable().optional(),
    avatarUrl: urlSchema.nullable().optional(),
    bio: plainTextSchema(500).nullable().optional(),
    countryCode: countryCodeSchema.nullable().optional(),
    timezone: timezoneSchema.optional(),
    locale: localeSchema.optional(),
    preferredCurrency: currencySchema.optional(),
    marketingOptIn: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateUserSchema = z.infer<typeof updateUserSchema>;

export const adminUpdateUserSchema = updateUserSchema.innerType().extend({
  status: userStatusSchema.optional(),
  emailVerified: z.boolean().optional(),
});
export type AdminUpdateUserSchema = z.infer<typeof adminUpdateUserSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  status: userStatusSchema.optional(),
  kycStatus: kycStatusSchema.optional(),
  roleKey: z.string().trim().max(64).optional(),
  tenantId: uuidSchema.optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  includeDeleted: z.coerce.boolean().default(false),
});
export type ListUsersQuerySchema = z.infer<typeof listUsersQuerySchema>;

export const suspendUserSchema = z.object({
  reason: plainTextSchema(500),
  notifyUser: z.boolean().default(true),
});
export type SuspendUserSchema = z.infer<typeof suspendUserSchema>;

export const assignRolesSchema = z.object({
  roleIds: z.array(uuidSchema).min(1, 'At least one role is required').max(10),
  expiresAt: z.coerce.date().optional(),
});
export type AssignRolesSchema = z.infer<typeof assignRolesSchema>;
```

FILE: packages/validation/tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

