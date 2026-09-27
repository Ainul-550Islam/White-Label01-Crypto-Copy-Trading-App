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
