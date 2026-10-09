// # Verifies copy execution dispatch gates, kill-switch scopes, compliance blocks, and OMS routing
/**
 * Phase 3: a validated copy execution is DISPATCHED through the OMS.
 *
 * Before this change the service marked VALIDATED -> MAPPED -> RISK_CHECKED ->
 * ROUTED and created no order at all. These tests pin that:
 *   - a copy execution ends ROUTED only after createIntent AND routeIntent
 *     succeeded, and carries the canonical order id;
 *   - every OMS refusal / failure is recorded on the copy execution;
 *   - without the OMS wired, the execution fails closed (OMS_NOT_WIRED);
 *   - the idempotency key is deterministic (no Date.now()).
 */

import { BadRequestException, ForbiddenException } from '@nestjs/common';

import {
  CopyExecutionService,
  accountKillSwitchBlocker,
  eventKillSwitchBlocker,
  copyEnvironmentFor,
  copyIdempotencyKey,
  copyOrderTypeFor,
} from './copy-execution.service';
import { CopyExecutionStatus, CopyRiskDecision } from './copy-trading.types';

const LEADER_EVENT = {
  eventId: 'evt-1',
  orderId: 'lord-1',
  fillId: null,
  symbol: 'BTC-USDT',
  exchangeSymbol: 'BTCUSDT',
  side: 'BUY',
  type: 'MARKET',
  quantity: '1',
  price: '50000',
  venue: 'BINANCE',
  timestamp: '2026-09-28T00:00:00.000Z',
  isSimulated: true,
};

const SUBSCRIPTION = {
  id: 'sub-1',
  followerId: 'user-f',
  followerAccountId: 'acct-f',
  allocationAmount: '1000',
  allocationMode: 'FIXED',
  maxAllocation: null,
  minAllocation: null,
  riskPolicy: {},
};

interface Harness {
  service: CopyExecutionService;
  statuses: Array<{ status: CopyExecutionStatus; extra?: Record<string, unknown> }>;
  created: any[];
  createIntent: jest.Mock;
  routeIntent: jest.Mock;
}

function harness(options: {
  wired?: boolean;
  createIntent?: jest.Mock;
  routeIntent?: jest.Mock;
  followerType?: string;
  sandbox?: boolean;
  traderProfile?: { userId: string; verificationState: string } | null;
  complianceBlockedUserId?: string;
  /** Make a pre-dispatch lookup throw. */
  failing?: 'compliance' | 'health' | 'killSwitch' | 'maintenance' | 'followerAccount';
  health?: Array<{ venue: string; state: string }>;
  inMaintenance?: boolean;
  /** Engaged kill-switch rows returned by the lookup. */
  killSwitches?: Array<{ id?: string; scope: string; target: string | null; tenantId: string | null }>;
} = {}): Harness {
  const boom = (what: string) => async () => {
    if (options.failing === what) throw new Error(`${what} lookup failed`);
    return null;
  };
  const statuses: Harness['statuses'] = [];
  const created: any[] = [];
  const prisma = {
    tradingAccount: {
      findFirst: jest.fn(async () => {
        if (options.failing === 'followerAccount') throw new Error('followerAccount lookup failed');
        return { id: 'acct-f', isSandbox: options.sandbox ?? true };
      }),
    },
    killSwitch: {
      findMany: jest.fn(async () => {
        if (options.failing === 'killSwitch') throw new Error('killSwitch lookup failed');
        return options.killSwitches ?? [];
      }),
    },
    traderProfile: {
      findFirst: jest.fn(async (args: any) =>
        args.where.id === 'trader-1' && args.where.tenantId === 'tenant-1'
          ? options.traderProfile === undefined
            ? { userId: 'trader-user-1', verificationState: 'VERIFIED' }
            : options.traderProfile
          : null,
      ),
    },
    complianceCase: {
      findFirst: jest.fn(async (args: any) => {
        if (options.failing === 'compliance') throw new Error('compliance lookup failed');
        return options.complianceBlockedUserId && args.where.userId === options.complianceBlockedUserId ? { id: 'case-1' } : null;
      }),
    },
    copyTradingAuditLog: { create: jest.fn(async () => ({})) },
  };
  const subscriptionRepo = {
    listActive: jest.fn(async () => ({ data: [SUBSCRIPTION], total: 1 })),
    updateState: jest.fn(async () => ({})),
  };
  const executionRepo = {
    findByLeaderEventAndSubscription: jest.fn(async () => null),
    create: jest.fn(async (input: any) => {
      const row = { id: `exec-${created.length + 1}`, status: CopyExecutionStatus.PENDING, ...input };
      created.push(row);
      return row;
    }),
    updateStatus: jest.fn(async (_id: string, _tenant: string, status: CopyExecutionStatus, extra?: Record<string, unknown>) => {
      statuses.push({ status, extra });
      return {};
    }),
  };
  const policyService = { resolveEffectivePolicy: jest.fn(async () => ({ slippageToleranceBps: 50, maxOrderNotional: null })) };
  // The dispatch tests cover the *gates* around mapping (kill switches, venue
  // health, OMS wiring), not the sizing arithmetic - that now lives in
  // copy-order-mapper.service.spec.ts. The mapper is therefore stubbed at its
  // public entry point, which returns a tagged result so a refusal can be
  // recorded with its reason.
  const orderMapper = {
    planLeaderToFollower: jest.fn(async () => ({
      ok: true as const,
      intent: {
        symbol: 'BTC-USDT',
        exchangeSymbol: 'BTCUSDT',
        side: 'BUY',
        type: options.followerType ?? 'MARKET',
        quantity: '0.02',
        price: '50000',
        stopPrice: null,
        notional: '1000',
        slippageUpper: null,
        slippageLower: null,
        isReduceOnly: false,
        executionDelayMs: 0,
        sizingMode: 'FIXED',
        source: 'COPY',
      },
    })),
  };
  const allocationService = {
    getAvailableBalance: jest.fn(async () => '10000'),
    validateAllocation: jest.fn(async () => ({ valid: true })),
  };
  const riskService = { checkRisk: jest.fn(async () => ({ decision: CopyRiskDecision.ALLOW, ruleId: null, reason: null })) };
  const exchangeRouting = {};
  const exchangeHealth = {
    listHealthByTenant: jest.fn(async () => {
      if (options.failing === 'health') throw new Error('health lookup failed');
      return options.health ?? [];
    }),
  };
  const maintenance = {
    isInMaintenance: jest.fn(async () => {
      if (options.failing === 'maintenance') throw new Error('maintenance lookup failed');
      return options.inMaintenance === true;
    }),
  };
  const createIntent = options.createIntent ?? jest.fn(async () => ({ id: 'intent-1', clientOrderId: 'oms1' }));
  const routeIntent = options.routeIntent ?? jest.fn(async () => ({ intentId: 'intent-1', jobId: 'oms-submit-oms1', canonicalOrderId: 'order-1' }));
  const wired = options.wired ?? true;
  const service = new CopyExecutionService(
    prisma as any,
    subscriptionRepo as any,
    executionRepo as any,
    policyService as any,
    orderMapper as any,
    allocationService as any,
    riskService as any,
    exchangeRouting as any,
    exchangeHealth as any,
    maintenance as any,
    { append: jest.fn(async () => ({ id: 'outbox-1' })) } as any,
    wired ? ({ createIntent } as any) : undefined,
    wired ? ({ routeIntent } as any) : undefined,
  );
  return { service, statuses, created, createIntent, routeIntent };
}

async function run(h: Harness) {
  return h.service.processLeaderEvent({ tenantId: 'tenant-1', leaderEvent: LEADER_EVENT as any, traderId: 'trader-1', strategyId: 'strategy-1' });
}

describe('copy execution dispatch (Phase 3)', () => {
  it('creates and routes an OMS intent, then records ROUTED with the canonical order', async () => {
    const h = harness();
    const outcome = await run(h);
    expect(outcome.processed).toBe(1);
    expect(h.createIntent).toHaveBeenCalledTimes(1);
    const intentArgs = h.createIntent.mock.calls[0][0];
    expect(intentArgs).toMatchObject({
      tenantId: 'tenant-1',
      accountId: 'acct-f',
      symbol: 'BTC-USDT',
      side: 'BUY',
      orderType: 'MARKET',
      quantity: '0.02',
      price: null,
      environment: 'PAPER',
      source: 'COPY_TRADING',
      followerId: 'user-f',
      subscriptionId: 'sub-1',
      metadata: { copyExecutionId: 'exec-1', leaderEventId: 'evt-1' },
    });
    expect(h.routeIntent).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', intentId: 'intent-1' }));
    const last = h.statuses[h.statuses.length - 1];
    expect(last.status).toBe(CopyExecutionStatus.ROUTED);
    expect(last.extra).toMatchObject({ followerOrderId: 'order-1' });
    expect(outcome.executions[0]).toMatchObject({ status: CopyExecutionStatus.ROUTED, orderId: 'order-1', omsIntentId: 'intent-1' });
    expect(h.created[0].idempotencyKey).toBe('copy_tenant-1_evt-1_sub-1');
  });

  it('ROUTED is never recorded before the OMS accepted the order', async () => {
    const h = harness({ routeIntent: jest.fn(async () => { throw new ForbiddenException('Live gate BLOCK'); }) });
    const outcome = await run(h);
    expect(h.statuses.map((s) => s.status)).not.toContain(CopyExecutionStatus.ROUTED);
    const last = h.statuses[h.statuses.length - 1];
    expect(last.status).toBe(CopyExecutionStatus.REJECTED);
    expect(String(last.extra?.failureReason)).toMatch(/Live gate BLOCK/);
    expect(outcome.blocked).toBe(1);
  });

  it('an intent refusal (risk/compliance/precision) is recorded as REJECTED and routing is not attempted', async () => {
    const h = harness({ createIntent: jest.fn(async () => { throw new BadRequestException('Risk blocked: DAILY_LOSS'); }) });
    await run(h);
    expect(h.routeIntent).not.toHaveBeenCalled();
    const last = h.statuses[h.statuses.length - 1];
    expect(last.status).toBe(CopyExecutionStatus.REJECTED);
    expect(String(last.extra?.failureReason)).toMatch(/OMS_INTENT_REFUSED: Risk blocked/);
  });

  it('an operational routing failure is FAILED, not REJECTED', async () => {
    const h = harness({ routeIntent: jest.fn(async () => { throw new Error('redis down'); }) });
    await run(h);
    const last = h.statuses[h.statuses.length - 1];
    expect(last.status).toBe(CopyExecutionStatus.FAILED);
  });

  it('without the OMS wired the execution fails closed as OMS_NOT_WIRED', async () => {
    const h = harness({ wired: false });
    await run(h);
    const last = h.statuses[h.statuses.length - 1];
    expect(last.status).toBe(CopyExecutionStatus.FAILED);
    expect(String(last.extra?.failureReason)).toMatch(/OMS_NOT_WIRED/);
  });

  it('a stop order copy is refused before the OMS is called', async () => {
    const h = harness({ followerType: 'STOP' });
    await run(h);
    expect(h.createIntent).not.toHaveBeenCalled();
    expect(h.statuses[h.statuses.length - 1].status).toBe(CopyExecutionStatus.REJECTED);
  });

  it('pure helpers: idempotency key, environment and order type', () => {
    expect(copyIdempotencyKey('t', 'e', 's')).toBe('copy_t_e_s');
    expect(copyEnvironmentFor({ isSandbox: true })).toBe('PAPER');
    expect(copyEnvironmentFor({ isSandbox: false })).toBe('LIVE');
    expect(copyEnvironmentFor(null)).toBe('PAPER');
    expect(copyEnvironmentFor({})).toBe('PAPER');
    expect(copyOrderTypeFor('market')).toBe('MARKET');
    expect(copyOrderTypeFor('LIMIT')).toBe('LIMIT');
    expect(copyOrderTypeFor('STOP_LIMIT')).toBeNull();
    expect(copyOrderTypeFor(undefined)).toBeNull();
  });

  describe('trader gate (compliance subject is the trader\'s user)', () => {
    it('a compliance BLOCK on the trader\'s user stops the copy before any execution', async () => {
      const h = harness({ complianceBlockedUserId: 'trader-user-1' });
      const outcome = await run(h);
      expect(outcome).toEqual({ processed: 0, skipped: 0, blocked: 1, executions: [] });
      expect(h.created).toHaveLength(0);
      expect(h.createIntent).not.toHaveBeenCalled();
    });

    it('a BLOCK recorded against the profile id (not a user) does not count, the user one does', async () => {
      const h = harness({ complianceBlockedUserId: 'trader-1' });
      expect((await run(h)).blocked).toBe(0);
    });

    it('a suspended or rejected trader is not copied', async () => {
      for (const verificationState of ['SUSPENDED', 'REJECTED']) {
        const h = harness({ traderProfile: { userId: 'trader-user-1', verificationState } });
        expect((await run(h)).blocked).toBe(1);
        expect(h.created).toHaveLength(0);
      }
    });

    it('an unknown trader (or one from another tenant) fails closed', async () => {
      const h = harness({ traderProfile: null });
      expect(await run(h)).toEqual({ processed: 0, skipped: 0, blocked: 1, executions: [] });
    });
  });
});

/**
 * Pre-dispatch gates fail closed. The compliance, exchange-health and kill
 * switch lookups used to swallow their errors (compliance unless the message
 * contained 'BLOCK') and the copy went on to the OMS; the testnet/live check
 * did the same per follower. Trading maintenance was not checked at all.
 */
describe('copy execution pre-dispatch gates', () => {
  const run = (h: Harness) =>
    h.service.processLeaderEvent({ tenantId: 'tenant-1', leaderEvent: LEADER_EVENT as any, traderId: 'trader-1', strategyId: 'strat-1' });

  it.each(['compliance', 'health', 'killSwitch', 'maintenance'] as const)('a failing %s lookup blocks the event, no order', async (failing) => {
    const h = harness({ failing });
    await expect(run(h)).resolves.toEqual({ processed: 0, skipped: 0, blocked: 1, executions: [] });
    expect(h.createIntent).not.toHaveBeenCalled();
  });

  it('an active trading maintenance window blocks the event', async () => {
    const h = harness({ inMaintenance: true });
    await expect(run(h)).resolves.toMatchObject({ processed: 0, blocked: 1 });
    expect(h.createIntent).not.toHaveBeenCalled();
  });

  it("only an outage of the leader's venue blocks; another follower's AUTH_FAILED or another venue does not", async () => {
    const outage = harness({ health: [{ venue: 'BINANCE', state: 'UNAVAILABLE' }] });
    await expect(run(outage)).resolves.toMatchObject({ blocked: 1, processed: 0 });
    expect(outage.createIntent).not.toHaveBeenCalled();

    const unrelated = harness({
      health: [
        { venue: 'BINANCE', state: 'AUTH_FAILED' },
        { venue: 'KRAKEN', state: 'UNAVAILABLE' },
      ],
    });
    await expect(run(unrelated)).resolves.toMatchObject({ processed: 1, blocked: 0 });
    expect(unrelated.createIntent).toHaveBeenCalledTimes(1);
  });

  it('a follower whose paper/live mode cannot be read is BLOCKED, not dispatched', async () => {
    const h = harness({ failing: 'followerAccount' });
    const result = await run(h);
    expect(result).toMatchObject({ processed: 0, blocked: 1 });
    expect(result.executions[0]).toMatchObject({ status: CopyExecutionStatus.BLOCKED });
    expect(result.executions[0].failureReason).toContain('FOLLOWER_ACCOUNT_UNREADABLE');
    expect(h.createIntent).not.toHaveBeenCalled();
  });
});

/**
 * Round 7 C4: kill switches are matched to the event and the follower account
 * (engine semantics) instead of any engaged row halting the whole tenant.
 */
describe('copy execution kill-switch scope', () => {
  const run = (h: Harness) =>
    h.service.processLeaderEvent({ tenantId: 'tenant-1', leaderEvent: LEADER_EVENT as any, traderId: 'trader-1', strategyId: 'strat-1' });
  const ks = (scope: string, target: string | null, tenantId: string | null = 'tenant-1') => ({ id: `ks-${scope}`, scope, target, tenantId });

  it.each([
    ['GLOBAL (tenant)', ks('GLOBAL', null)],
    ['GLOBAL (platform)', ks('GLOBAL', null, null)],
    ["EXCHANGE on the leader's venue", ks('EXCHANGE', 'binance')],
    ['EXCHANGE platform-wide on the venue', ks('EXCHANGE', 'BINANCE', null)],
    ['STRATEGY on this strategy', ks('STRATEGY', 'strat-1')],
    ['SYMBOL on this instrument', ks('SYMBOL', 'BTC/USDT')],
    ['SYMBOL on the exchange symbol', ks('SYMBOL', 'BTCUSDT')],
    ['a non-GLOBAL switch without a target', ks('SYMBOL', null)],
    ['an unknown scope', ks('SOMETHING_NEW', 'x')],
  ])('%s halts the event for every follower', async (_label, row) => {
    const h = harness({ killSwitches: [row] });
    await expect(run(h)).resolves.toEqual({ processed: 0, skipped: 0, blocked: 1, executions: [] });
    expect(h.createIntent).not.toHaveBeenCalled();
    expect(h.created).toHaveLength(0);
  });

  it('switches on another venue, strategy, symbol or follower account do not halt this copy', async () => {
    const h = harness({
      killSwitches: [
        ks('EXCHANGE', 'KRAKEN'),
        ks('STRATEGY', 'strat-2'),
        ks('SYMBOL', 'ETH-USDT'),
        ks('ACCOUNT', 'acct-other'),
        ks('RISK', 'account:acct-other'),
      ],
    });
    await expect(run(h)).resolves.toMatchObject({ processed: 1, blocked: 0 });
    expect(h.createIntent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['ACCOUNT', 'acct-f'],
    ['RISK', 'account:acct-f'],
  ])("a %s switch on the follower's account blocks that follower only, recorded BLOCKED", async (scope, target) => {
    const h = harness({ killSwitches: [ks(scope, target)] });
    const result = await run(h);
    expect(result).toMatchObject({ processed: 0, blocked: 1 });
    expect(result.executions[0]).toMatchObject({ status: CopyExecutionStatus.BLOCKED });
    expect(h.statuses).toEqual([
      { status: CopyExecutionStatus.BLOCKED, extra: { failureReason: `${scope} kill switch engaged for ${target}` } },
    ]);
    expect(h.created[0].executionIntent).toMatchObject({ reason: 'KILL_SWITCH', scope, target });
    expect(h.createIntent).not.toHaveBeenCalled();
  });

  it('pure matchers follow the engine targets', () => {
    const event = { venue: 'BINANCE', strategyId: 'strat-1', symbol: 'BTC-USDT', exchangeSymbol: 'BTCUSDT' };
    expect(eventKillSwitchBlocker([], event)).toBeNull();
    expect(eventKillSwitchBlocker([ks('ACCOUNT', 'acct-f')], event)).toBeNull();
    expect(eventKillSwitchBlocker([ks('SYMBOL', 'ETHUSDT'), ks('EXCHANGE', 'Binance')], event)).toMatchObject({ scope: 'EXCHANGE' });
    expect(accountKillSwitchBlocker([ks('RISK', 'acct-f')], 'acct-f')).toBeNull();
    expect(accountKillSwitchBlocker([ks('RISK', 'account:acct-f')], 'acct-f')).toMatchObject({ scope: 'RISK' });
    expect(accountKillSwitchBlocker([ks('ACCOUNT', 'acct-f')], null)).toBeNull();
  });
});

