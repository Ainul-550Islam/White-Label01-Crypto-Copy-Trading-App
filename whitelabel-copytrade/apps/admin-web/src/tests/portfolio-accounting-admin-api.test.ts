import {
  accountingRows,
  portfolioAccountingAdminApi as api,
  type CreateAdjustmentInput,
  type CreatePeriodInput,
  type CreateProfileInput,
  type CreateSnapshotInput,
  type RunReconciliationInput,
} from '@/api/portfolio-accounting-admin-api';
import { apiClient } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const key = 'portfolio-key-1';
const opts = { idempotencyKey: key };
const base = '/v1/portfolio-accounting';

afterEach(() => jest.clearAllMocks());

describe('portfolio accounting read routes', () => {
  it('lists profiles with only the supplied filters', () => {
    void api.listProfiles({ profileId: 'p/1', scope: '', limit: 50 });

    expect(apiClient.get).toHaveBeenCalledWith(`${base}/profiles`, { searchParams: { profileId: 'p/1', limit: 50 } });
  });

  it('reads events, cash, the cash balance and positions', () => {
    void api.listEvents({ profileId: 'p-1' });
    void api.listCash({ profileId: 'p-1' });
    void api.getCashBalance({ profileId: 'p-1', asset: 'USDT' });
    void api.listPositions({ profileId: 'p-1' });

    expect(apiClient.get).toHaveBeenNthCalledWith(1, `${base}/events`, { searchParams: { profileId: 'p-1' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(2, `${base}/cash`, { searchParams: { profileId: 'p-1' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(3, `${base}/cash/balance`, { searchParams: { profileId: 'p-1', asset: 'USDT' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(4, `${base}/positions`, { searchParams: { profileId: 'p-1' } });
  });

  it('reads one snapshot by an encoded id', () => {
    void api.getSnapshot('snap/1');

    expect(apiClient.get).toHaveBeenCalledWith(`${base}/snapshots/snap%2F1`);
  });

  it('lists periods and reconciliations', () => {
    void api.listPeriods({ profileId: 'p-1', state: 'OPEN' });
    void api.listReconciliations({ profileId: 'p-1', periodId: 'per-1' });

    expect(apiClient.get).toHaveBeenNthCalledWith(1, `${base}/periods`, { searchParams: { profileId: 'p-1', state: 'OPEN' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(2, `${base}/reconciliations`, { searchParams: { profileId: 'p-1', periodId: 'per-1' } });
  });
});

describe('portfolio accounting writes', () => {
  it('creates a profile with a key', () => {
    const input: CreateProfileInput = { scope: 'FOLLOWER', scopeId: 'user-1', baseCurrency: 'USDT', returnMethodology: 'TWR' };
    void api.createProfile(input, key);

    expect(apiClient.post).toHaveBeenCalledWith(`${base}/profiles`, input, opts);
  });

  it('records a snapshot with the scope the API requires', () => {
    const input: CreateSnapshotInput = { profileId: 'p-1', scope: 'FOLLOWER', scopeId: 'user-1' };
    void api.createSnapshot(input, key);

    expect(apiClient.post).toHaveBeenCalledWith(`${base}/snapshots`, input, opts);
  });

  it('creates and closes a period, sending only the period id on close', () => {
    const input: CreatePeriodInput = { profileId: 'p-1', periodStart: '2026-10-01', periodEnd: '2026-10-31', periodType: 'MONTHLY' };
    void api.createPeriod(input, key);
    void api.closePeriod('per/1', key);

    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${base}/periods`, input, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `${base}/periods/close`, { periodId: 'per/1' }, opts);
  });

  it('sends an adjustment with its reason and keeps amounts as decimal strings', () => {
    const input: CreateAdjustmentInput = { profileId: 'p-1', adjustmentType: 'CORRECTION', reason: 'Fee booked twice', adjustedAmount: '12.34000000' };
    void api.createAdjustment(input, key);

    expect(apiClient.post).toHaveBeenCalledWith(`${base}/adjustments`, input, opts);
    expect(typeof (input as { adjustedAmount: string }).adjustedAmount).toBe('string');
  });

  it('generates a statement and runs a reconciliation with a key each time', () => {
    void api.generateStatement({ profileId: 'p-1', periodId: 'per-1' }, key);
    const run: RunReconciliationInput = { profileId: 'p-1', scope: 'TENANT', trigger: 'MANUAL' };
    void api.runReconciliation(run, key);

    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${base}/statements`, { profileId: 'p-1', periodId: 'per-1' }, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `${base}/reconciliations`, run, opts);
  });
});

describe('accountingRows', () => {
  it('accepts a bare array, a page envelope and nothing at all', () => {
    expect(accountingRows([{ asset: 'USDT', balance: '1' }])).toHaveLength(1);
    expect(accountingRows({ data: [{ asset: 'USDT', balance: '1' }], total: 1 })).toHaveLength(1);
    expect(accountingRows(null)).toEqual([]);
  });
});
