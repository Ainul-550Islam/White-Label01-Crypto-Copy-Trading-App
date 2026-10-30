import { exchangeAdminApi as api, exchangeRows } from '@/api/exchange-admin-api';
import { apiClient } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const key = 'venue-intent-1';
const opts = { idempotencyKey: key };

afterEach(() => jest.clearAllMocks());

describe('venue status administration', () => {
  it('lists operator venue state', () => {
    void api.listVenues();

    expect(apiClient.get).toHaveBeenCalledWith('/v1/admin/venues');
  });

  it('sets an override with a key and clears it with a key', () => {
    const input = { status: 'DEGRADED', reason: 'Elevated order rejections on the venue', durationMinutes: 60 };
    void api.setVenueStatus('BINANCE', input, key);
    void api.clearVenueStatus('BINANCE', key);

    expect(apiClient.put).toHaveBeenCalledWith('/v1/admin/venues/BINANCE/status', input, opts);
    expect(apiClient.delete).toHaveBeenCalledWith('/v1/admin/venues/BINANCE/status', opts);
  });

  it('encodes a venue identifier that contains a separator', () => {
    void api.setVenueStatus('BINANCE/US', { status: 'DOWN', reason: 'Regional outage' }, key);

    expect(apiClient.put).toHaveBeenCalledWith('/v1/admin/venues/BINANCE%2FUS/status', { status: 'DOWN', reason: 'Regional outage' }, opts);
  });

  it('lists user-stream sessions with an optional limit', () => {
    void api.listUserStreams(50);
    void api.listUserStreams();

    expect(apiClient.get).toHaveBeenNthCalledWith(1, '/v1/admin/exchange-user-streams', { searchParams: { limit: 50 } });
    expect(apiClient.get).toHaveBeenNthCalledWith(2, '/v1/admin/exchange-user-streams', { searchParams: {} });
  });
});

describe('customer-facing venue status and user stream', () => {
  it('reads venue status for an explicit venue set', () => {
    void api.listVenueStatus(['BINANCE', 'KRAKEN']);

    expect(apiClient.get).toHaveBeenCalledWith('/v1/venues/status', { searchParams: { venues: 'BINANCE,KRAKEN' } });
  });

  it('reads one venue status and one account user stream', () => {
    void api.getVenueStatus('BINANCE');
    void api.getUserStream('a/1');

    expect(apiClient.get).toHaveBeenNthCalledWith(1, '/v1/venues/BINANCE/status');
    expect(apiClient.get).toHaveBeenNthCalledWith(2, '/v1/exchanges/a%2F1/user-stream');
  });
});

describe('venue override step-up', () => {
  it('mints a VENUE_STATUS_OVERRIDE proof', async () => {
    jest.mocked(apiClient.post).mockResolvedValueOnce({
      proofId: 'p', action: 'VENUE_STATUS_OVERRIDE', method: 'RECOVERY_CODE', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await api.requestVenueOverrideProof('RECOVERY_CODE', 'code-1', 'proof-key');

    expect(apiClient.post).toHaveBeenCalledWith(
      '/v1/auth/step-up/verify',
      { action: 'VENUE_STATUS_OVERRIDE', method: 'RECOVERY_CODE', recoveryCode: 'code-1' },
      { idempotencyKey: 'proof-key' },
    );
  });

  it('refuses an expired or mismatched proof', async () => {
    jest.mocked(apiClient.post).mockResolvedValueOnce({
      proofId: 'p', action: 'VENUE_STATUS_OVERRIDE', method: 'TOTP', expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await expect(api.requestVenueOverrideProof('TOTP', '1', 'k')).rejects.toThrow('Invalid verification response');
  });
});

describe('row normalisation', () => {
  it('accepts a bare array or a data envelope', () => {
    expect(exchangeRows([{ venue: 'X' }])).toEqual([{ venue: 'X' }]);
    expect(exchangeRows({ data: [{ venue: 'Y' }] })).toEqual([{ venue: 'Y' }]);
    expect(exchangeRows(undefined)).toEqual([]);
  });
});
