// # Verifies the global active-copy budget: REDUCE to the exact remainder, BLOCK at zero, shared budgets, tenant ceiling, tenant isolation, stale equity and float-free arithmetic over 1,000 evaluations.
import { CopyBudgetService, CopyBudgetReasonCode, COPY_BUDGET_EQUITY_MAX_AGE_MS, COPY_BUDGET_TENANT_SETTING_KEY, evaluateCopyBudget, type CopyBudgetLimits } from './copy-budget.service';
import { Decimal } from '../../common/decimal-string';

/** Decimal arithmetic is tested as an estimate. Production evaluation must
 * block configured budgets until live exposure and atomic reservations exist. */

interface QueryArgs {
  where?: Record<string, unknown>;
}

interface FakeOptions {
  budgets?: Array<{ tenantId: string; userId: string; maxActiveExposure: string; perTraderCap: string | null; currency?: string; updatedAt?: Date }>;
  subscriptions?: Array<{ id: string; tenantId: string; followerId: string; traderId: string; state: string; allocationAmount: string; allocationMode?: string }>;
  tenantSettings?: Array<{ tenantId: string; key: string; value: unknown }>;
  accounts?: Array<{ id: string; tenantId: string; userId: string; deletedAt?: Date | null }>;
  equityMicros?: bigint | null;
  failOn?: 'budget' | 'subscription' | 'account' | 'setting' | 'snapshot';
}

function fakePrisma(options: FakeOptions = {}) {
  const equalTo = <T extends Record<string, unknown>>(rows: T[], where: Record<string, unknown> | undefined): T[] => {
    if (!where) return rows;
    return rows.filter((row) => Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true;
      if (key === 'deletedAt' && value === null) return row.deletedAt === undefined || row.deletedAt === null;
      if (value !== null && typeof value === 'object' && 'in' in (value as Record<string, unknown>)) {
        return (value as { in: unknown[] }).in.includes((row as Record<string, unknown>)[key]);
      }
      return (row as Record<string, unknown>)[key] === value;
    }));
  };
  const boom = (which: string) => async () => {
    if (options.failOn === which) throw new Error(`${which} unavailable`);
    return which === 'snapshot' ? null : [];
  };
  const prisma = {
    $queryRaw: jest.fn(async () => []),
    user: { findFirst: jest.fn(async (args: QueryArgs) => ({ id: args.where?.id })) },
    copyBudget: {
      findFirst: options.failOn === 'budget'
        ? boom('budget')
        : jest.fn(async (args: QueryArgs) => {
          const row = equalTo(options.budgets ?? [], args.where)[0];
          return row ? { ...row, currency: row.currency ?? 'USDT' } : null;
        }),
      upsert: jest.fn(async () => ({})),
    },
    copySubscription: {
      findMany: options.failOn === 'subscription'
        ? boom('subscription')
        : jest.fn(async (args: QueryArgs) => equalTo(options.subscriptions ?? [], args.where).map((row) => ({ ...row, allocationMode: row.allocationMode ?? 'FIXED' }))),
    },
    tenantSetting: {
      findFirst: options.failOn === 'setting'
        ? boom('setting')
        : jest.fn(async (args: QueryArgs) => equalTo(options.tenantSettings ?? [], args.where)[0] ?? null),
    },
    tradingAccount: {
      findMany: options.failOn === 'account'
        ? boom('account')
        : jest.fn(async (args: QueryArgs) => equalTo(options.accounts ?? [], args.where).map(({ id }) => ({ id }))),
    },
    accountBalanceSnapshot: {
      findFirst: options.failOn === 'snapshot'
        ? boom('snapshot')
        : jest.fn(async () => (options.equityMicros === undefined || options.equityMicros === null
          ? null
          : { observedAtMicros: options.equityMicros })),
    },
  };
  return {
    ...prisma,
    withTenantRls: async (_tenant: string, work: (tx: typeof prisma) => unknown) => work(prisma),
  };
}

const NOW = new Date('2026-10-26T09:00:00.000Z');
const freshEquity = BigInt(NOW.getTime()) * 1000n;

function service(options: FakeOptions = {}): CopyBudgetService {
  return new CopyBudgetService(fakePrisma(options) as never);
}

function intent(overrides: Partial<Parameters<CopyBudgetService['evaluate']>[0]> = {}) {
  return {
    tenantId: 'tenant-1',
    userId: 'user-1',
    subscriptionId: 'sub-1',
    traderId: 'trader-1',
    notional: '1000',
    quantity: '0.02',
    price: '50000',
    currency: 'USDT',
    ...overrides,
  };
}

describe('CopyBudgetService.evaluate', () => {
  it('keeps reduction arithmetic as an estimate while blocking production execution', async () => {
    const budget = service({
      budgets: [{ tenantId: 'tenant-1', userId: 'user-1', maxActiveExposure: '10000', perTraderCap: null }],
      subscriptions: [{ id: 'sub-a', tenantId: 'tenant-1', followerId: 'user-1', traderId: 'trader-1', state: 'ACTIVE', allocationAmount: '9500' }],
      accounts: [{ id: 'acct-1', tenantId: 'tenant-1', userId: 'user-1' }],
      equityMicros: freshEquity,
    });

    const decision = await budget.evaluate(intent({ notional: '2000', quantity: '0.04' }), NOW);

    expect(decision).toMatchObject({ decision: 'BLOCK', reasonCode: 'BLOCKED_EXPOSURE_UNVERIFIED',
      effectiveCap: '10000', committed: null, remaining: null, allowedNotional: '0', reducedQuantity: null });
    const estimate = evaluateCopyBudget({ intent: intent({ notional: '2000', quantity: '0.04' }),
      limits: { maxActiveExposure: '10000', perTraderCap: null, tenantCeiling: null, currency: 'USDT' },
      activeExposures: [{ subscriptionId: 'sub-a', traderId: 'trader-1', allocationAmount: '9500' }],
      equityObservedAt: NOW, now: NOW });
    expect(estimate).toMatchObject({ decision: 'REDUCE', allowedNotional: '500', reducedQuantity: '0.01' });
  });

  it('does not claim verified exhaustion from allocation estimates', async () => {
    const budget = service({
      budgets: [{ tenantId: 'tenant-1', userId: 'user-1', maxActiveExposure: '5000', perTraderCap: null }],
      subscriptions: [
        { id: 'sub-a', tenantId: 'tenant-1', followerId: 'user-1', traderId: 'trader-1', state: 'ACTIVE', allocationAmount: '3000' },
        { id: 'sub-b', tenantId: 'tenant-1', followerId: 'user-1', traderId: 'trader-2', state: 'ACTIVE', allocationAmount: '2000' },
      ],
      accounts: [{ id: 'acct-1', tenantId: 'tenant-1', userId: 'user-1' }],
      equityMicros: freshEquity,
    });

    const decision = await budget.evaluate(intent(), NOW);

    expect(decision.decision).toBe('BLOCK');
    expect(decision.reasonCode).toBe(CopyBudgetReasonCode.BLOCKED_EXPOSURE_UNVERIFIED);
    expect(decision.remaining).toBeNull();
    expect(decision.allowedNotional).toBe('0');
    expect(decision.reducedQuantity).toBeNull();
  });

  it('blocks concurrent copies rather than pretending allocation estimates reserve headroom', async () => {
    const budget = service({
      budgets: [{ tenantId: 'tenant-1', userId: 'user-1', maxActiveExposure: '1000', perTraderCap: null }],
      subscriptions: [{ id: 'sub-a', tenantId: 'tenant-1', followerId: 'user-1', traderId: 'trader-1', state: 'ACTIVE', allocationAmount: '600' }],
      accounts: [{ id: 'acct-1', tenantId: 'tenant-1', userId: 'user-1' }], equityMicros: freshEquity,
    });
    const results = await Promise.all([
      budget.evaluate(intent({ subscriptionId: 'sub-b', notional: '400', quantity: '0.008' }), NOW),
      budget.evaluate(intent({ subscriptionId: 'sub-c', notional: '400', quantity: '0.008' }), NOW),
    ]);
    expect(results).toHaveLength(2);
    for (const result of results) expect(result).toMatchObject({ decision: 'BLOCK', reasonCode: 'BLOCKED_EXPOSURE_UNVERIFIED', committed: null, remaining: null, allowedNotional: '0' });
    expect(await budget.getView('tenant-1', 'user-1')).toMatchObject({ committed: '600', exposureStatus: 'ALLOCATION_ESTIMATE' });
  });

  it('applies the tenant ceiling when it is tighter than the follower cap', async () => {
    const budget = service({
      budgets: [{ tenantId: 'tenant-1', userId: 'user-1', maxActiveExposure: '100000', perTraderCap: null }],
      tenantSettings: [{ tenantId: 'tenant-1', key: COPY_BUDGET_TENANT_SETTING_KEY, value: { amount: '20000', currency: 'USDT' } }],
      subscriptions: [{ id: 'sub-a', tenantId: 'tenant-1', followerId: 'user-1', traderId: 'trader-1', state: 'ACTIVE', allocationAmount: '19000' }],
      accounts: [{ id: 'acct-1', tenantId: 'tenant-1', userId: 'user-1' }],
      equityMicros: freshEquity,
    });

    const decision = await budget.evaluate(intent({ notional: '5000', quantity: '0.1' }), NOW);

    expect(decision).toMatchObject({ effectiveCap: '20000', decision: 'BLOCK',
      reasonCode: 'BLOCKED_EXPOSURE_UNVERIFIED', allowedNotional: '0', reducedQuantity: null });
  });

  it("never reads another tenant's budget or subscriptions", async () => {
    const budget = service({
      budgets: [
        { tenantId: 'tenant-2', userId: 'user-1', maxActiveExposure: '1', perTraderCap: null },
        { tenantId: 'tenant-1', userId: 'user-1', maxActiveExposure: '5000', perTraderCap: null },
      ],
      subscriptions: [
        { id: 'sub-other-tenant', tenantId: 'tenant-2', followerId: 'user-1', traderId: 'trader-1', state: 'ACTIVE', allocationAmount: '4999' },
      ],
      accounts: [{ id: 'acct-1', tenantId: 'tenant-1', userId: 'user-1' }],
      equityMicros: freshEquity,
    });

    const decision = await budget.evaluate(intent({ notional: '1000', quantity: '0.02' }), NOW);

    expect(decision).toMatchObject({ effectiveCap: '5000', committed: null, decision: 'BLOCK', reasonCode: 'BLOCKED_EXPOSURE_UNVERIFIED' });
    // The other tenant is absent from the explicitly labeled allocation estimate.
    expect(await budget.getView('tenant-1', 'user-1')).toMatchObject({ committed: '0', exposureStatus: 'ALLOCATION_ESTIMATE' });
  });

  it('BLOCKs on a stale equity snapshot and never falls back to the last known value', async () => {
    const staleMicros = (BigInt(NOW.getTime()) - BigInt(COPY_BUDGET_EQUITY_MAX_AGE_MS + 1) * 1000n) * 1000n;
    const budget = service({
      budgets: [{ tenantId: 'tenant-1', userId: 'user-1', maxActiveExposure: '10000', perTraderCap: null }],
      accounts: [{ id: 'acct-1', tenantId: 'tenant-1', userId: 'user-1' }],
      equityMicros: staleMicros,
    });

    const decision = await budget.evaluate(intent(), NOW);

    expect(decision.decision).toBe('BLOCK');
    expect(decision.reasonCode).toBe(CopyBudgetReasonCode.BLOCKED_EQUITY_STALE);
    expect(decision.allowedNotional).toBe('0');
  });

  it('BLOCKs when no equity snapshot exists at all', async () => {
    const budget = service({
      budgets: [{ tenantId: 'tenant-1', userId: 'user-1', maxActiveExposure: '10000', perTraderCap: null }],
      accounts: [{ id: 'acct-1', tenantId: 'tenant-1', userId: 'user-1' }],
      equityMicros: null,
    });

    const decision = await budget.evaluate(intent(), NOW);
    expect(decision.reasonCode).toBe(CopyBudgetReasonCode.BLOCKED_EQUITY_UNKNOWN);
  });

  it('BLOCKs when the budget cannot be read instead of treating it as unlimited', async () => {
    const budget = service({ failOn: 'budget' });
    const decision = await budget.evaluate(intent(), NOW);
    expect(decision.decision).toBe('BLOCK');
    expect(decision.reasonCode).toBe(CopyBudgetReasonCode.BLOCKED_BUDGET_UNREADABLE);
  });

  it('blocks malformed or mismatched tenant ceilings instead of treating them as absent', async () => {
    for (const ceiling of [{ amount: 'bad', currency: 'USDT' }, { amount: '1', currency: 'BTC' }]) {
      const budget = service({
        budgets: [{ tenantId: 'tenant-1', userId: 'user-1', maxActiveExposure: '10000', perTraderCap: null, currency: 'USDT' }],
        tenantSettings: [{ tenantId: 'tenant-1', key: COPY_BUDGET_TENANT_SETTING_KEY, value: ceiling }],
        accounts: [{ id: 'acct-1', tenantId: 'tenant-1', userId: 'user-1' }],
        equityMicros: freshEquity,
      });
      expect(await budget.evaluate(intent(), NOW)).toMatchObject({ decision: 'BLOCK', reasonCode: 'BLOCKED_BUDGET_UNREADABLE' });
      await expect(budget.getView('tenant-1', 'user-1')).rejects.toMatchObject({ status: 503 });
    }
  });

  it('does not invent a quote currency when no budget or tenant ceiling is configured', async () => {
    const view = await service().getView('tenant-1', 'user-1');
    expect(view).toMatchObject({ currency: null, maxActiveExposure: null, tenantCeiling: null, effectiveCap: null });
  });

  it('permits an otherwise valid unconfigured budget decision without claiming verified exposure', async () => {
    const budget = service({ accounts: [{ id: 'acct-1', tenantId: 'tenant-1', userId: 'user-1' }], equityMicros: freshEquity });
    expect(await budget.evaluate(intent(), NOW)).toMatchObject({ decision: 'ALLOW', reasonCode: 'ALLOW_NO_BUDGET_CONFIGURED', committed: null, remaining: null });
  });

  it('never adds percentage allocation ratios to money as if they were exposure', async () => {
    const budget = service({
      budgets: [{ tenantId: 'tenant-1', userId: 'user-1', maxActiveExposure: '100', perTraderCap: null, currency: 'USDT' }],
      subscriptions: [{ id: 'sub-a', tenantId: 'tenant-1', followerId: 'user-1', traderId: 'trader-1', state: 'ACTIVE', allocationMode: 'PERCENTAGE_BALANCE', allocationAmount: '10' }],
      accounts: [{ id: 'acct-1', tenantId: 'tenant-1', userId: 'user-1' }], equityMicros: freshEquity,
    });
    expect(await budget.evaluate(intent(), NOW)).toMatchObject({ decision: 'BLOCK', reasonCode: 'BLOCKED_BUDGET_UNREADABLE' });
    expect(await budget.getView('tenant-1', 'user-1')).toMatchObject({ committed: null, remaining: null, utilisationBps: null, exposureStatus: 'UNAVAILABLE', effectiveCap: '100' });
  });

  it('blocks a snapshot from the future rather than treating it as fresh', async () => {
    const budget = service({
      accounts: [{ id: 'acct-1', tenantId: 'tenant-1', userId: 'user-1' }],
      equityMicros: BigInt(NOW.getTime() + 1000) * 1000n,
    });
    expect(await budget.evaluate(intent(), NOW)).toMatchObject({ decision: 'BLOCK', reasonCode: 'BLOCKED_EQUITY_STALE' });
  });

  it('BLOCKs a copy whose quote asset is not the budget currency', async () => {
    const budget = service({
      budgets: [{ tenantId: 'tenant-1', userId: 'user-1', maxActiveExposure: '10000', perTraderCap: null, currency: 'USDT' }],
      accounts: [{ id: 'acct-1', tenantId: 'tenant-1', userId: 'user-1' }],
      equityMicros: freshEquity,
    });

    const decision = await budget.evaluate(intent({ currency: 'BTC' }), NOW);
    expect(decision.reasonCode).toBe(CopyBudgetReasonCode.BLOCKED_CURRENCY_MISMATCH);
  });

  it('is byte-identical across 1,000 evaluations (no float drift)', async () => {
    const limits: CopyBudgetLimits = { maxActiveExposure: '10000.10', perTraderCap: null, tenantCeiling: null, currency: 'USDT' };
    const exposures = [
      { subscriptionId: 'sub-a', traderId: 'trader-1', allocationAmount: '3333.333333333333' },
      { subscriptionId: 'sub-b', traderId: 'trader-2', allocationAmount: '3333.333333333333' },
      { subscriptionId: 'sub-c', traderId: 'trader-3', allocationAmount: '0.000000000001' },
    ];
    const first = evaluateCopyBudget({
      intent: intent({ notional: '4000', quantity: '0.08' }),
      limits,
      activeExposures: exposures,
      equityObservedAt: NOW,
      now: NOW,
    });

    let seen = first;
    for (let index = 0; index < 1000; index += 1) {
      seen = evaluateCopyBudget({
        intent: intent({ notional: '4000', quantity: '0.08' }),
        limits,
        activeExposures: exposures,
        equityObservedAt: NOW,
        now: NOW,
      });
      if (JSON.stringify(seen) !== JSON.stringify(first)) {
        throw new Error(`evaluation ${index} drifted: ${JSON.stringify(seen)} !== ${JSON.stringify(first)}`);
      }
    }

    // 3333.333333333333 + 3333.333333333333 + 0.000000000001 = 6666.666666666667
    expect(seen.committed).toBe('6666.666666666667');
    // 10000.10 - 6666.666666666667 = 3333.433333333333, and 4000 does not fit
    // under it, so the answer is the remainder rather than the request. A REDUCE
    // spends the whole usable remainder, so `remaining` afterwards is 0 by
    // definition and `allowedNotional` is the number that was handed out.
    expect(seen.allowedNotional).toBe('3333.433333333333');
    expect(seen.remaining).toBe('0');
    expect(seen.decision).toBe('REDUCE');
    // Floored at 18 places: 0.08 * 3333.433333333333 / 4000. A float
    // evaluation of the same expression lands on ...6666666666 and prints
    // 0.06666866666666667; this value is the exact floor, and it is the same on
    // every one of the 1,000 evaluations above.
    expect(seen.reducedQuantity).toBe('0.06666866666666666');
    // And the answer is a decimal string, not a float that prints like one.
    expect(Decimal.parse(seen.reducedQuantity as string).toString()).toBe('0.06666866666666666');
  });

  it('blocks even when an estimated per-trader remainder exists', async () => {
    const budget = service({
      budgets: [{ tenantId: 'tenant-1', userId: 'user-1', maxActiveExposure: '10000', perTraderCap: '1000' }],
      subscriptions: [
        { id: 'sub-a', tenantId: 'tenant-1', followerId: 'user-1', traderId: 'trader-1', state: 'ACTIVE', allocationAmount: '900' },
        { id: 'sub-b', tenantId: 'tenant-1', followerId: 'user-1', traderId: 'trader-2', state: 'ACTIVE', allocationAmount: '5000' },
      ],
      accounts: [{ id: 'acct-1', tenantId: 'tenant-1', userId: 'user-1' }],
      equityMicros: freshEquity,
    });

    const decision = await budget.evaluate(intent({ traderId: 'trader-1', notional: '500', quantity: '0.01' }), NOW);
    expect(decision).toMatchObject({ decision: 'BLOCK', reasonCode: 'BLOCKED_EXPOSURE_UNVERIFIED',
      committed: null, remaining: null, allowedNotional: '0', reducedQuantity: null });
  });

  it('allows an unbounded follower but still refuses without fresh equity', async () => {
    const budget = service({ accounts: [{ id: 'acct-1', tenantId: 'tenant-1', userId: 'user-1' }], equityMicros: freshEquity });
    const decision = await budget.evaluate(intent(), NOW);
    expect(decision.decision).toBe('ALLOW');
    expect(decision.reasonCode).toBe(CopyBudgetReasonCode.ALLOW_NO_BUDGET_CONFIGURED);
    expect(decision.allowedNotional).toBe('1000');
    expect(decision.effectiveCap).toBeNull();
  });
});
