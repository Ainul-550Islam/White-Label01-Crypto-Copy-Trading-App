// # Responsibility: pins every portfolio-accounting route to its exact method and path, so a page cannot silently drift from the controller that serves it.

import { apiClient } from '@/api/api-client';
import { portfolioAccountingApi } from '@/api/portfolio-accounting-api';

jest.mock('@/api/api-client', () => ({ apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
const get = apiClient.get as jest.Mock;
const post = apiClient.post as jest.Mock;

beforeEach(() => {
  get.mockResolvedValue({ data: [], total: 0 });
  post.mockResolvedValue({ id: 'row-1', state: 'OPEN' });
});
afterEach(() => jest.resetAllMocks());

const BASE = '/v1/portfolio-accounting';

describe('read routes', () => {
  it.each([
    ['listProfiles', () => portfolioAccountingApi.listProfiles(), `${BASE}/profiles`],
    ['listEvents', () => portfolioAccountingApi.listEvents(), `${BASE}/events`],
    ['listCash', () => portfolioAccountingApi.listCash(), `${BASE}/cash`],
    ['getCashBalance', () => portfolioAccountingApi.getCashBalance(), `${BASE}/cash/balance`],
    ['listPositions', () => portfolioAccountingApi.listPositions(), `${BASE}/positions`],
    ['getHoldings', () => portfolioAccountingApi.getHoldings(), `${BASE}/holdings`],
    ['getNav', () => portfolioAccountingApi.getNav({ profileId: 'p-1' }), `${BASE}/nav`],
    ['getPnl', () => portfolioAccountingApi.getPnl({ profileId: 'p-1' }), `${BASE}/pnl`],
    ['getPerformance', () => portfolioAccountingApi.getPerformance({ profileId: 'p-1', methodology: 'TWR' }), `${BASE}/performance`],
    ['getAttribution', () => portfolioAccountingApi.getAttribution({ profileId: 'p-1', dimension: 'ASSET' }), `${BASE}/attribution`],
    ['listSnapshots', () => portfolioAccountingApi.listSnapshots({ profileId: 'p-1' }), `${BASE}/snapshots`],
    ['getSnapshot', () => portfolioAccountingApi.getSnapshot('snap-1'), `${BASE}/snapshots/snap-1`],
    ['listPeriods', () => portfolioAccountingApi.listPeriods({ profileId: 'p-1', state: 'OPEN' }), `${BASE}/periods`],
    ['listStatements', () => portfolioAccountingApi.listStatements({ profileId: 'p-1' }), `${BASE}/statements`],
    ['getStatement', () => portfolioAccountingApi.getStatement('stmt-1'), `${BASE}/statements/stmt-1`],
    ['exportStatement', () => portfolioAccountingApi.exportStatement('stmt-1', 'CSV'), `${BASE}/statements/stmt-1/export`],
    ['listAdjustments', () => portfolioAccountingApi.listAdjustments({ profileId: 'p-1' }), `${BASE}/adjustments`],
    ['listReconciliations', () => portfolioAccountingApi.listReconciliations({ profileId: 'p-1' }), `${BASE}/reconciliations`],
  ])('%s reads %s', async (_name, call, path) => {
    await call();

    expect(get.mock.calls[0]?.[0]).toBe(path);
  });

  it('passes the query through as search params and encodes path segments', async () => {
    await portfolioAccountingApi.exportStatement('statement/with slash', 'CSV');

    expect(get).toHaveBeenCalledWith(`${BASE}/statements/statement%2Fwith%20slash/export`, { searchParams: { format: 'CSV' } });
  });
});

describe('mutation routes', () => {
  it.each([
    ['createProfile', () => portfolioAccountingApi.createProfile({ scope: 'TENANT', scopeId: 'tenant-1', baseCurrency: 'USD' }, 'key-1'), `${BASE}/profiles`],
    ['createSnapshot', () => portfolioAccountingApi.createSnapshot({ profileId: 'p-1' }, 'key-2'), `${BASE}/snapshots`],
    ['createPeriod', () => portfolioAccountingApi.createPeriod({ profileId: 'p-1', startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-10-31T00:00:00.000Z' }, 'key-3'), `${BASE}/periods`],
    ['closePeriod', () => portfolioAccountingApi.closePeriod({ periodId: 'period-1' }, 'key-4'), `${BASE}/periods/close`],
    ['generateStatement', () => portfolioAccountingApi.generateStatement({ profileId: 'p-1', periodId: 'period-1' }, 'key-5'), `${BASE}/statements`],
    ['createAdjustment', () => portfolioAccountingApi.createAdjustment({ profileId: 'p-1', kind: 'FEE', amount: '1.000000000000', reason: 'Ledger fee' }, 'key-6'), `${BASE}/adjustments`],
    ['runReconciliation', () => portfolioAccountingApi.runReconciliation({ profileId: 'p-1' }, 'key-7'), `${BASE}/reconciliations`],
  ])('%s posts to %s with an idempotency key', async (_name, call, path) => {
    await call();

    const [calledPath, , options] = post.mock.calls[0] as [string, unknown, { idempotencyKey: string }];
    expect(calledPath).toBe(path);
    expect(options.idempotencyKey).toMatch(/^key-/);
  });

  it('sends the adjustment amount as the exact decimal string it was given', async () => {
    await portfolioAccountingApi.createAdjustment({ profileId: 'p-1', kind: 'FEE', amount: '0.000000000001', reason: 'Rounding' }, 'key-8');

    expect(post.mock.calls[0]?.[1]).toMatchObject({ amount: '0.000000000001' });
  });
});
