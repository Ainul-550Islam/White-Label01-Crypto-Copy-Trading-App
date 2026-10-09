// # Verifies every copy policy and follower risk enforcement rule and fail-closed lookup path
// # Verifies leverage and margin constraint rejections
import { FollowerRiskService, type RiskCheckInput } from './follower-risk.service';
import { CopyRiskDecision, type FollowerRiskPolicy } from './copy-trading.types';

/**
 * The four database-backed follower risk rules (symbol exposure, daily copy
 * count, daily pause, concentration) swallowed lookup errors and fell through
 * to ALLOW, so a database hiccup silently disabled them. A rule that cannot
 * be evaluated now blocks the copy and names the rule.
 */
const NO_LIMITS: FollowerRiskPolicy = {
  maxDailyLoss: null,
  maxTotalLoss: null,
  maxDrawdown: null,
  maxExposure: null,
  maxPositionSize: null,
  maxSymbolExposure: null,
  maxCopyCount: null,
  maxLeverage: null,
  minMarginRatio: null,
  allowedMarginModes: null,
  emergencyStopCopy: false,
  dailyPauseEnabled: false,
};

function input(policy: Partial<FollowerRiskPolicy>, extra: Partial<RiskCheckInput> = {}): RiskCheckInput {
  return {
    tenantId: 'tenant-1',
    followerId: 'user-f',
    subscriptionId: 'sub-1',
    traderId: 'trader-1',
    followerAccountId: 'acct-f',
    symbol: 'BTC-USDT',
    side: 'BUY',
    quantity: '0.5',
    price: '50000',
    notional: '25000',
    riskPolicy: { ...NO_LIMITS, ...policy },
    ...extra,
  };
}

function build(opts: { positions?: unknown[]; copyCount?: number; subscriptionState?: string; failing?: boolean } = {}) {
  const fail = async () => {
    throw new Error('db unavailable');
  };
  const prisma = {
    position: { findMany: jest.fn(opts.failing ? fail : async () => opts.positions ?? []) },
    copyExecution: { count: jest.fn(opts.failing ? fail : async () => opts.copyCount ?? 0) },
    copySubscription: {
      findFirst: jest.fn(opts.failing ? fail : async () => ({ id: 'sub-1', state: opts.subscriptionState ?? 'ACTIVE' })),
    },
  };
  return new FollowerRiskService(prisma as never);
}

describe('FollowerRiskService database-backed rules fail closed', () => {
  it.each([
    ['MAX_SYMBOL_EXPOSURE', input({ maxSymbolExposure: '10' })],
    ['MAX_COPY_COUNT', input({ maxCopyCount: 5 })],
    ['DAILY_PAUSE', input({ dailyPauseEnabled: true })],
    ['CONCENTRATION', input({}, { currentExposure: '1000' })],
  ])('%s: a failed lookup blocks and names the rule', async (rule, risk) => {
    await expect(build({ failing: true }).checkRisk(risk)).resolves.toEqual({
      decision: CopyRiskDecision.BLOCK,
      allowed: false,
      ruleId: `${rule}_UNAVAILABLE`,
      reason: `Risk rule ${rule} could not be evaluated`,
    });
  });

  it('the rules still decide normally when the data is readable', async () => {
    await expect(build({ copyCount: 5 }).checkRisk(input({ maxCopyCount: 5 }))).resolves.toMatchObject({
      allowed: false,
      ruleId: 'MAX_COPY_COUNT',
    });
    await expect(build({ copyCount: 4 }).checkRisk(input({ maxCopyCount: 5 }))).resolves.toMatchObject({ allowed: true });
    await expect(
      build({ positions: [{ quantity: '9.8', markPrice: null }] }).checkRisk(input({ maxSymbolExposure: '10' })),
    ).resolves.toMatchObject({ allowed: false, ruleId: 'MAX_SYMBOL_EXPOSURE' });
    await expect(build({ subscriptionState: 'PAUSED' }).checkRisk(input({ dailyPauseEnabled: true }))).resolves.toMatchObject({
      decision: CopyRiskDecision.PAUSE,
      ruleId: 'DAILY_PAUSE',
    });
  });

  it('concentration is computed from real positions, not a silent 0', async () => {
    // 1 BTC already held at 50k mark + a 25k order = 75k of 76k exposure -> > 80%.
    const service = build({ positions: [{ quantity: '1', markPrice: '50000' }] });
    await expect(service.checkRisk(input({}, { currentExposure: '51000' }))).resolves.toMatchObject({
      allowed: false,
      ruleId: 'CONCENTRATION',
    });
  });

  it('no policy limits and no exposure -> ALLOW without touching the database', async () => {
    const service = build({ failing: true });
    await expect(service.checkRisk(input({}))).resolves.toEqual({
      decision: CopyRiskDecision.ALLOW,
      allowed: true,
      ruleId: null,
      reason: null,
    });
  });
});

describe('FollowerRiskService copy policy enforcement coverage (GAP-08)', () => {
  const service = build();

  it('blocks symbols on blockedSymbols or outside allowedSymbols', async () => {
    await expect(
      service.checkRisk(input({}, { copyPolicy: { blockedSymbols: ['BTC-USDT'] } })),
    ).resolves.toMatchObject({
      decision: CopyRiskDecision.BLOCK,
      allowed: false,
      ruleId: 'BLOCKED_SYMBOL',
    });

    await expect(
      service.checkRisk(input({}, { copyPolicy: { allowedSymbols: ['ETH-USDT'] } })),
    ).resolves.toMatchObject({
      decision: CopyRiskDecision.BLOCK,
      allowed: false,
      ruleId: 'UNALLOWED_SYMBOL',
    });
  });

  // The platform policy blocks `*WITHDRAWAL*`. Enforcement compared with Array.includes, so no
  // symbol could ever equal that literal and the rule never fired: withdrawal-like instruments were
  // copyable on every venue. These tests fail if the matcher reverts to exact equality.
  it('fires the platform deny glob instead of treating it as an unmatchable literal', async () => {
    await expect(
      service.checkRisk(input({}, { symbol: 'BTC-WITHDRAWAL-TEST', copyPolicy: { blockedSymbols: ['*WITHDRAWAL*'] } })),
    ).resolves.toMatchObject({
      decision: CopyRiskDecision.BLOCK,
      allowed: false,
      ruleId: 'BLOCKED_SYMBOL',
    });

    // The same rule must not block an ordinary symbol, or the fix would be worse than the bug.
    await expect(
      service.checkRisk(input({}, { copyPolicy: { blockedSymbols: ['*WITHDRAWAL*'] } })),
    ).resolves.toMatchObject({ decision: CopyRiskDecision.ALLOW, allowed: true });
  });

  it('matches symbol rules case-insensitively and as globs on both lists', async () => {
    await expect(
      service.checkRisk(input({}, { symbol: 'btc-usdt', copyPolicy: { blockedSymbols: ['BTC-USDT'] } })),
    ).resolves.toMatchObject({ ruleId: 'BLOCKED_SYMBOL', allowed: false });

    await expect(
      service.checkRisk(input({}, { symbol: 'PEPE-USDT', copyPolicy: { allowedSymbols: ['*USDT'] } })),
    ).resolves.toMatchObject({ decision: CopyRiskDecision.ALLOW, allowed: true });

    await expect(
      service.checkRisk(input({}, { symbol: 'PEPE-BTC', copyPolicy: { allowedSymbols: ['*USDT'] } })),
    ).resolves.toMatchObject({ ruleId: 'UNALLOWED_SYMBOL', allowed: false });
  });

  it('enforces maxOrderNotional, maxDailyNotional, and maxConcurrentCopies', async () => {
    await expect(
      service.checkRisk(input({}, { copyPolicy: { maxOrderNotional: '10000' } })),
    ).resolves.toMatchObject({
      decision: CopyRiskDecision.BLOCK,
      allowed: false,
      ruleId: 'MAX_ORDER_NOTIONAL',
    });

    await expect(
      service.checkRisk(input({}, { copyPolicy: { maxDailyNotional: '40000' }, dailyNotionalUsed: '20000' })),
    ).resolves.toMatchObject({
      decision: CopyRiskDecision.BLOCK,
      allowed: false,
      ruleId: 'MAX_DAILY_NOTIONAL',
    });

    await expect(
      service.checkRisk(input({}, { copyPolicy: { maxConcurrentCopies: 3 }, concurrentOpenCopies: 3 })),
    ).resolves.toMatchObject({
      decision: CopyRiskDecision.BLOCK,
      allowed: false,
      ruleId: 'MAX_CONCURRENT_COPIES',
    });
  });

  it('enforces emergencyStopCopy, maxDailyLoss, maxTotalLoss, maxDrawdown, and maxExposure reduction', async () => {
    await expect(service.checkRisk(input({ emergencyStopCopy: true }))).resolves.toMatchObject({
      decision: CopyRiskDecision.STOP_COPY,
      ruleId: 'EMERGENCY_STOP_COPY',
    });

    await expect(service.checkRisk(input({ maxDailyLoss: '500' }, { dailyLoss: '550' }))).resolves.toMatchObject({
      decision: CopyRiskDecision.BLOCK,
      ruleId: 'MAX_DAILY_LOSS',
    });

    await expect(service.checkRisk(input({ maxTotalLoss: '1500' }, { totalLoss: '1500' }))).resolves.toMatchObject({
      decision: CopyRiskDecision.STOP_COPY,
      ruleId: 'MAX_TOTAL_LOSS',
    });

    await expect(service.checkRisk(input({ maxDrawdown: '15' }, { currentDrawdown: '16.5' }))).resolves.toMatchObject({
      decision: CopyRiskDecision.PAUSE,
      ruleId: 'MAX_DRAWDOWN',
    });

    const reduced = await service.checkRisk(input({ maxExposure: '40000' }, { currentExposure: '27500' }));
    expect(reduced).toMatchObject({
      decision: CopyRiskDecision.REDUCE,
      allowed: true,
      ruleId: 'MAX_EXPOSURE_REDUCE',
      reducedQuantity: '0.25',
    });
  });
});

describe('FollowerRiskService leverage and margin constraints (GAP-16)', () => {
  const service = build();

  it('rejects orders whose requested leverage exceeds follower maxLeverage', async () => {
    await expect(
      service.checkRisk(input({ maxLeverage: '3' }, { requestedLeverage: '5' })),
    ).resolves.toMatchObject({
      decision: CopyRiskDecision.BLOCK,
      allowed: false,
      ruleId: 'MAX_LEVERAGE',
    });
  });

  it('rejects leveraged requests when copyPolicy is SPOT_ONLY', async () => {
    await expect(
      service.checkRisk(input({}, { copyPolicy: { leveragePolicy: 'SPOT_ONLY' }, requestedLeverage: '2' })),
    ).resolves.toMatchObject({
      decision: CopyRiskDecision.BLOCK,
      allowed: false,
      ruleId: 'SPOT_ONLY_LEVERAGE_FORBIDDEN',
    });
  });

  it('rejects unsupported margin modes and insufficient margin ratios', async () => {
    await expect(
      service.checkRisk(input({ allowedMarginModes: ['SPOT', 'ISOLATED'] }, { marginMode: 'CROSS' })),
    ).resolves.toMatchObject({
      decision: CopyRiskDecision.BLOCK,
      allowed: false,
      ruleId: 'UNSUPPORTED_MARGIN_MODE',
    });

    await expect(
      service.checkRisk(input({ minMarginRatio: '0.30' }, { availableMarginRatio: '0.18' })),
    ).resolves.toMatchObject({
      decision: CopyRiskDecision.BLOCK,
      allowed: false,
      ruleId: 'INSUFFICIENT_MARGIN_RATIO',
    });
  });
});
