import { apiClient } from '@/api/api-client';
import { userPositionLimitsApi } from '@/api/user-position-limits-api';

jest.mock('@/api/api-client', () => ({ apiClient: { get: jest.fn(), put: jest.fn() } }));

test('sends the observed version and stable retry key with an owner-derived limit update', async () => {
  const input = { maxConcurrentPositions: 0, maxOpenOrders: null, expectedUpdatedAt: '2026-10-07T10:00:00.000Z' };
  (apiClient.put as jest.Mock).mockResolvedValue({});
  await userPositionLimitsApi.updateMyLimits(input, 'retry-key-1234');
  expect(apiClient.put).toHaveBeenCalledWith('/v1/risk-management/my-position-limits', input, { idempotencyKey: 'retry-key-1234' });
});

test('reads only the authenticated current owner settings', async () => {
  (apiClient.get as jest.Mock).mockResolvedValue({});
  await userPositionLimitsApi.getMyLimits();
  expect(apiClient.get).toHaveBeenCalledWith('/v1/risk-management/my-position-limits');
});
