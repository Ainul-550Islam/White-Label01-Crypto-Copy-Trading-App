// # Verifies copy policy precedence, serialization, and fail-closed safety overrides
// # Verifies slippage tolerance and execution delay enforcement
import { CopyPolicyService } from './copy-policy.service';
import { CopySizingMode } from './copy-trading.types';
import { serializeCopyPolicy, serializeFollowerRiskPolicy } from './dto/copy-policy.dto';
import { CustodyVisibilityService } from '../custody/custody-visibility.service';
import { CustodyScope } from '../custody/custody.types';

/**
 * Policy precedence is Platform -> Tenant -> Strategy -> Subscription, and a
 * lower level may only tighten. The tenant/strategy/subscription lookups used
 * to return null on any database error, so a failed lookup silently produced
 * a LOOSER effective policy. The strategy and subscription lookups also
 * ignored the tenant, so GET copy-trading/policies/effective could read
 * another tenant's strategy or subscription policy by id.
 */
describe('CopyPolicyService', () => {
  function build(opts: {
    failing?: 'tenant' | 'strategy' | 'subscription';
    tenantPolicy?: unknown;
    strategyRow?: unknown;
    subscriptionPolicy?: unknown;
  } = {}) {
    const fail = (what: string) => async () => {
      throw new Error(`${what} lookup failed`);
    };
    const prisma = {
      tenantSetting: {
        findFirst: jest.fn(opts.failing === 'tenant' ? fail('tenant') : async () => (opts.tenantPolicy ? { value: opts.tenantPolicy } : null)),
      },
      traderStrategy: {
        findFirst: jest.fn(
          opts.failing === 'strategy'
            ? fail('strategy')
            : async () =>
                opts.strategyRow ?? {
                  riskProfile: { maxOrderNotional: '500', maxLeverage: '5' },
                  strategyConfig: { slippageToleranceBps: 25, executionDelayMs: 500, stopLossBps: 150 },
                  supportedSymbols: ['BTC-USDT', 'ETH-USDT'],
                },
        ),
      },
      copySubscription: {
        findFirst: jest.fn(
          opts.failing === 'subscription'
            ? fail('subscription')
            : async () => ({
                copyPolicy: opts.subscriptionPolicy ?? { maxDailyNotional: '2000' },
              }),
        ),
      },
    };
    return { service: new CopyPolicyService(prisma as never), prisma };
  }

  it.each(['tenant', 'strategy', 'subscription'] as const)('a failing %s lookup propagates instead of loosening the policy', async (failing) => {
    await expect(
      build({ failing }).service.resolveEffectivePolicy({ tenantId: 't1', strategyId: 'st-1', subscriptionId: 'sub-1' }),
    ).rejects.toThrow(`${failing} lookup failed`);
  });

  it('strategy and subscription lookups are scoped to the caller tenant', async () => {
    const { service, prisma } = build();
    await service.resolveEffectivePolicy({ tenantId: 't1', strategyId: 'st-1', subscriptionId: 'sub-1' });
    expect(prisma.traderStrategy.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'st-1', tenantId: 't1' } }));
    expect(prisma.copySubscription.findFirst).toHaveBeenCalledWith({ where: { id: 'sub-1', tenantId: 't1' } });
  });

  it('the strategy risk profile still maps into the policy', async () => {
    await expect(build().service.getTraderStrategyPolicy('st-1', 't1')).resolves.toMatchObject({
      maxOrderNotional: '500',
      slippageToleranceBps: 25,
      allowedSymbols: ['BTC-USDT', 'ETH-USDT'],
    });
  });

  it('serializes full copy policy and follower risk policy deterministically with explicit nulls (GAP-07)', () => {
    const policy = serializeCopyPolicy({
      sizingMode: CopySizingMode.FIXED,
      fixedQuantity: '0.25',
      slippageToleranceBps: 40,
      executionDelayMs: 250,
      maxLeverage: '3',
      marginMode: 'ISOLATED',
      takeProfitBps: 300,
      stopLossBps: 100,
      trailingStopBps: 50,
    });
    expect(policy).toEqual({
      sizingMode: CopySizingMode.FIXED,
      proportionalRatio: null,
      fixedQuantity: '0.25',
      fixedNotional: null,
      maxOrderNotional: null,
      maxDailyNotional: null,
      maxConcurrentCopies: null,
      slippageToleranceBps: 40,
      executionDelayMs: 250,
      allowedSymbols: null,
      blockedSymbols: null,
      allowedSides: null,
      leveragePolicy: null,
      maxLeverage: '3',
      marginMode: 'ISOLATED',
      reduceOnly: null,
      takeProfitBps: 300,
      stopLossBps: 100,
      trailingStopBps: 50,
      stopCopyConditions: null,
    });

    const risk = serializeFollowerRiskPolicy({
      maxDailyLoss: '250',
      maxLeverage: '3',
      minMarginRatio: '0.25',
      allowedMarginModes: ['SPOT', 'ISOLATED'],
    });
    expect(risk).toMatchObject({
      maxDailyLoss: '250',
      maxLeverage: '3',
      minMarginRatio: '0.25',
      allowedMarginModes: ['SPOT', 'ISOLATED'],
      emergencyStopCopy: false,
      dailyPauseEnabled: false,
    });
  });

  it('refuses lower-level overrides that attempt to weaken slippage, execution delay floor, leverage, or stop-loss (GAP-07, GAP-15, GAP-17)', async () => {
    const { service } = build({
      subscriptionPolicy: {
        maxOrderNotional: '999999', // tries to loosen strategy 500
        slippageToleranceBps: 90, // tries to loosen strategy 25
        executionDelayMs: 100, // tries to reduce below strategy 500ms floor
        maxLeverage: '20', // tries to exceed strategy 5x
        stopLossBps: 400, // tries to loosen strategy 150 bps stop-loss
        allowedSymbols: ['BTC-USDT', 'SOL-USDT'], // intersects with strategy ['BTC-USDT', 'ETH-USDT']
        blockedSymbols: ['DOGE-USDT'],
      },
    });
    const effective = await service.resolveEffectivePolicy({ tenantId: 't1', strategyId: 'st-1', subscriptionId: 'sub-1' });
    expect(effective.maxOrderNotional).toBe('500');
    expect(effective.slippageToleranceBps).toBe(25);
    expect(effective.executionDelayMs).toBe(500);
    expect(effective.maxLeverage).toBe('5');
    expect(effective.stopLossBps).toBe(150);
    expect(effective.allowedSymbols).toEqual(['BTC-USDT']);
    expect(effective.blockedSymbols).toEqual(['*WITHDRAWAL*', 'DOGE-USDT']);
  });

  it('evaluates slippage bounds and execution delay deterministically (GAP-15)', async () => {
    const { service } = build();
    const effective = await service.resolveEffectivePolicy({ tenantId: 't1', strategyId: 'st-1', subscriptionId: 'sub-1' });

    const withinTolerance = service.evaluateSlippageAndDelay({
      policy: effective,
      leaderPrice: '50000',
      executionPrice: '50050', // +10 bps on BUY <= 25 bps
      side: 'BUY',
      leaderTimestamp: '2026-10-03T12:00:00.000Z',
    });
    expect(withinTolerance).toMatchObject({
      allowed: true,
      ruleId: null,
      slippageBps: 10,
      effectiveDelayMs: 500,
      scheduledReleaseAt: '2026-10-03T12:00:00.500Z',
    });

    const exceeded = service.evaluateSlippageAndDelay({
      policy: effective,
      leaderPrice: '50000',
      executionPrice: '50250', // +50 bps on BUY > 25 bps
      side: 'BUY',
      leaderTimestamp: '2026-10-03T12:00:00.000Z',
    });
    expect(exceeded).toMatchObject({
      allowed: false,
      ruleId: 'SLIPPAGE_TOLERANCE_EXCEEDED',
      slippageBps: 50,
    });
  });

  it('computes TP/SL prices, trailing stop distance, and stop-copy condition triggers (GAP-17)', async () => {
    const { service } = build({
      subscriptionPolicy: {
        takeProfitBps: 200, // +2%
        stopLossBps: 100, // -1%
        trailingStopBps: 50, // 0.5%
        stopCopyConditions: { maxDrawdownPercent: '10', maxCumulativeLoss: '500' },
      },
    });
    const effective = await service.resolveEffectivePolicy({ tenantId: 't1', strategyId: 'st-1', subscriptionId: 'sub-1' });
    const plan = service.resolveStopPolicy({
      policy: effective,
      entryPrice: '50000',
      side: 'BUY',
      currentDrawdownPercent: '12',
      cumulativeLoss: '200',
    });
    expect(plan).toEqual({
      takeProfitPrice: '51000',
      stopLossPrice: '49500',
      trailingStopBps: 50,
      trailingStopDistance: '250',
      trailingActivationPrice: '51000',
      stopCopyTriggered: true,
      stopCopyReason: 'Stop-copy drawdown threshold 10% reached (current 12%)',
    });
  });

  it('computes exit prices as exact decimals rather than by scaling a double', async () => {
    const { service } = build();
    const effective = await service.resolveEffectivePolicy({ tenantId: 't1' });
    // 50000 * 2101/10000 = 10505 exactly. Through a double the same expression pays 10505.000000000002
    // on some entries, which is not a price the venue will accept at the tick size.
    const plan = service.resolveStopPolicy({
      policy: { ...effective, takeProfitBps: 2101, stopLossBps: 3, trailingStopBps: 0 },
      entryPrice: '50000',
      side: 'BUY',
    });
    expect(plan.takeProfitPrice).toBe('60505');
    expect(plan.stopLossPrice).toBe('49985');
  });

  it('refuses an exit price that would be zero instead of instructing the venue to exit at 0', async () => {
    const { service } = build();
    const effective = await service.resolveEffectivePolicy({ tenantId: 't1' });
    // A 100% stop-loss distance leaves no positive price: 50000 * (1 - 1) = 0.
    const plan = service.resolveStopPolicy({
      policy: { ...effective, takeProfitBps: null, stopLossBps: 10000, trailingStopBps: null },
      entryPrice: '50000',
      side: 'BUY',
    });
    expect(plan.stopLossPrice).toBeNull();
  });

  it('validates symbol rules and names the rules that could never match or that contradict each other', async () => {
    const { service } = build();
    const effective = await service.resolveEffectivePolicy({ tenantId: 't1' });

    // The platform deny rule is a glob and is valid; a validator that rejected it would be telling
    // operators to delete the one rule that blocks withdrawal-like instruments.
    expect(service.validateSymbolRules({ ...effective, allowedSymbols: ['BTC-USDT'], blockedSymbols: ['*WITHDRAWAL*'] })).toEqual({ valid: true, errors: [] });

    const whitespace = service.validateSymbolRules({ ...effective, allowedSymbols: ['BTC USDT'], blockedSymbols: null });
    expect(whitespace.valid).toBe(false);
    expect(whitespace.errors.join(' ')).toContain('never match a symbol');

    const contradictory = service.validateSymbolRules({ ...effective, allowedSymbols: ['BTC-USDT'], blockedSymbols: ['BTC-USDT'] });
    expect(contradictory.valid).toBe(false);
    expect(contradictory.errors.join(' ')).toContain('appears in both allowedSymbols and blockedSymbols');

    const swallowed = service.validateSymbolRules({ ...effective, allowedSymbols: ['BTC-USDT'], blockedSymbols: ['BTC*'] });
    expect(swallowed.valid).toBe(false);
    expect(swallowed.errors.join(' ')).toContain('no symbol can satisfy both');

    const blockEverything = service.validateSymbolRules({ ...effective, allowedSymbols: null, blockedSymbols: ['*'] });
    expect(blockEverything.valid).toBe(false);
    expect(blockEverything.errors.join(' ')).toContain("blockedSymbols '*' blocks every symbol");

    const empty = service.validateSymbolRules({ ...effective, allowedSymbols: [''], blockedSymbols: null });
    expect(empty.valid).toBe(false);
    expect(empty.errors.join(' ')).toContain('empty rule');
  });
});

describe('CustodyVisibilityService.checkAccess (CLIENT scope)', () => {
  it('denies when wallet ownership cannot be verified (it used to allow)', async () => {
    const prisma = {
      custodyWallet: {
        findFirst: jest.fn(async () => {
          throw new Error('db unavailable');
        }),
      },
    };
    const service = new CustodyVisibilityService(prisma as never);
    await expect(
      service.checkAccess({
        tenantId: 't1',
        requesterTenantId: 't1',
        scope: CustodyScope.CLIENT,
        resourceTenantId: 't1',
        walletId: 'w-1',
        clientProfileId: 'cp-1',
      }),
    ).resolves.toEqual({ allowed: false, reason: 'Wallet ownership could not be verified' });
  });
});
