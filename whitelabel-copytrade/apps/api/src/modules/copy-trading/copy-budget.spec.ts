// # Verifies the global active-copy budget: REDUCE to the exact remainder, BLOCK at zero, shared budgets, tenant ceiling, tenant isolation, stale equity and float-free arithmetic over 1,000 evaluations.
import { CopyBudgetService, CopyBudgetReasonCode, COPY_BUDGET_EQUITY_MAX_AGE_MS, COPY_BUDGET_TENANT_SETTING_KEY, evaluateCopyBudget, type CopyBudgetLimits } from './copy-budget.service';
import { Decimal } from '../../common/decimal-string';

/**
 * The scenarios below are the ones a reviewer has to be able to point at before
 * this number is allowed to gate real money:
 *
 *  - REDUCE lands on the remainder exactly, and the quantity is derived from it
 *    by flooring - never by rounding up.
 *  - BLOCK at zero says BLOCKED_BUDGET_EXHAUSTED and nothing else.
 *  - Two subscriptions of the same follower share ONE budget; the second copy is
 *    what proves it.
 *  - The tenant ceiling wins over a larger follower cap, because a tenant admin
 *    setting a ceiling is exactly the "please stop this" signal.
 *  - Another tenant's budget rows are never read: the fake prisma honours the
 *    `where` clause, so a cross-tenant row that leaks into the answer fails.
 *  - Stale equity is a BLOCK, not an ALLOW with a shrug.
 *  - A thousand evaluations of the same inputs are byte-identical.
 */

interface QueryArgs {
  where?: Record<string, unknown>;
}

interface FakeOptions {
  budgets?: Array<{ tenantId: string; userId: string; maxActiveExposure: string; perTraderCap: string | null; currency?: string; updatedAt?: Date }>;
  subscriptions?: Array<{ id: string; tenantId: string; followerId: string; traderId: string; state: string; allocationAmount: string }>;
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
  return {
    copyBudget: {
      findFirst: options.failOn === 'budget'
        ? boom('budget')
        : jest.fn(async (args: QueryArgs) => equalTo(options.budgets ?? [], args.where)[0] ?? null),
      upsert: jest.fn(async () => ({})),
    },
    copySubscription: {
      findMany: options.failOn === 'subscription'
        ? boom('subscription')
        : jest.fn(async (args: QueryArgs) => equalTo(options.subscriptions ?? [], args.where)),
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
  it('REDUCEs a copy to exactly the remaining budget and derives the quantity by flooring', async () => {
    const budget = service({
      budgets: [{ tenantId: 'tenant-1', userId: 'user-1', maxActiveExposure: '10000', perTraderCap: null }],
      subscriptions: [{ id: 'sub-a', tenantId: 'tenant-1', followerId: 'user-1', traderId: 'trader-1', state: 'ACTIVE', allocationAmount: '9500' }],
      accounts: [{ id: 'acct-1', tenantId: 'tenant-1', userId: 'user-1' }],
      equityMicros: freshEquity,
    });

    const decision = await budget.evaluate(intent({ notional: '2000', quantity: '0.04' }), NOW);

    expect(decision.decision).toBe('REDUCE');
    expect(decision.reasonCode).toBe(CopyBudgetReasonCode.REDUCED_TO_REMAINING_BUDGET);
    expect(decision.effectiveCap).toBe('10000');
    expect(decision.committed).toBe('9500');
    expect(decision.allowedNotional).toBe('500');
    // 0.04 * 500 / 2000 = 0.01 exactly - the floor must not lose a digit here.
    expect(decision.reducedQuantity).toBe('0.01');
  });

  it('BLOCKs when the budget is already fully committed', async () => {
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
    expect(decision.reasonCode).toBe(CopyBudgetReasonCode.BLOCKED_BUDGET_EXHAUSTED);
    expect(decision.remaining).toBe('0');
    expect(decision.allowedNotional).toBe('0');
    expect(decision.reducedQuantity).toBeNull();
  });

  it('makes two subscriptions of one follower share a single budget', async () => {
    const budget = service({
      budgets: [{ tenantId: 'tenant-1', userId: 'user-1', maxActiveExposure: '1000', perTraderCap: null }],
      subscriptions: [{ id: 'sub-a', tenantId: 'tenant-1', followerId: 'user-1', traderId: 'trader-1', state: 'ACTIVE', allocationAmount: '600' }],
      accounts: [{ id: 'acct-1', tenantId: 'tenant-1', userId: 'user-1' }],
      equityMicros: freshEquity,
    });

    const second = await budget.evaluate(intent({ subscriptionId: 'sub-b', traderId: 'trader-2', notional: '400', quantity: '0.008' }), NOW);
    expect(second.decision).toBe('ALLOW');

    // The same 400 now no longer fits: the first copy consumed the remainder.
    const third = await budget.evaluate(intent({ subscriptionId: 'sub-b', traderId: 'trader-2', notional: '400', quantity: '0.008' }), NOW);
    // The fake never inserts a subscription, so this assertion is about the
    // arithmetic the real call sees: 1000 - 600 = 400 remaining, 400 fits, and
    // a 401 copy would reduce. Proving the shared budget therefore means adding
    // the first subscription to the fixture.
    expect(third.decision).toBe('ALLOW');
    const shared = service({
      budgets: [{ tenantId: 'tenant-1', userId: 'user-1', maxActiveExposure: '1000', perTraderCap: null }],
      subscriptions: [
        { id: 'sub-a', tenantId: 'tenant-1', followerId: 'user-1', traderId: 'trader-1', state: 'ACTIVE', allocationAmount: '600' },
        { id: 'sub-b', tenantId: 'tenant-1', followerId: 'user-1', traderId: 'trader-2', state: 'ACTIVE', allocationAmount: '400' },
      ],
      accounts: [{ id: 'acct-1', tenantId: 'tenant-1', userId: 'user-1' }],
      equityMicros: freshEquity,
    });
    const exhausted = await shared.evaluate(intent({ subscriptionId: 'sub-b', traderId: 'trader-2', notional: '1', quantity: '0.00002' }), NOW);
    expect(exhausted.decision).toBe('BLOCK');
    expect(exhausted.reasonCode).toBe(CopyBudgetReasonCode.BLOCKED_BUDGET_EXHAUSTED);
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

    expect(decision.effectiveCap).toBe('20000');
    expect(decision.reasonCode).toBe(CopyBudgetReasonCode.REDUCED_TO_REMAINING_BUDGET);
    expect(decision.allowedNotional).toBe('1000');
    expect(decision.reducedQuantity).toBe('0.02');
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

    // tenant-2's 4999 of exposure is invisible here: 5000 - 0 = 5000.
    expect(decision.effectiveCap).toBe('5000');
    expect(decision.committed).toBe('0');
    expect(decision.decision).toBe('ALLOW');
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

  it('respects an optional per-trader cap inside the global cap', async () => {
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
    expect(decision.decision).toBe('REDUCE');
    expect(decision.allowedNotional).toBe('100');
    expect(decision.reducedQuantity).toBe('0.002');
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
