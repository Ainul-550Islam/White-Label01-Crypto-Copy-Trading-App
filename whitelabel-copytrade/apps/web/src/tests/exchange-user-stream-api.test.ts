// # Responsibility: pins the stream-health and venue-status routes, and proves an unanswered engine surfaces as an error rather than as a healthy stream.

import { apiClient } from '@/api/api-client';
import { exchangeUserStreamApi } from '@/api/exchange-user-stream-api';

jest.mock('@/api/api-client', () => ({ apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
const get = apiClient.get as jest.Mock;

afterEach(() => jest.resetAllMocks());

const health = {
  tenantId: 'tenant-1', accountId: 'account-1', venue: 'BINANCE', state: 'HEALTHY', reasonCode: 'STREAM_LIVE',
  lastEventAt: '2026-10-30T03:00:00.000Z', lastEventAgeMs: 1200, reconnectCount: 0, listenKeyAgeMs: 30000,
  persistedStatus: 'LIVE', evaluatedAt: '2026-10-30T03:00:01.000Z', engineReported: true,
};

test('reads one account stream health from the exchange route', async () => {
  get.mockResolvedValue(health);

  await expect(exchangeUserStreamApi.getStreamHealth('account/with slash')).resolves.toEqual(health);

  expect(get).toHaveBeenCalledWith('/v1/exchanges/account%2Fwith%20slash/user-stream');
});

test('propagates an engine failure instead of inventing a healthy stream', async () => {
  get.mockRejectedValue(new Error('engine unavailable'));

  await expect(exchangeUserStreamApi.getStreamHealth('account-1')).rejects.toThrow('engine unavailable');
});

test('asks the venue-status route for the requested venues as one comma separated parameter', async () => {
  get.mockResolvedValue({ venues: [] });

  await exchangeUserStreamApi.listVenueStatus(['BINANCE', 'COINBASE']);

  expect(get).toHaveBeenCalledWith('/v1/venues/status', { searchParams: { venues: 'BINANCE,COINBASE' } });
});

test('omits the filter when no venue was named, so the board is the whole board', async () => {
  get.mockResolvedValue({ venues: [] });

  await exchangeUserStreamApi.listVenueStatus();

  expect(get).toHaveBeenCalledWith('/v1/venues/status', { searchParams: { venues: undefined } });
});

test('reads a single venue status and encodes the venue', async () => {
  const view = {
    venue: 'BINANCE', state: 'DEGRADED', reason: 'FEED_STALE', since: '2026-10-30T02:00:00.000Z',
    messageCode: 'FEED_STALE', message: 'The venue feed is stale.', source: 'FEED', verified: true,
    override: null, checkedAt: '2026-10-30T03:00:00.000Z',
  };
  get.mockResolvedValue(view);

  await expect(exchangeUserStreamApi.getVenueStatus('BINANCE')).resolves.toEqual(view);

  expect(get).toHaveBeenCalledWith('/v1/venues/BINANCE/status');
});
