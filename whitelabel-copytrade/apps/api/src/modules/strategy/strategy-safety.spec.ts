import { validateEnv, EnvValidationError } from '@wlct/config';
import {
  NON_WILDCARD_PERMISSIONS,
  Permission,
  STRATEGY_PERMISSIONS,
  STRATEGY_READ_ONLY_PERMISSIONS,
  SYSTEM_ROLE_DEFINITIONS,
  SystemRole,
  hasPermission,
  permissionMatches,
} from '@wlct/shared-types';

import { StrategyInstancesService } from './strategy-instances.service';
import { SIMULATION_DISCLAIMER } from './strategy.types';
import {
  toBacktestRunView,
  toBacktestTradeView,
  toPaperSessionView,
  toPaperSnapshotView,
  type BacktestRunRow,
  type BacktestTradeRow,
  type PaperSessionRow,
  type PaperSnapshotRow,
} from './strategy.mapper';

/**
 * Part 6 safety tests.
 *
 * Three properties are worth guarding here, and all three are pure functions
 * of their inputs: the environment schema that decides whether the strategy
 * layer runs at all, the RBAC rules that decide who may start a strategy, and
 * the mapper that decides whether a simulated number is labelled as one.
 *
 * No credential, no database, no network, no venue.
 */

function baseEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
    DIRECT_DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
    REDIS_URL: 'redis://localhost:6379/0',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    ENCRYPTION_MASTER_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
    BLIND_INDEX_KEY_BASE64: Buffer.alloc(32, 9).toString('base64'),
    INTERNAL_SERVICE_TOKEN: 'c'.repeat(32),
    EXCHANGE_WEBHOOK_SIGNING_SECRET: 'd'.repeat(32),
    ...overrides,
  };
}

function expectFailureOn(env: Record<string, string>, path: string): EnvValidationError {
  try {
    validateEnv(env);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvValidationError);
    const failure = error as EnvValidationError;
    expect(failure.failures.map((entry) => entry.path)).toContain(path);
    return failure;
  }
  throw new Error(`Expected validation to fail on ${path}, but it succeeded.`);
}

const decimal = (value: string): never => ({ toString: () => value }) as never;

describe('Part 6 - strategy environment safety', () => {
  it('leaves the strategy engine off by default', () => {
    const env = validateEnv(baseEnv());

    expect(env.STRATEGY_ENGINE_ENABLED).toBe(false);
    expect(env.PAPER_TRADING_ENABLED).toBe(true);
    expect(env.BACKTEST_ENABLED).toBe(true);
  });

  it('keeps fees and capital as exact decimal strings, never floats', () => {
    const env = validateEnv(
      baseEnv({
        BACKTEST_DEFAULT_INITIAL_CAPITAL: '25000.50',
        BACKTEST_DEFAULT_MAKER_FEE: '0.0002',
        BACKTEST_DEFAULT_TAKER_FEE: '0.0004',
        BACKTEST_DEFAULT_SLIPPAGE_BPS: '2.5',
      }),
    );

    expect(env.BACKTEST_DEFAULT_INITIAL_CAPITAL).toBe('25000.50');
    expect(env.BACKTEST_DEFAULT_MAKER_FEE).toBe('0.0002');
    expect(typeof env.BACKTEST_DEFAULT_TAKER_FEE).toBe('string');
    expect(env.BACKTEST_DEFAULT_SLIPPAGE_BPS).toBe('2.5');
  });

  it('refuses an engine with nowhere to send a signal', () => {
    expectFailureOn(
      baseEnv({
        STRATEGY_ENGINE_ENABLED: 'true',
        PAPER_TRADING_ENABLED: 'false',
        BACKTEST_ENABLED: 'false',
        EXECUTION_ENABLED: 'false',
      }),
      'STRATEGY_ENGINE_ENABLED',
    );
  });

  it('refuses a dedup window shorter than the signal validity window', () => {
    expectFailureOn(
      baseEnv({ SIGNAL_DEDUP_TTL_SECONDS: '1', SIGNAL_MAX_AGE_MS: '2000' }),
      'SIGNAL_DEDUP_TTL_SECONDS',
    );
  });

  it('refuses a processing budget that would make every signal stale', () => {
    expectFailureOn(
      baseEnv({ STRATEGY_MAX_PROCESSING_LATENCY_MS: '5000', SIGNAL_MAX_AGE_MS: '2000' }),
      'STRATEGY_MAX_PROCESSING_LATENCY_MS',
    );
  });

  it('bounds the event queue and the instance count', () => {
    expectFailureOn(baseEnv({ STRATEGY_EVENT_QUEUE_SIZE: '10' }), 'STRATEGY_EVENT_QUEUE_SIZE');
    expectFailureOn(baseEnv({ STRATEGY_MAX_INSTANCES: '5000' }), 'STRATEGY_MAX_INSTANCES');
  });

  it('refuses zero capital', () => {
    expectFailureOn(
      baseEnv({ BACKTEST_DEFAULT_INITIAL_CAPITAL: '0' }),
      'BACKTEST_DEFAULT_INITIAL_CAPITAL',
    );
  });

  it('refuses a free lunch in production', () => {
    // Zero fees with zero slippage produces results no real account could
    // achieve. Allowed outside production, where isolating costs is a
    // legitimate thing to want.
    expectFailureOn(
      baseEnv({
        NODE_ENV: 'production',
        BACKTEST_DEFAULT_TAKER_FEE: '0',
        BACKTEST_DEFAULT_SLIPPAGE_BPS: '0',
        SWAGGER_PASSWORD: 'x'.repeat(24),
        CORS_ORIGINS: 'https://admin.example.com',
      }),
      'BACKTEST_DEFAULT_TAKER_FEE',
    );

    const nonProduction = validateEnv(
      baseEnv({ BACKTEST_DEFAULT_TAKER_FEE: '0', BACKTEST_DEFAULT_SLIPPAGE_BPS: '0' }),
    );
    expect(nonProduction.BACKTEST_DEFAULT_TAKER_FEE).toBe('0');
  });

  it('does not let any Part 6 switch enable live trading', () => {
    const env = validateEnv(
      baseEnv({
        STRATEGY_ENGINE_ENABLED: 'true',
        PAPER_TRADING_ENABLED: 'true',
        BACKTEST_ENABLED: 'true',
      }),
    );

    // The live-trading decision is made by the Part 5 switches alone, and every
    // one of them is still at its safe default.
    expect(env.LIVE_TRADING_ENABLED).toBe(false);
    expect(env.EXECUTION_ENABLED).toBe(false);
    expect(env.DRY_RUN).toBe(true);
    expect(env.PAPER_TRADING).toBe(true);
    expect(env.EXCHANGE_SANDBOX_MODE).toBe(true);
  });

  it('still refuses the live-trading contradictions from Part 5', () => {
    expectFailureOn(
      baseEnv({ STRATEGY_ENGINE_ENABLED: 'true', LIVE_TRADING_ENABLED: 'true' }),
      'DRY_RUN',
    );
  });
});

describe('Part 6 - strategy permissions', () => {
  it('excludes starting a strategy from resource wildcards', () => {
    expect(NON_WILDCARD_PERMISSIONS.has(Permission.STRATEGY_INSTANCE_ENABLE)).toBe(true);
    expect(permissionMatches('strategy_instance:*', Permission.STRATEGY_INSTANCE_ENABLE)).toBe(
      false,
    );
    expect(permissionMatches('strategy_instance:*', Permission.STRATEGY_INSTANCE_READ)).toBe(true);
  });

  it('keeps stopping a strategy grantable by wildcard', () => {
    // Deliberate asymmetry: stopping is risk-reducing and must never be the
    // thing a permission check is arguing about while something misbehaves.
    expect(NON_WILDCARD_PERMISSIONS.has(Permission.STRATEGY_INSTANCE_DISABLE)).toBe(false);
    expect(permissionMatches('strategy_instance:*', Permission.STRATEGY_INSTANCE_DISABLE)).toBe(
      true,
    );
  });

  it('lets the platform super admin wildcard reach everything', () => {
    for (const permission of STRATEGY_PERMISSIONS) {
      expect(hasPermission([Permission.ALL], permission)).toBe(true);
    }
  });

  it('does not let support start or stop anything', () => {
    const support = SYSTEM_ROLE_DEFINITIONS.find((role) => role.key === SystemRole.SUPPORT);
    expect(support).toBeDefined();
    const granted = support?.permissions ?? [];

    expect(hasPermission(granted, Permission.STRATEGY_INSTANCE_READ)).toBe(true);
    expect(hasPermission(granted, Permission.STRATEGY_INSTANCE_ENABLE)).toBe(false);
    expect(hasPermission(granted, Permission.STRATEGY_INSTANCE_DISABLE)).toBe(false);
    expect(hasPermission(granted, Permission.BACKTEST_SUBMIT)).toBe(false);
    expect(hasPermission(granted, Permission.PAPER_SESSION_OPERATE)).toBe(false);
  });

  it('lets compliance stop a strategy but not start one', () => {
    const compliance = SYSTEM_ROLE_DEFINITIONS.find((role) => role.key === SystemRole.COMPLIANCE);
    const granted = compliance?.permissions ?? [];

    expect(hasPermission(granted, Permission.STRATEGY_INSTANCE_DISABLE)).toBe(true);
    expect(hasPermission(granted, Permission.STRATEGY_INSTANCE_ENABLE)).toBe(false);
  });

  it('gives a trader the full strategy lifecycle but not live arming', () => {
    const trader = SYSTEM_ROLE_DEFINITIONS.find((role) => role.key === SystemRole.TRADER);
    const granted = trader?.permissions ?? [];

    expect(hasPermission(granted, Permission.STRATEGY_INSTANCE_ENABLE)).toBe(true);
    expect(hasPermission(granted, Permission.BACKTEST_SUBMIT)).toBe(true);
    expect(hasPermission(granted, Permission.PAPER_SESSION_OPERATE)).toBe(true);
    // Arming an account for live trading remains an administrator action.
    expect(hasPermission(granted, Permission.EXCHANGE_ACCOUNT_ENABLE_LIVE)).toBe(false);
  });

  it('keeps a follower out of the strategy control surface', () => {
    const follower = SYSTEM_ROLE_DEFINITIONS.find((role) => role.key === SystemRole.FOLLOWER);
    const granted = follower?.permissions ?? [];

    expect(hasPermission(granted, Permission.STRATEGY_INSTANCE_ENABLE)).toBe(false);
    expect(hasPermission(granted, Permission.STRATEGY_INSTANCE_MANAGE)).toBe(false);
    expect(hasPermission(granted, Permission.BACKTEST_SUBMIT)).toBe(false);
  });

  it('holds nothing but reads in the mobile read-only set', () => {
    for (const permission of STRATEGY_READ_ONLY_PERMISSIONS) {
      expect(permission.endsWith(':read')).toBe(true);
    }
    expect(STRATEGY_READ_ONLY_PERMISSIONS).not.toContain(Permission.STRATEGY_INSTANCE_ENABLE);
    expect(STRATEGY_READ_ONLY_PERMISSIONS).not.toContain(Permission.PAPER_SESSION_OPERATE);
  });
});

describe('Part 6 - simulated results are always labelled', () => {
  const backtestRow = (): BacktestRunRow => ({
    id: 'run-1',
    runIdentifier: 'bt-000000000000000000000001',
    status: 'COMPLETED',
    strategyId: null,
    definitionId: null,
    versionId: null,
    strategyKey: 'DETERMINISTIC_IMBALANCE_V1',
    strategyVersion: '1.0.0',
    implementationId: 'module:Class',
    venue: 'BINANCE',
    symbol: 'BTC-USDT',
    marketType: 'SPOT',
    datasetId: 'dataset-1',
    datasetVersionId: null,
    datasetSource: 'STORED',
    datasetChecksum: 'd802739d162e0b7a',
    granularity: null,
    windowStartMicros: 1n,
    windowEndMicros: 2n,
    eventCount: 60,
    walkForwardSegment: null,
    initialCapital: decimal('10000'),
    makerFeeRate: decimal('0.001'),
    takerFeeRate: decimal('0.001'),
    slippageBps: decimal('1'),
    latencyMicros: 0n,
    parameters: {},
    assumptions: {},
    finalEquity: decimal('9999.748'),
    netPnl: decimal('-0.252'),
    grossProfit: decimal('0'),
    grossLoss: decimal('-0.252'),
    feesPaid: decimal('0.12'),
    slippageCost: decimal('0.03'),
    totalReturnPercent: decimal('-0.00252'),
    maxDrawdown: decimal('0.2399'),
    maxDrawdownPercent: decimal('0.0024'),
    totalTrades: 6,
    winningTrades: 0,
    losingTrades: 6,
    winRate: decimal('0'),
    averageTrade: decimal('-0.042'),
    largestWin: null,
    largestLoss: decimal('-0.09'),
    profitFactor: null,
    sharpeRatio: null,
    sortinoRatio: null,
    hasSufficientObservations: false,
    exposurePercent: decimal('12.5'),
    turnover: decimal('180'),
    configurationHash: 'f'.repeat(64),
    engineVersion: '0.6.0',
    isReproducible: true,
    jobId: 'job-1',
    queuedAt: new Date('2026-09-07T00:00:00.000Z'),
    startedAt: new Date('2026-09-07T00:00:01.000Z'),
    completedAt: new Date('2026-09-07T00:00:02.000Z'),
    durationMs: 1000,
    errorCode: null,
    errorSummary: null,
  });

  it('labels a backtest result as simulated and disclaims it', () => {
    const view = toBacktestRunView(backtestRow());

    expect(view.isSimulated).toBe(true);
    expect(view.disclaimer).toBe(SIMULATION_DISCLAIMER);
    expect(view.disclaimer).toContain('not indicative of future performance');
  });

  it('carries a withheld risk metric through as null, not zero', () => {
    const view = toBacktestRunView(backtestRow());

    expect(view.result.sharpeRatio).toBeNull();
    expect(view.result.sortinoRatio).toBeNull();
    expect(view.result.hasSufficientObservations).toBe(false);
  });

  it('stringifies every decimal and bigint rather than rounding it', () => {
    const view = toBacktestRunView(backtestRow());

    expect(view.result.netPnl).toBe('-0.252');
    expect(typeof view.dataset.windowStartMicros).toBe('string');
    expect(typeof view.assumptions.latencyMicros).toBe('string');
  });

  it('labels every simulated trade', () => {
    const trade: BacktestTradeRow = {
      sequence: 1,
      symbol: 'BTC-USDT',
      direction: 'LONG',
      quantity: decimal('0.001'),
      entryPrice: decimal('30000'),
      exitPrice: decimal('30000'),
      grossPnl: decimal('0'),
      fees: decimal('0.06'),
      netPnl: decimal('-0.06'),
      isWin: false,
      openedAtMicros: 1n,
      closedAtMicros: 2n,
      holdingMicros: 1n,
    };

    const view = toBacktestTradeView(trade);

    expect(view.isSimulated).toBe(true);
    // Break-even before costs is a loss after them.
    expect(view.isWin).toBe(false);
    expect(view.netPnl).toBe('-0.06');
  });

  it('labels a paper session and its snapshots', () => {
    const session: PaperSessionRow = {
      id: 'session-1',
      sessionIdentifier: 'paper-1',
      status: 'RUNNING',
      strategyId: 'strategy-1',
      strategyKey: 'DETERMINISTIC_IMBALANCE_V1',
      strategyVersion: '1.0.0',
      venue: 'BINANCE',
      symbol: 'BTC-USDT',
      marketType: 'SPOT',
      initialCapital: decimal('10000'),
      currentEquity: decimal('9998'),
      realisedPnl: decimal('-2'),
      unrealisedPnl: null,
      feesPaid: decimal('0.5'),
      maxDrawdown: decimal('3'),
      signalsGenerated: 10,
      signalsAccepted: 6,
      signalsRejected: 4,
      riskRejections: 1,
      simulatedOrders: 5,
      simulatedFills: 5,
      strategyErrors: 0,
      startedAt: new Date('2026-09-07T00:00:00.000Z'),
      stoppedAt: null,
      stopReason: null,
      errorCode: null,
    };

    const view = toPaperSessionView(session);

    expect(view.isSimulated).toBe(true);
    expect(view.disclaimer).toContain('paper performance is not indicative of live performance');
    // Flat and unmarked stays null rather than becoming a confident zero.
    expect(view.unrealisedPnl).toBeNull();

    const snapshot: PaperSnapshotRow = {
      sequence: 1,
      capturedAtMicros: 1_700_000_000_000_000n,
      cash: decimal('10000'),
      positionQuantity: decimal('0'),
      positionValue: null,
      equity: decimal('10000'),
      realisedPnl: decimal('0'),
      unrealisedPnl: null,
      feesPaid: decimal('0'),
      drawdown: decimal('0'),
    };

    expect(toPaperSnapshotView(snapshot).isSimulated).toBe(true);
    expect(toPaperSnapshotView(snapshot).capturedAtMicros).toBe('1700000000000000');
  });
});

describe('Part 6 - enabling a strategy under live execution', () => {
  it('requires an exact confirmation phrase', () => {
    // The phrase is asserted as a constant rather than only exercised through
    // the service, because a typo in it would silently weaken the gate: a
    // client sending the old phrase would simply be refused, and someone would
    // "fix" that by relaxing the check.
    expect(StrategyInstancesService.LIVE_CONFIRMATION).toBe('ENABLE STRATEGY IN LIVE MODE');
  });
});
