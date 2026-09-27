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
