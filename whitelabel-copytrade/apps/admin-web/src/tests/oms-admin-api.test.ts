import { omsAdminApi as api, toRows } from '@/api/oms-admin-api';
import { apiClient } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const key = 'oms-intent-1';
const opts = { idempotencyKey: key };
const base = '/v1/oms';

afterEach(() => jest.clearAllMocks());

describe('order intent routes', () => {
  it('creates an intent with decimal-string quantities and a key', () => {
    const input = { accountId: 'acct-1', symbol: 'BTC-USDT', side: 'BUY' as const, orderType: 'LIMIT' as const, quantity: '0.50000000', price: '29000.00', environment: 'PAPER' as const };
    void api.createIntent(input, key);

    expect(apiClient.post).toHaveBeenCalledWith(`${base}/intents`, input, opts);
  });

  it('routes an intent with no body but with a key', () => {
    void api.routeIntent('i/1', key);

    expect(apiClient.post).toHaveBeenCalledWith(`${base}/intents/i%2F1/route`, undefined, opts);
  });

  it('lists intents with only the supplied filters', () => {
    void api.listIntents({ accountId: 'a', state: 'ACKNOWLEDGED', page: 2, limit: 20, symbol: '' });

    expect(apiClient.get).toHaveBeenCalledWith(`${base}/intents`, {
      searchParams: { accountId: 'a', state: 'ACKNOWLEDGED', page: 2, limit: 20 },
    });
  });

  it('reads one intent, its lifecycle, its fills and its latency', () => {
    void api.getIntent('i-1');
    void api.getLifecycle('i-1');
    void api.getFillsForIntent('i-1');
    void api.getLatency('i-1');

    expect(apiClient.get).toHaveBeenNthCalledWith(1, `${base}/intents/i-1`);
    expect(apiClient.get).toHaveBeenNthCalledWith(2, `${base}/intents/i-1/lifecycle`);
    expect(apiClient.get).toHaveBeenNthCalledWith(3, `${base}/intents/i-1/fills`);
    expect(apiClient.get).toHaveBeenNthCalledWith(4, `${base}/intents/i-1/latency`);
  });
});

describe('order operations', () => {
  it('cancels and replaces with the DTO fields the controller validates', () => {
    void api.cancelOrder({ intentId: 'i-1', reason: 'Operator cancelled after venue timeout' }, key);
    void api.replaceOrder({ intentId: 'i-1', reason: 'Reprice to market', newPrice: '28900.00' }, key);

    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${base}/orders/cancel`, { intentId: 'i-1', reason: 'Operator cancelled after venue timeout' }, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `${base}/orders/replace`, { intentId: 'i-1', reason: 'Reprice to market', newPrice: '28900.00' }, opts);
  });

  it('searches orders through the dedicated route', () => {
    void api.searchOrders({ search: 'BTC', venue: 'BINANCE', limit: 10 });

    expect(apiClient.get).toHaveBeenCalledWith(`${base}/orders`, { searchParams: { search: 'BTC', venue: 'BINANCE', limit: 10 } });
  });
});

describe('fills, trades and quality', () => {
  it('reads fills, trades and a single trade', () => {
    void api.listFills({ orderIntentId: 'i-1', page: 1 });
    void api.listTrades({ state: 'OPEN' });
    void api.getTrade('t/1');

    expect(apiClient.get).toHaveBeenNthCalledWith(1, `${base}/fills`, { searchParams: { orderIntentId: 'i-1', page: 1 } });
    expect(apiClient.get).toHaveBeenNthCalledWith(2, `${base}/trades`, { searchParams: { state: 'OPEN' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(3, `${base}/trades/t%2F1`);
  });

  it('reads execution quality and venue scores with their window', () => {
    void api.getExecutionQuality({ venue: 'BINANCE', from: '2026-10-01', to: '2026-10-31' });
    void api.getVenueScores({ accountId: 'a-1' });

    expect(apiClient.get).toHaveBeenNthCalledWith(1, `${base}/execution-quality`, {
      searchParams: { venue: 'BINANCE', from: '2026-10-01', to: '2026-10-31' },
    });
    expect(apiClient.get).toHaveBeenNthCalledWith(2, `${base}/venue-scores`, { searchParams: { accountId: 'a-1' } });
  });

  it('reads rejections and their statistics for an explicit window', () => {
    void api.getRejections({ category: 'VENUE_REJECTED', limit: 25 });
    void api.getRejectionStats('2026-10-01', '2026-10-31');

    expect(apiClient.get).toHaveBeenNthCalledWith(1, `${base}/rejections`, { searchParams: { category: 'VENUE_REJECTED', limit: 25 } });
    expect(apiClient.get).toHaveBeenNthCalledWith(2, `${base}/rejections/stats`, { searchParams: { from: '2026-10-01', to: '2026-10-31' } });
  });
});

describe('reconciliation routes', () => {
  it('reads every reconciliation scope the controller exposes', () => {
    void api.reconcileOrder('o-1');
    void api.reconcileFills('o-1', 'i-1');
    void api.reconcilePosition('a-1', 'BTC-USDT');
    void api.reconcileAccountPositions('a-1');
    void api.getReconQueue({ state: 'OPEN' });

    expect(apiClient.get).toHaveBeenNthCalledWith(1, `${base}/reconciliation/orders/o-1`);
    expect(apiClient.get).toHaveBeenNthCalledWith(2, `${base}/reconciliation/fills/o-1`, { searchParams: { intentId: 'i-1' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(3, `${base}/reconciliation/positions/a-1/BTC-USDT`);
    expect(apiClient.get).toHaveBeenNthCalledWith(4, `${base}/reconciliation/positions/a-1`);
    expect(apiClient.get).toHaveBeenNthCalledWith(5, `${base}/reconciliation/queue`, { searchParams: { state: 'OPEN' } });
  });

  it('starts a reconciliation sweep and acknowledges a finding, both with keys', () => {
    void api.reconcileOrders({ accountId: 'a-1', limit: 50 }, key);
    void api.acknowledgeReconciliation({ reconciliationId: 'r-1', resolutionNote: 'Venue confirmed the fill', resolution: 'RESOLVED' }, key);

    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${base}/reconciliation/orders`, { accountId: 'a-1', limit: 50 }, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `${base}/reconciliation/acknowledge`, { reconciliationId: 'r-1', resolutionNote: 'Venue confirmed the fill', resolution: 'RESOLVED' }, opts);
  });
});

describe('operational routes', () => {
  it('reads stale and rejected operational records', () => {
    void api.getStaleOrders('a-1');
    void api.getRejectedOperational('a-1');

    expect(apiClient.get).toHaveBeenNthCalledWith(1, `${base}/operational/stale-orders`, { searchParams: { accountId: 'a-1' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(2, `${base}/operational/rejected-orders`, { searchParams: { accountId: 'a-1' } });
  });

  it('retries, recovers, acknowledges and notes, each with a key', () => {
    void api.requestRetry({ intentId: 'i-1', reason: 'Venue timeout, retriable' }, key);
    void api.requestRecovery({ intentId: 'i-1', recoveryType: 'CANCEL_AND_REPLACE', reason: 'Manual recovery' }, key);
    void api.acknowledgeException({ operationalId: 'op-1', note: 'Handled with venue support' }, key);
    void api.addOperatorNote({ operationalId: 'op-1', note: 'Escalated to treasury' }, key);

    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${base}/operational/retry`, { intentId: 'i-1', reason: 'Venue timeout, retriable' }, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `${base}/operational/recovery`, { intentId: 'i-1', recoveryType: 'CANCEL_AND_REPLACE', reason: 'Manual recovery' }, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(3, `${base}/operational/acknowledge-exception`, { operationalId: 'op-1', note: 'Handled with venue support' }, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(4, `${base}/operational/note`, { operationalId: 'op-1', note: 'Escalated to treasury' }, opts);
  });
});

describe('allocations, post-trade and audit', () => {
  it('reads allocations and their summary', () => {
    void api.getAllocations({ strategyId: 's-1', symbol: 'BTC-USDT' });
    void api.getAllocationSummary({ traderId: 't-1' });

    expect(apiClient.get).toHaveBeenNthCalledWith(1, `${base}/allocations`, { searchParams: { strategyId: 's-1', symbol: 'BTC-USDT' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(2, `${base}/allocations/summary`, { searchParams: { traderId: 't-1' } });
  });

  it('runs post-trade once per intent under a key', () => {
    void api.processPostTrade('i/1', key);

    expect(apiClient.post).toHaveBeenCalledWith(`${base}/post-trade/i%2F1`, undefined, opts);
  });

  it('reads audit history globally and per intent', () => {
    void api.getAuditForIntent('i-1');
    void api.getAuditHistory({ eventType: 'STATE_TRANSITION', page: 1, limit: 50 });

    expect(apiClient.get).toHaveBeenNthCalledWith(1, `${base}/audit/i-1`);
    expect(apiClient.get).toHaveBeenNthCalledWith(2, `${base}/audit`, { searchParams: { eventType: 'STATE_TRANSITION', page: 1, limit: 50 } });
  });
});

describe('recovery console', () => {
  it('reads the order timeline from the admin controller', () => {
    void api.getOrderTimeline('o/1');

    expect(apiClient.get).toHaveBeenCalledWith('/v1/admin/oms/orders/o%2F1/timeline');
  });

  it('recovers an order to an explicit target state', () => {
    const input = { targetState: 'CANCELED', reason: 'Venue never acknowledged the submission' };
    void api.recoverOrder('o-1', input, key);

    expect(apiClient.post).toHaveBeenCalledWith('/v1/admin/oms/orders/o-1/recover', input, opts);
  });

  it('mints an ORDER_RECOVERY proof and refuses a proof for another action', async () => {
    jest.mocked(apiClient.post).mockResolvedValueOnce({
      proofId: 'p', action: 'ORDER_RECOVERY', method: 'TOTP', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await api.requestRecoveryProof('TOTP', '123456', 'proof-key');
    expect(apiClient.post).toHaveBeenCalledWith('/v1/auth/step-up/verify', { action: 'ORDER_RECOVERY', method: 'TOTP', code: '123456' }, { idempotencyKey: 'proof-key' });

    jest.mocked(apiClient.post).mockResolvedValueOnce({
      proofId: 'p', action: 'CUSTODY_SWEEP', method: 'TOTP', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await expect(api.requestRecoveryProof('TOTP', '123456', 'proof-key')).rejects.toThrow('Invalid verification response');
  });
});

describe('row normalisation', () => {
  it('accepts a bare array and a page envelope without guessing', () => {
    expect(toRows([{ id: 'a' }])).toEqual({ rows: [{ id: 'a' }], total: 1 });
    expect(toRows({ data: [{ id: 'a' }], total: 42 })).toEqual({ rows: [{ id: 'a' }], total: 42 });
    expect(toRows(null)).toEqual({ rows: [], total: 0 });
  });
});
