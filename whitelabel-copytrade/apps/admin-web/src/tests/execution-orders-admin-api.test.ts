import { LIVE_TRADING_CONFIRMATION, executionOrdersAdminApi as api, executionRows } from '@/api/execution-orders-admin-api';
import { apiClient } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const key = 'exec-intent-1';
const opts = { idempotencyKey: key };
const base = '/v1/execution';

afterEach(() => jest.clearAllMocks());

describe('execution orders', () => {
  it('lists orders with only the supplied filters and reads one order with its children', () => {
    void api.listOrders({ accountId: 'a-1', status: 'OPEN', unreconciledOnly: true, symbol: '' });
    void api.getOrder('o/1');
    void api.listOrderEvents('o-1');
    void api.listOrderFills('o-1');

    expect(apiClient.get).toHaveBeenNthCalledWith(1, `${base}/orders`, {
      searchParams: { accountId: 'a-1', status: 'OPEN', unreconciledOnly: true },
    });
    expect(apiClient.get).toHaveBeenNthCalledWith(2, `${base}/orders/o%2F1`);
    expect(apiClient.get).toHaveBeenNthCalledWith(3, `${base}/orders/o-1/events`);
    expect(apiClient.get).toHaveBeenNthCalledWith(4, `${base}/orders/o-1/fills`);
  });

  it('cancels an order with a reason the DTO requires', () => {
    void api.cancelOrder('o-1', { reason: 'Operator cancelled after venue timeout' }, key);

    expect(apiClient.post).toHaveBeenCalledWith(`${base}/orders/o-1/cancel`, { reason: 'Operator cancelled after venue timeout' }, opts);
  });

  it('lists fills and positions', () => {
    void api.listFills({ accountId: 'a-1' });
    void api.listPositions({ includeFlat: false });

    expect(apiClient.get).toHaveBeenNthCalledWith(1, `${base}/fills`, { searchParams: { accountId: 'a-1' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(2, `${base}/positions`, { searchParams: { includeFlat: false } });
  });
});

describe('exchange accounts', () => {
  it('lists accounts and reads one with connectivity, balances and stream sessions', () => {
    void api.listAccounts({ venue: 'BINANCE', status: 'ACTIVE', page: 1, limit: 25 });
    void api.getAccount('acc/1');
    void api.getConnectivity('acc-1');
    void api.listBalances('acc-1', true);
    void api.listStreamSessions('acc-1');

    expect(apiClient.get).toHaveBeenNthCalledWith(1, `${base}/accounts`, {
      searchParams: { venue: 'BINANCE', status: 'ACTIVE', page: 1, limit: 25 },
    });
    expect(apiClient.get).toHaveBeenNthCalledWith(2, `${base}/accounts/acc%2F1`);
    expect(apiClient.get).toHaveBeenNthCalledWith(3, `${base}/accounts/acc-1/connectivity`);
    expect(apiClient.get).toHaveBeenNthCalledWith(4, `${base}/accounts/acc-1/balances`, { searchParams: { includeZero: true } });
    expect(apiClient.get).toHaveBeenNthCalledWith(5, `${base}/accounts/acc-1/stream-sessions`);
  });

  it('verifies, refreshes balances and resyncs the stream under a key', () => {
    void api.verifyAccount('acc-1', key);
    void api.refreshBalances('acc-1', key);
    void api.resyncStream('acc-1', key);

    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${base}/accounts/acc-1/verify`, undefined, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `${base}/accounts/acc-1/balances/refresh`, undefined, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(3, `${base}/accounts/acc-1/stream/resync`, undefined, opts);
  });

  it('toggles enabled and private stream with the reason the DTO requires', () => {
    void api.setEnabled('acc-1', { enabled: true, reason: 'Re-enable after review' }, key);
    void api.setPrivateStream('acc-1', { enabled: false, reason: 'Pausing stream during rotation' }, key);

    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${base}/accounts/acc-1/enabled`, { enabled: true, reason: 'Re-enable after review' }, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `${base}/accounts/acc-1/private-stream`, { enabled: false, reason: 'Pausing stream during rotation' }, opts);
  });

  it('arms live trading with the exact confirmation phrase and the reason', () => {
    void api.setLiveTrading('acc-1', { enabled: true, reason: 'Client signed the live trading agreement', confirmation: LIVE_TRADING_CONFIRMATION }, key);

    expect(apiClient.post).toHaveBeenCalledWith(
      `${base}/accounts/acc-1/live-trading`,
      { enabled: true, reason: 'Client signed the live trading agreement', confirmation: 'ENABLE LIVE TRADING' },
      opts,
    );
  });

  it('keeps the confirmation phrase the API validates against', () => {
    expect(LIVE_TRADING_CONFIRMATION).toBe('ENABLE LIVE TRADING');
  });
});

describe('row normalisation', () => {
  it('accepts a bare array or a page envelope', () => {
    expect(executionRows([{ id: 'a' }])).toEqual({ rows: [{ id: 'a' }], total: 1 });
    expect(executionRows({ data: [{ id: 'a' }], total: 7 })).toEqual({ rows: [{ id: 'a' }], total: 7 });
    expect(executionRows(null)).toEqual({ rows: [], total: 0 });
  });
});
