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
