import {
  copyRows,
  copyTradingAdminApi as api,
  DECIMAL_MONEY,
  HIGH_WATER_MARK_SCOPES,
  LEADER_FEE_CURRENCIES,
} from '@/api/copy-trading-admin-api';
import { apiClient } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const key = 'copy-key-1';
const opts = { idempotencyKey: key };
const base = '/v1/copy-trading';

afterEach(() => jest.clearAllMocks());

describe('trader profile routes', () => {
  it('creates a profile, reads the caller profile and updates one by encoded id', () => {
    const input = { displayName: 'Trader One', supportedVenues: ['BINANCE'], isPublic: true };
    void api.createTraderProfile(input, key);
    void api.getMyTraderProfile();
    void api.updateTraderProfile('t/1', { displayName: 'Trader Two' }, key);

    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${base}/traders/profile`, input, opts);
    expect(apiClient.get).toHaveBeenCalledWith(`${base}/traders/profile/me`);
    expect(apiClient.put).toHaveBeenCalledWith(`${base}/traders/t%2F1/profile`, { displayName: 'Trader Two' }, opts);
  });

  it('verifies a trader with no body but with a key, and lists their subscriptions', () => {
    void api.verifyTrader('trad-1', key);
    void api.listTraderSubscriptions('trad-1', 2, 10);

    expect(apiClient.post).toHaveBeenCalledWith(`${base}/traders/trad-1/verify`, undefined, opts);
    expect(apiClient.get).toHaveBeenCalledWith(`${base}/traders/trad-1/subscriptions`, { searchParams: { page: 2, limit: 10 } });
  });
});

describe('strategy lifecycle routes', () => {
  it('creates a strategy and drives each transition with its own key', () => {
    void api.createStrategy({ traderId: 'trad-1', name: 'Momentum', supportedSymbols: ['BTC-USDT'], supportedVenues: ['BINANCE'] }, key);
    void api.updateStrategy('s-1', { name: 'Momentum v2' }, key);
    void api.publishStrategy('s-1', key);
    void api.pauseStrategy('s-1', key);
    void api.resumeStrategy('s-1', key);
    void api.archiveStrategy('s-1', key);

    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${base}/strategies`, expect.objectContaining({ traderId: 'trad-1' }), opts);
    expect(apiClient.put).toHaveBeenCalledWith(`${base}/strategies/s-1`, { name: 'Momentum v2' }, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `${base}/strategies/s-1/publish`, undefined, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(3, `${base}/strategies/s-1/pause`, undefined, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(4, `${base}/strategies/s-1/resume`, undefined, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(5, `${base}/strategies/s-1/archive`, undefined, opts);
  });
});

describe('valuation, policy and budget', () => {
  it('requires a quote asset on the valuation call and sends it as a query parameter', () => {
    void api.getPortfolioValuation('USDT', 'acct-1', true);

    expect(apiClient.get).toHaveBeenCalledWith(`${base}/portfolio-valuation`, {
      searchParams: { quoteAsset: 'USDT', accountId: 'acct-1', includeSimulated: true },
    });
  });

  it('reads the platform policy and featured rankings', () => {
    void api.getPlatformPolicy();
    void api.getFeaturedRankings(5);

    expect(apiClient.get).toHaveBeenNthCalledWith(1, `${base}/policies/platform`);
    expect(apiClient.get).toHaveBeenNthCalledWith(2, `${base}/rankings/featured`, { searchParams: { limit: 5 } });
  });

  it('sends the budget cap as an exact decimal string', () => {
    const input = { maxActiveExposure: '10000.50000000', perTraderCap: '500.00', currency: 'USDT' };
    void api.upsertBudget(input, key);

    expect(apiClient.put).toHaveBeenCalledWith(`${base}/budget`, input, opts);
    expect(DECIMAL_MONEY.test(input.maxActiveExposure)).toBe(true);
  });

  it('rejects string shapes the budget DTO would reject anyway', () => {
    expect(DECIMAL_MONEY.test('1e5')).toBe(false);
    expect(DECIMAL_MONEY.test('-10')).toBe(false);
    expect(DECIMAL_MONEY.test('10.')).toBe(false);
    expect(DECIMAL_MONEY.test('10.1234567890123')).toBe(false);
    expect(DECIMAL_MONEY.test('0')).toBe(true);
  });
});

describe('reconciliation and leader fees', () => {
  it('runs, lists and resolves copy reconciliation', () => {
    void api.runReconciliation({ limit: 50 }, key);
    void api.listReconciliationRecords({ resolved: false, severity: 'HIGH', limit: 20 });
    void api.resolveReconciliation('rec/1', 'Follower was below the minimum notional', key);

    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${base}/reconciliation/run`, { limit: 50 }, opts);
    expect(apiClient.get).toHaveBeenCalledWith(`${base}/reconciliation/records`, {
      searchParams: { resolved: false, severity: 'HIGH', limit: 20 },
    });
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `${base}/reconciliation/rec%2F1/resolve`, { notes: 'Follower was below the minimum notional' }, opts);
  });

  it('sends the leader fee idempotency key in the body as well as the header', () => {
    const input = { idempotencyKey: key, currency: 'USD', profitShareBps: 1500, highWaterMarkScope: 'PER_SUBSCRIBER' };
    void api.setLeaderFeePolicy('trad-1', input, key);

    expect(apiClient.post).toHaveBeenCalledWith(`${base.replace(base, '/v1/copy-trading/leader-fees')}/traders/trad-1`, input, opts);
    expect(input.idempotencyKey).toBe(key);
  });

  it('reads the public fee policy and its history per trader', () => {
    void api.getLeaderFeePolicy('trad-1', 'EUR');
    void api.getLeaderFeeHistory('trad-1');

    expect(apiClient.get).toHaveBeenNthCalledWith(1, '/v1/copy-trading/leader-fees/traders/trad-1', { searchParams: { currency: 'EUR' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(2, '/v1/copy-trading/leader-fees/traders/trad-1/history', { searchParams: { currency: 'USD' } });
  });

  it('exposes the enum values the DTOs accept', () => {
    expect(LEADER_FEE_CURRENCIES).toContain('USDT');
    expect(HIGH_WATER_MARK_SCOPES.length).toBeGreaterThan(0);
  });
});

describe('copyRows', () => {
  it('accepts a bare array, a page envelope and nothing at all', () => {
    expect(copyRows([{ id: 'a' }])).toHaveLength(1);
    expect(copyRows({ data: [{ id: 'a' }], total: 1 })).toHaveLength(1);
    expect(copyRows(null)).toEqual([]);
  });
});
