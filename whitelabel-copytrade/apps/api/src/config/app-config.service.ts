import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv, NodeEnvironment } from '@wlct/config';
import { parseDurationToMs, parseDurationToSeconds } from '@wlct/utils';

export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  db: number;
  tls?: Record<string, never>;
  keyPrefix: string;
  maxRetriesPerRequest: number | null;
  enableReadyCheck: boolean;
}

/**
 * Typed, memoised accessor over the validated environment.
 *
 * Every consumer depends on this class instead of `ConfigService.get(...)`,
 * which removes stringly-typed lookups and gives a single place to derive
 * computed values (durations in ms, Redis connection objects, CORS validators).
 */
@Injectable()
export class AppConfigService {
  private readonly env: AppEnv;

  constructor(private readonly configService: ConfigService) {
    // `validate()` in AppConfigModule has already coerced and checked every
    // variable, so reads go through ConfigService to pick up the parsed values
    // (numbers, booleans, arrays) rather than the raw strings in process.env.
    this.env = new Proxy({} as AppEnv, {
      get: (_target, property: string | symbol) =>
        typeof property === 'string' ? this.configService.get(property) : undefined,
    }) as AppEnv;
  }

  // ---------------------------------------------------------------------------
  // Application
  // ---------------------------------------------------------------------------

  get nodeEnv(): NodeEnvironment {
    return this.env.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isDevelopment(): boolean {
    return this.env.NODE_ENV === 'development';
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }

  get appName(): string {
    return this.env.APP_NAME;
  }

  get port(): number {
    return this.env.API_PORT;
  }

  get host(): string {
    return this.env.API_HOST;
  }

  get globalPrefix(): string {
    return this.env.API_GLOBAL_PREFIX;
  }

  get defaultApiVersion(): string {
    return this.env.API_DEFAULT_VERSION;
  }

  get publicUrl(): string {
    return this.env.API_PUBLIC_URL;
  }

  get adminWebUrl(): string {
    return this.env.ADMIN_WEB_URL;
  }

  get trustProxyHops(): number {
    return this.env.TRUST_PROXY_HOPS;
  }

  get platformRootDomain(): string {
    return this.env.PLATFORM_ROOT_DOMAIN;
  }

  get defaultTenantSlug(): string {
    return this.env.DEFAULT_TENANT_SLUG;
  }

  // ---------------------------------------------------------------------------
  // Database
  // ---------------------------------------------------------------------------

  get databaseUrl(): string {
    return this.env.DATABASE_URL;
  }

  get databaseLogQueries(): boolean {
    return this.env.DATABASE_LOG_QUERIES;
  }

  // ---------------------------------------------------------------------------
  // Redis
  // ---------------------------------------------------------------------------

  get redisOptions(): RedisConnectionOptions {
    return {
      host: this.env.REDIS_HOST,
      port: this.env.REDIS_PORT,
      password: this.env.REDIS_PASSWORD || undefined,
      db: this.env.REDIS_DB,
      tls: this.env.REDIS_TLS ? {} : undefined,
      keyPrefix: this.env.REDIS_KEY_PREFIX,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    };
  }

  /**
   * BullMQ requires `maxRetriesPerRequest: null` and no key prefix collisions.
   *
   * The prefix is stripped by rebuilding the object rather than by destructuring
   * it away: an unused binding is dead weight the linter is right to flag, and
   * naming the retained fields makes it obvious that dropping `keyPrefix` is the
   * whole point of the method.
   */
  get queueRedisOptions(): Omit<RedisConnectionOptions, 'keyPrefix'> {
    const options = this.redisOptions;
    return {
      host: options.host,
      port: options.port,
      password: options.password,
      db: options.db,
      tls: options.tls,
      maxRetriesPerRequest: options.maxRetriesPerRequest,
      enableReadyCheck: options.enableReadyCheck,
    };
  }

  get redisKeyPrefix(): string {
    return this.env.REDIS_KEY_PREFIX;
  }

  // ---------------------------------------------------------------------------
  // JWT
  // ---------------------------------------------------------------------------

  get jwtAlgorithm(): AppEnv['JWT_ALGORITHM'] {
    return this.env.JWT_ALGORITHM;
  }

  get jwtUsesAsymmetricKeys(): boolean {
    return this.env.JWT_ALGORITHM.startsWith('RS');
  }

  get jwtAccessSigningKey(): string {
    if (this.jwtUsesAsymmetricKeys) {
      return Buffer.from(this.env.JWT_PRIVATE_KEY_BASE64 ?? '', 'base64').toString('utf8');
    }
    return this.env.JWT_ACCESS_SECRET ?? '';
  }

  get jwtAccessVerificationKey(): string {
    if (this.jwtUsesAsymmetricKeys) {
      return Buffer.from(this.env.JWT_PUBLIC_KEY_BASE64 ?? '', 'base64').toString('utf8');
    }
    return this.env.JWT_ACCESS_SECRET ?? '';
  }

  get jwtRefreshSigningKey(): string {
    if (this.jwtUsesAsymmetricKeys) {
      return Buffer.from(this.env.JWT_PRIVATE_KEY_BASE64 ?? '', 'base64').toString('utf8');
    }
    return this.env.JWT_REFRESH_SECRET ?? '';
  }

  get jwtRefreshVerificationKey(): string {
    if (this.jwtUsesAsymmetricKeys) {
      return Buffer.from(this.env.JWT_PUBLIC_KEY_BASE64 ?? '', 'base64').toString('utf8');
    }
    return this.env.JWT_REFRESH_SECRET ?? '';
  }

  get accessTokenTtl(): string {
    return this.env.JWT_ACCESS_TTL;
  }

  get accessTokenTtlSeconds(): number {
    return parseDurationToSeconds(this.env.JWT_ACCESS_TTL);
  }

  get refreshTokenTtl(): string {
    return this.env.JWT_REFRESH_TTL;
  }

  get refreshTokenTtlSeconds(): number {
    return parseDurationToSeconds(this.env.JWT_REFRESH_TTL);
  }

  get refreshTokenTtlMs(): number {
    return parseDurationToMs(this.env.JWT_REFRESH_TTL);
  }

  get jwtIssuer(): string {
    return this.env.JWT_ISSUER;
  }

  get jwtAudience(): string {
    return this.env.JWT_AUDIENCE;
  }

  get maxActiveSessionsPerUser(): number {
    return this.env.MAX_ACTIVE_SESSIONS_PER_USER;
  }

  // ---------------------------------------------------------------------------
  // Password & account protection
  // ---------------------------------------------------------------------------

  get passwordMinLength(): number {
    return this.env.PASSWORD_MIN_LENGTH;
  }

  get argon2Options(): { memoryCost: number; timeCost: number; parallelism: number } {
    return {
      memoryCost: this.env.ARGON2_MEMORY_COST,
      timeCost: this.env.ARGON2_TIME_COST,
      parallelism: this.env.ARGON2_PARALLELISM,
    };
  }

  get loginMaxFailedAttempts(): number {
    return this.env.LOGIN_MAX_FAILED_ATTEMPTS;
  }

  get loginFailedWindowSeconds(): number {
    return this.env.LOGIN_FAILED_WINDOW_SECONDS;
  }

  get accountLockoutSeconds(): number {
    return this.env.ACCOUNT_LOCKOUT_SECONDS;
  }

  // ---------------------------------------------------------------------------
  // Encryption
  // ---------------------------------------------------------------------------

  get encryptionMasterKeyBase64(): string {
    return this.env.ENCRYPTION_MASTER_KEY_BASE64;
  }

  get encryptionKeyId(): string {
    return this.env.ENCRYPTION_KEY_ID;
  }

  get encryptionPreviousKeys(): Record<string, string> {
    return this.env.ENCRYPTION_PREVIOUS_KEYS_JSON ?? {};
  }

  get encryptionProvider(): 'local' | 'kms' {
    return this.env.ENCRYPTION_PROVIDER;
  }

  get blindIndexKeyBase64(): string {
    return this.env.BLIND_INDEX_KEY_BASE64;
  }

  // ---------------------------------------------------------------------------
  // Two factor
  // ---------------------------------------------------------------------------

  get twoFactorIssuer(): string {
    return this.env.TWO_FACTOR_ISSUER;
  }

  get twoFactorWindow(): number {
    return this.env.TWO_FACTOR_WINDOW;
  }

  get twoFactorDigits(): number {
    return this.env.TWO_FACTOR_DIGITS;
  }

  get twoFactorPeriod(): number {
    return this.env.TWO_FACTOR_PERIOD;
  }

  get twoFactorRecoveryCodeCount(): number {
    return this.env.TWO_FACTOR_RECOVERY_CODES;
  }

  get twoFactorChallengeTtl(): string {
    return this.env.TWO_FACTOR_CHALLENGE_TTL;
  }

  get twoFactorChallengeTtlSeconds(): number {
    return parseDurationToSeconds(this.env.TWO_FACTOR_CHALLENGE_TTL);
  }

  get twoFactorMaxChallengeAttempts(): number {
    return this.env.TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS;
  }

  // ---------------------------------------------------------------------------
  // CORS
  // ---------------------------------------------------------------------------

  get corsEnabled(): boolean {
    return this.env.CORS_ENABLED;
  }

  get corsOrigins(): string[] {
    return this.env.CORS_ORIGINS;
  }

  get corsCredentials(): boolean {
    return this.env.CORS_CREDENTIALS;
  }

  get corsAllowedHeaders(): string[] {
    return this.env.CORS_ALLOWED_HEADERS;
  }

  get corsExposedHeaders(): string[] {
    return this.env.CORS_EXPOSED_HEADERS;
  }

  /**
   * Allows configured origins plus any tenant custom domain that resolves under
   * the platform root domain. Unknown origins are rejected rather than echoed.
   */
  get corsOriginValidator(): (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void,
  ) => void {
    const allowList = new Set(this.corsOrigins);
    const rootDomain = this.platformRootDomain;
    const allowAnyInDev = !this.isProduction;

    return (origin, callback) => {
      if (!origin) {
        // Same-origin, curl, and mobile apps send no Origin header.
        callback(null, true);
        return;
      }
      if (allowList.has(origin)) {
        callback(null, true);
        return;
      }
      try {
        const { hostname, protocol } = new URL(origin);
        if (protocol === 'https:' && (hostname === rootDomain || hostname.endsWith(`.${rootDomain}`))) {
          callback(null, true);
          return;
        }
        if (allowAnyInDev && (hostname === 'localhost' || hostname === '127.0.0.1')) {
          callback(null, true);
          return;
        }
      } catch {
        callback(null, false);
        return;
      }
      callback(null, false);
    };
  }

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------

  get rateLimitEnabled(): boolean {
    return this.env.RATE_LIMIT_ENABLED;
  }

  get rateLimitTtlSeconds(): number {
    return this.env.RATE_LIMIT_TTL_SECONDS;
  }

  get rateLimitMax(): number {
    return this.env.RATE_LIMIT_MAX;
  }

  get rateLimitAuthTtlSeconds(): number {
    return this.env.RATE_LIMIT_AUTH_TTL_SECONDS;
  }

  get rateLimitAuthMax(): number {
    return this.env.RATE_LIMIT_AUTH_MAX;
  }

  get rateLimitTrustedIps(): string[] {
    return this.env.RATE_LIMIT_TRUSTED_IPS;
  }

  // ---------------------------------------------------------------------------
  // Swagger
  // ---------------------------------------------------------------------------

  get swaggerEnabled(): boolean {
    return this.env.SWAGGER_ENABLED;
  }

  get swaggerPath(): string {
    return this.env.SWAGGER_PATH;
  }

  get swaggerTitle(): string {
    return this.env.SWAGGER_TITLE;
  }

  get swaggerDescription(): string {
    return this.env.SWAGGER_DESCRIPTION;
  }

  get swaggerVersion(): string {
    return this.env.SWAGGER_VERSION;
  }

  get swaggerCredentials(): { user?: string; password?: string } {
    return { user: this.env.SWAGGER_USER, password: this.env.SWAGGER_PASSWORD };
  }

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------

  get logLevel(): AppEnv['LOG_LEVEL'] {
    return this.env.LOG_LEVEL;
  }

  get logFormat(): 'json' | 'pretty' {
    return this.env.LOG_FORMAT;
  }

  get logRequestBody(): boolean {
    return this.env.LOG_REQUEST_BODY;
  }

  // ---------------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------------

  get wsEnabled(): boolean {
    return this.env.WS_ENABLED;
  }

  get wsPath(): string {
    return this.env.WS_PATH;
  }

  get wsNamespace(): string {
    return this.env.WS_NAMESPACE;
  }

  get wsPingIntervalMs(): number {
    return this.env.WS_PING_INTERVAL_MS;
  }

  get wsPingTimeoutMs(): number {
    return this.env.WS_PING_TIMEOUT_MS;
  }

  get wsMaxConnectionsPerUser(): number {
    return this.env.WS_MAX_CONNECTIONS_PER_USER;
  }

  get wsRedisAdapterEnabled(): boolean {
    return this.env.WS_REDIS_ADAPTER;
  }

  // ---------------------------------------------------------------------------
  // Queues
  // ---------------------------------------------------------------------------

  get queuePrefix(): string {
    return this.env.QUEUE_PREFIX;
  }

  get queueDefaultAttempts(): number {
    return this.env.QUEUE_DEFAULT_ATTEMPTS;
  }

  get queueBackoffMs(): number {
    return this.env.QUEUE_BACKOFF_MS;
  }

  get queueRemoveOnComplete(): number {
    return this.env.QUEUE_REMOVE_ON_COMPLETE;
  }

  get queueRemoveOnFail(): number {
    return this.env.QUEUE_REMOVE_ON_FAIL;
  }

  get queueConcurrency(): number {
    return this.env.QUEUE_CONCURRENCY;
  }

  get queueRunInlineWorkers(): boolean {
    return this.env.QUEUE_RUN_INLINE_WORKERS;
  }

  // ---------------------------------------------------------------------------
  // Part 11: trading-worker plane + read-replica policy
  // ---------------------------------------------------------------------------

  get workerEnabled(): boolean {
    return this.env.WORKER_ENABLED;
  }

  private workerIdMemo: string | null = null;

  /** Composed identity when not configured; set WORKER_ID per replica in the
   * deployment so a restart reclaims its own partition claims.
   *
   * MEMOIZED on purpose: the composition contains a fresh UUID, and several
   * consumers compare this id across calls (claim value round-trips, the
   * registry self-check "did my ping list ME"). A getter that returned a
   * new identity per read would make every such comparison false - the
   * worker would never see itself in its own fleet. Within one process the
   * identity is a constant; across restarts it is not. */
  get workerId(): string {
    if (this.workerIdMemo !== null) {
      return this.workerIdMemo;
    }
    const configured = this.env.WORKER_ID;
    const composed =
      configured !== undefined && configured.length > 0
        ? configured
        : `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
    this.workerIdMemo = composed;
    return composed;
  }

  /** Config-declared fleet membership for the partition assignment; empty
   * means this single worker. Ordering is irrelevant by construction (the
   * assignment math sorts). */
  get workerMembership(): string[] {
    const raw = this.env.WORKER_MEMBERSHIP;
    const listed = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return listed.length > 0 ? listed : [this.workerId];
  }

  /** Which source drives live membership: config-declared list (Part 11)
   * or the Redis self-registration registry (Part 12). Read defensively:
   * the schema enum is the gate, and anything unrecognised boots as
   * 'config' - the pre-Part-12 behaviour - rather than throwing from a
   * hot getter the coordination loop cannot survive. */
  get workerMembershipMode(): 'config' | 'registry' {
    return this.env.WORKER_MEMBERSHIP_MODE === 'registry' ? 'registry' : 'config';
  }

  get workerMembershipTtlMs(): number {
    return this.env.WORKER_MEMBERSHIP_TTL_MS;
  }

  get workerPartitionCount(): number {
    return this.env.WORKER_PARTITION_COUNT;
  }

  get workerPartitionLeaseTtlMs(): number {
    return this.env.WORKER_PARTITION_LEASE_TTL_MS;
  }

  get workerPartitionRetryMs(): number {
    return this.env.WORKER_PARTITION_RETRY_MS;
  }

  get workerDeferDelayMs(): number {
    return this.env.WORKER_DEFER_DELAY_MS;
  }

  get workerMaxDefers(): number {
    return this.env.WORKER_MAX_DEFERS;
  }

  get workerShutdownTimeoutMs(): number {
    return this.env.WORKER_SHUTDOWN_TIMEOUT_MS;
  }

  get executionEngineUrl(): string {
    return this.env.EXECUTION_ENGINE_URL;
  }

  /** Secret: readable only where it is needed, never logged, never echoed
   * into a response - the same discipline as every token on this service. */
  get executionEngineToken(): string | undefined {
    return this.env.EXECUTION_ENGINE_TOKEN;
  }

  get databaseReadEnabled(): boolean {
    return this.env.DATABASE_READ_ENABLED;
  }

  get databaseReadUrl(): string | undefined {
    return this.env.DATABASE_READ_URL;
  }

  get databaseReadMaxLagMs(): number {
    return this.env.DATABASE_READ_MAX_LAG_MS;
  }

  // ---------------------------------------------------------------------------
  // Exchanges and internal services
  // ---------------------------------------------------------------------------

  get enabledExchanges(): string[] {
    return this.env.EXCHANGES_ENABLED;
  }

  get exchangeSandboxMode(): boolean {
    return this.env.EXCHANGE_SANDBOX_MODE;
  }

  get executionEnabled(): boolean {
    return this.env.EXECUTION_ENABLED;
  }

  // ---------------------------------------------------------------------------
  // Authenticated execution (Part 5)
  // ---------------------------------------------------------------------------
  // Note what is absent: there is no getter returning BINANCE_API_SECRET, or
  // any other raw credential. The API process never needs one. Credentials are
  // resolved inside the trading service's credential provider, and the only
  // thing this class exposes about them is whether a platform-level pair was
  // configured at all.

  get liveTradingEnabled(): boolean {
    return this.env.LIVE_TRADING_ENABLED;
  }

  get dryRun(): boolean {
    return this.env.DRY_RUN;
  }

  get paperTrading(): boolean {
    return this.env.PAPER_TRADING;
  }

  /**
   * The effective trading mode after all switches are combined.
   *
   * Resolution is deliberately pessimistic and the order of the checks is the
   * whole point: DRY_RUN wins over everything, then PAPER, and LIVE is only
   * reached when every switch explicitly permits it. There is no path through
   * this function where an unset variable produces LIVE.
   */
  get tradingMode(): 'DISABLED' | 'DRY_RUN' | 'PAPER' | 'LIVE' {
    if (!this.env.EXECUTION_ENABLED) {
      return 'DISABLED';
    }
    if (this.env.DRY_RUN) {
      return 'DRY_RUN';
    }
    if (this.env.PAPER_TRADING) {
      return 'PAPER';
    }
    if (this.env.LIVE_TRADING_ENABLED) {
      return 'LIVE';
    }
    return 'DISABLED';
  }

  /** True when a platform-level venue credential pair is configured. */
  get hasPlatformExchangeCredentials(): boolean {
    return Boolean(this.env.BINANCE_API_KEY) && Boolean(this.env.BINANCE_API_SECRET);
  }

  get orderRequestTimeoutMs(): number {
    return this.env.ORDER_REQUEST_TIMEOUT_MS;
  }

  get orderReconciliationIntervalMs(): number {
    return this.env.ORDER_RECONCILIATION_INTERVAL_MS;
  }

  get privateStreamReconnectEnabled(): boolean {
    return this.env.PRIVATE_STREAM_RECONNECT_ENABLED;
  }

  get exchangeTimeSyncIntervalMs(): number {
    return this.env.EXCHANGE_TIME_SYNC_INTERVAL_MS;
  }

  get executionIdempotencyTtlSeconds(): number {
    return this.env.EXECUTION_IDEMPOTENCY_TTL_SECONDS;
  }

  get orderUnknownReconciliationDelayMs(): number {
    return this.env.ORDER_UNKNOWN_RECONCILIATION_DELAY_MS;
  }

  /**
   * Everything the admin UI is allowed to know about execution configuration.
   * Booleans and durations only - assembled explicitly rather than by spreading
   * the env object, so a credential can never be added to the response by
   * accident later.
   */
  get executionSafetySummary(): {
    executionEnabled: boolean;
    tradingMode: 'DISABLED' | 'DRY_RUN' | 'PAPER' | 'LIVE';
    liveTradingEnabled: boolean;
    dryRun: boolean;
    paperTrading: boolean;
    sandboxMode: boolean;
    platformCredentialsConfigured: boolean;
    orderRequestTimeoutMs: number;
    orderReconciliationIntervalMs: number;
    orderUnknownReconciliationDelayMs: number;
    exchangeTimeSyncIntervalMs: number;
    executionIdempotencyTtlSeconds: number;
    privateStreamReconnectEnabled: boolean;
  } {
    return {
      executionEnabled: this.executionEnabled,
      tradingMode: this.tradingMode,
      liveTradingEnabled: this.liveTradingEnabled,
      dryRun: this.dryRun,
      paperTrading: this.paperTrading,
      sandboxMode: this.exchangeSandboxMode,
      platformCredentialsConfigured: this.hasPlatformExchangeCredentials,
      orderRequestTimeoutMs: this.orderRequestTimeoutMs,
      orderReconciliationIntervalMs: this.orderReconciliationIntervalMs,
      orderUnknownReconciliationDelayMs: this.orderUnknownReconciliationDelayMs,
      exchangeTimeSyncIntervalMs: this.exchangeTimeSyncIntervalMs,
      executionIdempotencyTtlSeconds: this.executionIdempotencyTtlSeconds,
      privateStreamReconnectEnabled: this.privateStreamReconnectEnabled,
    };
  }

  // ---------------------------------------------------------------------------
  // Strategy engine, paper trading and backtesting (Part 6)
  // ---------------------------------------------------------------------------
  // None of these getters can enable live trading. `strategyEngineEnabled`
  // says whether strategies run; where their signals may go is still decided
  // by `tradingMode` above, which is unchanged by anything in this section.

  get strategyEngineEnabled(): boolean {
    return this.env.STRATEGY_ENGINE_ENABLED;
  }

  get paperTradingEnabled(): boolean {
    return this.env.PAPER_TRADING_ENABLED;
  }

  get backtestEnabled(): boolean {
    return this.env.BACKTEST_ENABLED;
  }

  get strategyEventQueueSize(): number {
    return this.env.STRATEGY_EVENT_QUEUE_SIZE;
  }

  get strategyMaxInstances(): number {
    return this.env.STRATEGY_MAX_INSTANCES;
  }

  /**
   * Observation budget for one strategy dispatch, in milliseconds.
   *
   * Exceeding it increments a counter and marks the dispatch slow. It is not
   * a guarantee, and this platform makes no latency guarantee of any kind.
   */
  get strategyMaxProcessingLatencyMs(): number {
    return this.env.STRATEGY_MAX_PROCESSING_LATENCY_MS;
  }

  get signalMaxAgeMs(): number {
    return this.env.SIGNAL_MAX_AGE_MS;
  }

  get signalDedupTtlSeconds(): number {
    return this.env.SIGNAL_DEDUP_TTL_SECONDS;
  }

  /**
   * Default backtest execution assumptions.
   *
   * Returned as strings, not numbers: they are exact decimals that end up in
   * Decimal arithmetic and in the configuration hash of every run, and a
   * binary float would corrupt both.
   */
  get backtestDefaults(): {
    initialCapital: string;
    makerFee: string;
    takerFee: string;
    slippageBps: string;
  } {
    return {
      initialCapital: this.env.BACKTEST_DEFAULT_INITIAL_CAPITAL,
      makerFee: this.env.BACKTEST_DEFAULT_MAKER_FEE,
      takerFee: this.env.BACKTEST_DEFAULT_TAKER_FEE,
      slippageBps: this.env.BACKTEST_DEFAULT_SLIPPAGE_BPS,
    };
  }

  /**
   * Everything the admin UI may know about the strategy layer.
   *
   * Assembled field by field for the same reason as
   * {@link executionSafetySummary}: nothing is spread in, so a credential can
   * never arrive here by accident. `liveExecutionReachable` is stated
   * explicitly so an operator can see at a glance that enabling strategies did
   * not enable live orders.
   */
  get strategySafetySummary(): {
    strategyEngineEnabled: boolean;
    paperTradingEnabled: boolean;
    backtestEnabled: boolean;
    liveExecutionReachable: boolean;
    tradingMode: 'DISABLED' | 'DRY_RUN' | 'PAPER' | 'LIVE';
    maxInstances: number;
    eventQueueSize: number;
    maxProcessingLatencyMs: number;
    signalMaxAgeMs: number;
    signalDedupTtlSeconds: number;
    backtestDefaults: {
      initialCapital: string;
      makerFee: string;
      takerFee: string;
      slippageBps: string;
    };
    disclaimer: string;
  } {
    return {
      strategyEngineEnabled: this.strategyEngineEnabled,
      paperTradingEnabled: this.paperTradingEnabled,
      backtestEnabled: this.backtestEnabled,
      liveExecutionReachable: this.tradingMode === 'LIVE',
      tradingMode: this.tradingMode,
      maxInstances: this.strategyMaxInstances,
      eventQueueSize: this.strategyEventQueueSize,
      maxProcessingLatencyMs: this.strategyMaxProcessingLatencyMs,
      signalMaxAgeMs: this.signalMaxAgeMs,
      signalDedupTtlSeconds: this.signalDedupTtlSeconds,
      backtestDefaults: this.backtestDefaults,
      disclaimer:
        'Backtest and paper results are simulated. Backtest performance is ' +
        'not indicative of future performance; paper performance is not ' +
        'indicative of live performance.',
    };
  }

  // ---------------------------------------------------------------------------
  // Historical datasets (Part 7)
  // ---------------------------------------------------------------------------
  // The dataset layer is storage and integrity. None of these getters can
  // enable live trading, and none of them describe a venue connection: an
  // ingestion job reads public archives and the backtest engine reads the
  // frozen result. What the summary exposes is *why a backtest is
  // reproducible*: which storage serves datasets, whether ingestion may run,
  // and whether runs must cite a registered dataset version.

  get datasetStorage(): {
    backend: 'local';
    localRoot: string;
    stagingRoot: string;
    maxPartitionBytes: number;
    readerBufferSize: number;
    maxEventsPerPartition: number;
    maxGapWarnings: number;
    validationEnabled: boolean;
    retentionPolicy: 'retain' | 'purge_staging_only';
  } {
    return {
      backend: this.env.DATASET_STORAGE_BACKEND,
      localRoot: this.env.DATASET_LOCAL_ROOT,
      stagingRoot: this.env.DATASET_TEMP_ROOT,
      maxPartitionBytes: this.env.DATASET_MAX_PARTITION_BYTES,
      readerBufferSize: this.env.DATASET_READER_BUFFER_SIZE,
      maxEventsPerPartition: this.env.DATASET_MAX_EVENTS_PER_PARTITION,
      maxGapWarnings: this.env.DATASET_MAX_GAP_WARNINGS,
      validationEnabled: this.env.DATASET_VALIDATION_ENABLED,
      retentionPolicy: this.env.DATASET_RETENTION_POLICY,
    };
  }

  get historicalIngestionEnabled(): boolean {
    return this.env.HISTORICAL_INGESTION_ENABLED;
  }

  get backtestDatasetRequired(): boolean {
    return this.env.BACKTEST_DATASET_REQUIRED;
  }
  /**
   * Everything the admin UI may know about the dataset layer.
   *
   * Field by field for the same reason as {@link strategySafetySummary}:
   * nothing is spread in, so a credential-shaped value cannot arrive by
   * accident. There are no credentials here to begin with - historical
   * market data is public - but the assembly discipline is what keeps it
   * that way when someone adds the next field.
   */
  get datasetSafetySummary(): {
    ingestionEnabled: boolean;
    datasetRequiredForBacktests: boolean;
    storage: {
      backend: 'local';
      localRoot: string;
      stagingRoot: string;
      maxPartitionBytes: number;
      readerBufferSize: number;
      maxEventsPerPartition: number;
      maxGapWarnings: number;
      validationEnabled: boolean;
      retentionPolicy: 'retain' | 'purge_staging_only';
    };
    note: string;
  } {
    return {
      ingestionEnabled: this.historicalIngestionEnabled,
      datasetRequiredForBacktests: this.backtestDatasetRequired,
      storage: this.datasetStorage,
      note:
        'Datasets are frozen historical market data used for backtesting. ' +
        'They are not a trading input, cannot reach a venue, and a result ' +
        'computed over them is a simulation.',
    };
  }

  // ---------------------------------------------------------------------------
  // Part 8: risk engine control plane
  // ---------------------------------------------------------------------------

  get riskEngineEnabled(): boolean {
    return this.env.RISK_ENGINE_ENABLED;
  }

  get riskFailClosed(): boolean {
    return this.env.RISK_FAIL_CLOSED;
  }

  get maxRiskStateAgeMs(): number {
    return this.env.MAX_RISK_STATE_AGE_MS;
  }

  get riskSnapshotRefreshMs(): number {
    return this.env.RISK_SNAPSHOT_REFRESH_MS;
  }

  get riskEventsRetentionDays(): number {
    return this.env.RISK_EVENTS_RETENTION_DAYS;
  }

  /**
   * The platform-default ceilings this deployment publishes as the GLOBAL
   * layer of the risk hierarchy. They are strings because they are decimal
   * money all the way down: the API never runs them through Number beyond the
   * validation the env schema already performed.
   */
  get riskPlatformCeilings(): {
    maxOrderNotional: string;
    maxPositionNotional: string;
    maxAccountExposure: string;
    maxStrategyExposure: string;
    maxSymbolExposure: string;
    maxOpenOrders: number;
    maxDailyLoss: string;
    maxStrategyDailyLoss: string;
    maxDrawdownPercent: string;
    maxOrdersPerSecond: number;
    maxOrdersPerMinute: number;
    maxCancelsPerSecond: number;
    maxCancelsPerMinute: number;
    maxPriceDeviationBps: number;
    maxConsecutiveLosses: number;
  } {
    return {
      maxOrderNotional: this.env.MAX_ORDER_NOTIONAL,
      maxPositionNotional: this.env.MAX_POSITION_NOTIONAL,
      maxAccountExposure: this.env.MAX_ACCOUNT_EXPOSURE,
      maxStrategyExposure: this.env.MAX_STRATEGY_EXPOSURE,
      maxSymbolExposure: this.env.MAX_SYMBOL_EXPOSURE,
      maxOpenOrders: this.env.MAX_OPEN_ORDERS,
      maxDailyLoss: this.env.MAX_DAILY_LOSS,
      maxStrategyDailyLoss: this.env.MAX_STRATEGY_DAILY_LOSS,
      maxDrawdownPercent: this.env.MAX_DRAWDOWN,
      maxOrdersPerSecond: this.env.MAX_ORDERS_PER_SECOND,
      maxOrdersPerMinute: this.env.MAX_ORDERS_PER_MINUTE,
      maxCancelsPerSecond: this.env.MAX_CANCELS_PER_SECOND,
      maxCancelsPerMinute: this.env.MAX_CANCELS_PER_MINUTE,
      maxPriceDeviationBps: this.env.MAX_PRICE_DEVIATION_BPS,
      maxConsecutiveLosses: this.env.MAX_CONSECUTIVE_LOSSES,
    };
  }

  /**
   * The operator's single answer to "what is the risk posture of this
   * deployment, right now". Computed from configuration (the env) plus the
   * durable switch mirror, exactly like the Part 5 execution summary -
   * nothing cached, nothing assumed, and the blocking list states ALL
   * reasons at once so nobody releases a control to see whether the next
   * one was real.
   */
  get riskSafetySummary(): {
    engineEnabled: boolean;
    failClosed: boolean;
    maxRiskStateAgeMs: number;
    snapshotRefreshMs: number;
    refreshOutpacesStaleness: boolean;
    ceilings: AppConfigService['riskPlatformCeilings'];
    note: string;
  } {
    return {
      engineEnabled: this.riskEngineEnabled,
      failClosed: this.riskFailClosed,
      maxRiskStateAgeMs: this.maxRiskStateAgeMs,
      snapshotRefreshMs: this.riskSnapshotRefreshMs,
      refreshOutpacesStaleness:
        this.riskSnapshotRefreshMs < this.maxRiskStateAgeMs,
      ceilings: this.riskPlatformCeilings,
      note:
        'Risk controls reduce operational risk but cannot guarantee against ' +
        'all losses. These ceilings are the GLOBAL layer only; the effective ' +
        'limit is the tightest applicable entry across the whole hierarchy, ' +
        'resolved inside the engine. No API route approves an order.',
    };
  }

  get tradingEngineUrl(): string {
    return this.env.TRADING_ENGINE_URL;
  }

  // ------------------------------------------------------------------
  // Part 9: observability accessors. Every value here is *publication*
  // configuration; nothing in the trading path reads them, and nothing
  // here can switch a trading safety off.
  // ------------------------------------------------------------------

  get observabilityEnabled(): boolean {
    return this.configService.get<boolean>('OBSERVABILITY_ENABLED', true);
  }

  get metricsEnabled(): boolean {
    return this.configService.get<boolean>('METRICS_ENABLED', true);
  }

  get healthEnabled(): boolean {
    return this.configService.get<boolean>('HEALTH_ENABLED', true);
  }

  get prometheusEnabled(): boolean {
    return this.configService.get<boolean>('PROMETHEUS_ENABLED', true);
  }

  get prometheusPath(): string {
    return this.configService.get<string>('PROMETHEUS_PATH', '/metrics');
  }

  /** Optional scrape secret. NEVER returned by any summary and never
   *  interpolated into a log line - callers use it only for a constant-time
   *  comparison against the presented header. */
  get metricsToken(): string | undefined {
    return this.configService.get<string>('METRICS_TOKEN') ?? undefined;
  }

  get alertingEnabled(): boolean {
    return this.configService.get<boolean>('ALERTING_ENABLED', true);
  }

  get alertDedupWindowMs(): number {
    return this.configService.get<number>('ALERT_DEDUP_WINDOW_MS', 60_000);
  }

  get queueAlertAgeMs(): number {
    return this.configService.get<number>('QUEUE_ALERT_AGE_MS', 120_000);
  }

  get metricsExportIntervalMs(): number {
    return this.configService.get<number>('METRICS_EXPORT_INTERVAL_MS', 15_000);
  }

  get healthRefreshMs(): number {
    return this.configService.get<number>('HEALTH_REFRESH_MS', 5_000);
  }

  get alertRetentionDays(): number {
    return this.configService.get<number>('ALERT_RETENTION_DAYS', 90);
  }

  get incidentRetentionDays(): number {
    return this.configService.get<number>('INCIDENT_RETENTION_DAYS', 365);
  }

  /** Trading-engine ops surface: the gate documents this service publishes
   *  for the API's trading-readiness merge. Same base URL as the health
   *  probe; distinct path, so a probe outage and a telemetry outage are
   *  distinguishable in logs without a third URL to configure. */
  get tradingEngineOpsTradingUrl(): string {
    const base = this.configService.get<string>('TRADING_ENGINE_URL', 'http://localhost:8001');
    return `${base.replace(/\/+$/, '')}/health/trading`;
  }

  get tradingEngineOpsComponentsUrl(): string {
    const base = this.configService.get<string>('TRADING_ENGINE_URL', 'http://localhost:8001');
    return `${base.replace(/\/+$/, '')}/health/components`;
  }

  get tradingEngineOpsMetricsUrl(): string {
    const base = this.configService.get<string>('TRADING_ENGINE_URL', 'http://localhost:8001');
    return `${base.replace(/\/+$/, '')}/metrics`;
  }

  get marketDataOpsComponentsUrl(): string {
    const base = this.configService.get<string>('MARKET_DATA_URL', 'http://localhost:8002');
    return `${base.replace(/\/+$/, '')}/health/components`;
  }

  /** The sentence the operations panel shows about its own guarantees.
   *  Deliberately plain: no latency claims, no uptime claims. */
  get observabilitySafetySummary(): {
    observabilityEnabled: boolean;
    metricsEnabled: boolean;
    prometheusEnabled: boolean;
    alertingEnabled: boolean;
    alertRetentionDays: number;
    incidentRetentionDays: number;
    queueAlertAgeMs: number;
    tracingEnabled: boolean;
    sloEnabled: boolean;
    note: string;
  } {
    return {
      observabilityEnabled: this.observabilityEnabled,
      metricsEnabled: this.metricsEnabled,
      prometheusEnabled: this.prometheusEnabled,
      alertingEnabled: this.alertingEnabled,
      alertRetentionDays: this.alertRetentionDays,
      incidentRetentionDays: this.incidentRetentionDays,
      queueAlertAgeMs: this.queueAlertAgeMs,
      tracingEnabled: this.otelEnabled,
      sloEnabled: this.sloEnabled,
      note:
        'Observability describes the platform; it authorises nothing. Trading ' +
        'enforcement lives in the risk gate. Risk controls reduce operational ' +
        'risk but cannot guarantee against all losses.',
    };
  }

  // --- Part 10: reliability (tracing, SLO evaluation, fault posture) ------
  // These getters READ configuration; none of them can change it. The
  // one-way derivations (priority list parsing, multiplier -> ppm) live here
  // so every consumer sees the identical integers the validator was written
  // against, and so the ppm math happens once, in integer arithmetic.

  get otelEnabled(): boolean {
    return this.env.OTEL_ENABLED === true;
  }

  /** The collector base URL, or undefined. Never logged: an OTLP URL is not
   *  secret, but a future operator might embed one, and the surface reading
   *  this only needs "configured / not configured". */
  get otelEndpoint(): string | undefined {
    return this.env.OTEL_ENDPOINT ?? undefined;
  }

  get otelTimeoutMs(): number {
    return this.env.OTEL_TIMEOUT_MS;
  }

  get otelSampleRatio(): number {
    return this.env.OTEL_SAMPLE_RATIO;
  }

  get otelPriorityOperations(): string[] {
    return this.env.OTEL_PRIORITY_OPERATIONS.split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  /** Effective arming: the guards are AND-ed here because every consumer
   *  must see the SAME truth the env validator enforced - a deployment that
   *  disabled the guard gets an unarmed injector, fail-closed in both
   *  directions. */
  get failureInjectionArmed(): boolean {
    return (
      this.env.FAILURE_INJECTION_ENABLED === true &&
      this.env.FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY === true &&
      this.env.NODE_ENV !== 'production'
    );
  }

  get failureInjectionRequested(): boolean {
    return this.env.FAILURE_INJECTION_ENABLED === true;
  }

  get sloEnabled(): boolean {
    return this.env.SLO_ENABLED === true;
  }

  get sloEvaluationIntervalMinutes(): number {
    return this.env.SLO_EVALUATION_INTERVAL_MINUTES;
  }

  get sloRetentionDays(): number {
    return this.env.SLO_RETENTION_DAYS;
  }

  get sloDefaultWindowMinutes(): number {
    return this.env.SLO_DEFAULT_WINDOW_MINUTES;
  }

  /** Decimal multiplier STRING -> integer ppm, exactly (14.4 -> 14_400_000).
   *  String arithmetic on purpose: `Number('14.4') * 1e6` is
   *  14400000.000000002 in IEEE-754, and a paging threshold whose rounding
   *  depends on float history is how a 3am argument starts. */
  get sloFastBurnPpm(): number {
    return AppConfigService.decimalStringToPpm(this.env.SLO_FAST_BURN_MULTIPLIER);
  }

  get sloSlowBurnPpm(): number {
    return AppConfigService.decimalStringToPpm(this.env.SLO_SLOW_BURN_MULTIPLIER);
  }

  static decimalStringToPpm(raw: string): number {
    const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(raw);
    if (!match) {
      throw new Error(`not a plain decimal multiplier: ${JSON.stringify(raw)}`);
    }
    const whole = match[1] ?? '0';
    const fraction = (match[2] ?? '').padEnd(6, '0').slice(0, 6);
    return Number(whole) * 1_000_000 + Number(fraction);
  }

  /** Tracing posture the panel renders; secret-free by construction - the
   *  endpoint is reported as a boolean, never as text. */
  get tracingSafetySummary(): {
    enabled: boolean;
    endpointConfigured: boolean;
    sampleRatio: number;
    priorityOperations: string[];
    faultInjection: { requested: boolean; armed: boolean };
    note: string;
  } {
    return {
      enabled: this.otelEnabled,
      endpointConfigured: this.otelEndpoint !== undefined,
      sampleRatio: this.otelSampleRatio,
      priorityOperations: this.otelPriorityOperations,
      faultInjection: {
        requested: this.failureInjectionRequested,
        armed: this.failureInjectionArmed,
      },
      note:
        'Tracing correlates evidence; it authorises nothing. Sampling is ' +
        'head-based and spans may be dropped under load or export failure - ' +
        'dropped is counted, never silently lost.',
    };
  }

  get tradingEngineHealthUrl(): string {
    return `${this.env.TRADING_ENGINE_URL}${this.env.TRADING_ENGINE_HEALTH_PATH}`;
  }

  get marketDataUrl(): string {
    return this.env.MARKET_DATA_URL;
  }

  get marketDataHealthUrl(): string {
    return `${this.env.MARKET_DATA_URL}${this.env.MARKET_DATA_HEALTH_PATH}`;
  }

  get notificationServiceUrl(): string {
    return this.env.NOTIFICATION_SERVICE_URL;
  }

  get notificationServiceHealthUrl(): string {
    return `${this.env.NOTIFICATION_SERVICE_URL}${this.env.NOTIFICATION_SERVICE_HEALTH_PATH}`;
  }

  get internalServiceToken(): string {
    return this.env.INTERNAL_SERVICE_TOKEN;
  }

  // ---------------------------------------------------------------------------
  // Mail / notifications
  // ---------------------------------------------------------------------------

  get mailDriver(): AppEnv['MAIL_DRIVER'] {
    return this.env.MAIL_DRIVER;
  }

  get mailFrom(): { name: string; address: string } {
    return { name: this.env.MAIL_FROM_NAME, address: this.env.MAIL_FROM_ADDRESS };
  }

  get notificationsEnabled(): boolean {
    return this.env.NOTIFICATIONS_ENABLED;
  }

  // ---------------------------------------------------------------------------
  // Localisation
  // ---------------------------------------------------------------------------

  get defaultLocale(): string {
    return this.env.DEFAULT_LOCALE;
  }

  get supportedLocales(): string[] {
    return this.env.SUPPORTED_LOCALES;
  }

  get defaultCurrency(): string {
    return this.env.DEFAULT_CURRENCY;
  }

  get supportedCurrencies(): string[] {
    return this.env.SUPPORTED_CURRENCIES;
  }

  // ---------------------------------------------------------------------------
  // Compliance / billing providers
  // ---------------------------------------------------------------------------

  get kycProvider(): AppEnv['KYC_PROVIDER'] {
    return this.env.KYC_PROVIDER;
  }

  get billingProvider(): AppEnv['BILLING_PROVIDER'] {
    return this.env.BILLING_PROVIDER;
  }

  // ---------------------------------------------------------------------------
  // Seed
  // ---------------------------------------------------------------------------

  get seedSuperAdminEmail(): string {
    return this.env.SEED_SUPER_ADMIN_EMAIL;
  }
}