// # Verifies leader-event mapping, deduplication, staleness bounds, and missing-copy detection
/**
 * Phase 3: leader-event ingestion + missing-copy reconciliation.
 */

import { LeaderEventSourceService, isCopyOrder, leaderEventFromFill, subscriptionWasLiveAt } from './leader-event-source.service';
import { LeaderEventIngestionService } from './leader-event-ingestion.service';
import { CopyReconciliationService } from './copy-reconciliation.service';
import { CopyReconciliationCategory } from './copy-trading.types';

const T = 'tenant-1';
const NOW = new Date('2026-09-28T12:00:00.000Z');

function fill(id: string, secondsAgo: number, order: Partial<Record<string, unknown>> = {}) {
  const at = new Date(NOW.getTime() - secondsAgo * 1000);
  return {
    id,
    price: '65000.5',
    quantity: '0.010',
    isSimulated: false,
    exchangeTimestampMicros: BigInt(at.getTime()) * 1000n,
    createdAt: at,
    order: {
      id: `order-${id}`,
      tenantId: T,
      accountId: 'leader-acct',
      symbol: 'BTCUSDT',
      side: 'BUY',
      venue: 'BINANCE',
      isSimulated: false,
      wasDryRun: false,
      metadata: {},
      ...order,
    },
  };
}

const STRATEGY = { id: 'strat-1', traderId: 'trader-1', userId: 'leader-user', supportedSymbols: [], supportedVenues: [], strategyConfig: {} };

function fakePrisma(opts: { fills: any[]; subscriptions: any[]; executions?: any[] }) {
  return {
    tradingAccount: { findMany: jest.fn(async () => [{ id: 'leader-acct' }]) },
    fill: {
      findMany: jest.fn(async ({ where }: any) =>
        opts.fills.filter((f) => f.createdAt >= where.createdAt.gte && f.createdAt <= where.createdAt.lte),
      ),
    },
    traderStrategy: { findMany: jest.fn(async () => [STRATEGY]) },
    copySubscription: {
      findMany: jest.fn(async ({ where, distinct }: any) => {
        const rows = opts.subscriptions.filter((s) => (!where?.state || s.state === where.state) && (!where?.tenantId || s.tenantId === where.tenantId));
        return distinct ? [...new Set(rows.map((r) => r.tenantId))].map((tenantId) => ({ tenantId })) : rows;
      }),
    },
    copyExecution: {
      findMany: jest.fn(async ({ where }: any) =>
        (opts.executions ?? []).filter((e) => !where.leaderEventId?.in || where.leaderEventId.in.includes(e.leaderEventId)),
      ),
    },
    copyReconciliationRecord: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => data),
    },
  };
}

const LIVE_SUB = { id: 'sub-1', tenantId: T, strategyId: 'strat-1', traderId: 'trader-1', followerId: 'f-1', followerAccountId: 'f-acct', state: 'ACTIVE', startedAt: new Date('2026-09-01T00:00:00Z') };

describe('leader-event mapping helpers', () => {
  it('maps a fill to a stable, market-following leader event', () => {
    const { event, occurredAt } = leaderEventFromFill(fill('f1', 5));
    expect(event).toEqual({
      eventId: 'fill:f1',
      orderId: 'order-f1',
      fillId: 'f1',
      symbol: 'BTCUSDT',
      exchangeSymbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: '0.010',
      price: '65000.5',
      stopPrice: null,
      venue: 'BINANCE',
      timestamp: '2026-09-28T11:59:55.000Z',
      isSimulated: false,
    });
    expect(occurredAt.toISOString()).toBe('2026-09-28T11:59:55.000Z');
  });

  it('recognises copy orders by the OMS copyExecutionId stamp', () => {
    expect(isCopyOrder({ copyExecutionId: 'ce-1' })).toBe(true);
    expect(isCopyOrder({})).toBe(false);
    expect(isCopyOrder(null)).toBe(false);
  });

  it('subscriptionWasLiveAt honours start, stop, cancel, expiry and pause', () => {
    const at = new Date('2026-09-10T00:00:00Z');
    expect(subscriptionWasLiveAt({ startedAt: '2026-09-01' }, at)).toBe(true);
    expect(subscriptionWasLiveAt({ startedAt: '2026-09-11' }, at)).toBe(false);
    expect(subscriptionWasLiveAt({}, at)).toBe(false);
    expect(subscriptionWasLiveAt({ startedAt: '2026-09-01', stoppedAt: '2026-09-05' }, at)).toBe(false);
    expect(subscriptionWasLiveAt({ startedAt: '2026-09-01', stoppedAt: '2026-09-15' }, at)).toBe(true);
    expect(subscriptionWasLiveAt({ startedAt: '2026-09-01', cancelledAt: '2026-09-02' }, at)).toBe(false);
    expect(subscriptionWasLiveAt({ startedAt: '2026-09-01', expiresAt: '2026-09-09' }, at)).toBe(false);
    expect(subscriptionWasLiveAt({ startedAt: '2026-09-01', state: 'PAUSED', pausedAt: '2026-09-05' }, at)).toBe(false);
  });
});

describe('LeaderEventSourceService', () => {
  it('excludes copy orders, dry runs and symbols/venues outside the strategy', async () => {
    const prisma = fakePrisma({
      fills: [
        fill('own', 5),
        fill('copy', 5, { metadata: { copyExecutionId: 'ce-9' } }),
        fill('dry', 5, { wasDryRun: true }),
        fill('eth', 5, { symbol: 'ETHUSDT' }),
      ],
      subscriptions: [],
    });
    const source = new LeaderEventSourceService(prisma as any);
    const records = await source.listForStrategy(T, { ...STRATEGY, supportedSymbols: ['btcusdt'] }, new Date(NOW.getTime() - 60_000), NOW);
    expect(records.map((r) => r.event.eventId)).toEqual(['fill:own']);
    expect(records[0]).toMatchObject({ strategyId: 'strat-1', traderId: 'trader-1' });
  });
});

describe('LeaderEventIngestionService', () => {
  function build(opts: { fills: any[]; subscriptions: any[]; executions?: any[] }) {
    const prisma = fakePrisma(opts);
    const copyExecution = { processLeaderEvent: jest.fn(async () => ({ processed: 1, skipped: 0, blocked: 0, executions: [] })) };
    const service = new LeaderEventIngestionService(prisma as any, new LeaderEventSourceService(prisma as any), copyExecution as any);
    return { service, copyExecution };
  }

  it('dispatches a fresh leader fill once to the copy pipeline', async () => {
    const { service, copyExecution } = build({ fills: [fill('f1', 3)], subscriptions: [LIVE_SUB] });
    const result = await service.sweep(NOW);
    expect(result).toEqual({ events: 1, dispatched: 1, alreadyCopied: 0, expired: 0 });
    expect(copyExecution.processLeaderEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: T, traderId: 'trader-1', strategyId: 'strat-1', leaderEvent: expect.objectContaining({ eventId: 'fill:f1' }) }),
    );
  });

  it('does not re-process an event every live subscription already has an execution for', async () => {
    const { service, copyExecution } = build({
      fills: [fill('f1', 3)],
      subscriptions: [LIVE_SUB],
      executions: [{ leaderEventId: 'fill:f1', subscriptionId: 'sub-1' }],
    });
    await expect(service.ingestTenant(T, NOW)).resolves.toMatchObject({ dispatched: 0, alreadyCopied: 1 });
    expect(copyExecution.processLeaderEvent).not.toHaveBeenCalled();
  });

  it('never copies a fill older than the max age (left for reconciliation)', async () => {
    const { service, copyExecution } = build({ fills: [fill('old', 33)], subscriptions: [LIVE_SUB] });
    await expect(service.ingestTenant(T, NOW)).resolves.toMatchObject({ dispatched: 0, expired: 1 });
    expect(copyExecution.processLeaderEvent).not.toHaveBeenCalled();
  });

  it('never replays history into a subscription that started after the fill', async () => {
    const { service, copyExecution } = build({ fills: [fill('f1', 3)], subscriptions: [{ ...LIVE_SUB, startedAt: new Date(NOW.getTime() - 1000) }] });
    await expect(service.ingestTenant(T, NOW)).resolves.toMatchObject({ dispatched: 0, alreadyCopied: 1 });
    expect(copyExecution.processLeaderEvent).not.toHaveBeenCalled();
  });

  it('deduplicates repeated leader fill records in the same ingestion pass (GAP-19)', async () => {
    const { service, copyExecution } = build({ fills: [fill('f1', 3), fill('f1', 3)], subscriptions: [LIVE_SUB] });
    await expect(service.ingestTenant(T, NOW)).resolves.toEqual({ events: 2, dispatched: 1, alreadyCopied: 1, expired: 0 });
    expect(copyExecution.processLeaderEvent).toHaveBeenCalledTimes(1);
  });
});

describe('CopyReconciliationService missing-copy detection', () => {
  const realNow = Date.now;
  beforeAll(() => {
    Date.now = () => NOW.getTime();
  });
  afterAll(() => {
    Date.now = realNow;
  });

  function build(executions: any[], fills = [fill('missed', 120), fill('recent', 10)]) {
    const prisma = fakePrisma({ fills, subscriptions: [LIVE_SUB], executions });
    const subscriptionRepo = { listByTenant: jest.fn(async () => ({ data: [LIVE_SUB], total: 1 })) };
    const service = new CopyReconciliationService(prisma as any, {} as any, subscriptionRepo as any, new LeaderEventSourceService(prisma as any));
    return { service, prisma };
  }

  it('flags a leader fill with no execution for a live subscription, but not one still in flight', async () => {
    const { service, prisma } = build([]);
    const { records, summary } = await service.reconcileTenant(T, { from: new Date(NOW.getTime() - 3_600_000), to: NOW });
    expect(summary[CopyReconciliationCategory.MISSING_COPY]).toBe(1);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ leaderEventId: 'fill:missed', subscriptionId: 'sub-1', category: CopyReconciliationCategory.MISSING_COPY });
    expect(prisma.copyReconciliationRecord.create).toHaveBeenCalledTimes(1);
  });

  it('any recorded outcome (even SKIPPED) counts as answered', async () => {
    const { service } = build([{ leaderEventId: 'fill:missed', subscriptionId: 'sub-1', status: 'SKIPPED' }]);
    const { summary } = await service.reconcileTenant(T, { from: new Date(NOW.getTime() - 3_600_000), to: NOW });
    expect(summary[CopyReconciliationCategory.MISSING_COPY]).toBeUndefined();
  });

  it('without the leader-event store the check reports itself skipped', async () => {
    const prisma = fakePrisma({ fills: [], subscriptions: [LIVE_SUB] });
    const service = new CopyReconciliationService(prisma as any, {} as any, { listByTenant: async () => ({ data: [], total: 0 }) } as any);
    const { summary } = await service.reconcileTenant(T);
    expect(summary.MISSING_COPY_CHECK_SKIPPED).toBe(1);
  });
});
