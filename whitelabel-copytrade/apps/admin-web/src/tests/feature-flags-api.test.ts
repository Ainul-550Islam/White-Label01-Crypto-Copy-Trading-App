import { businessAdminApi } from '../api/business-admin-api';
import { apiClient } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  apiClient: { put: jest.fn(), post: jest.fn() },
}));

describe('tenant feature flag contract', () => {
  beforeEach(() => jest.resetAllMocks());

  it.each(['setTenantFeatureFlag', 'setTenantLiveFeatureFlag'] as const)(
    '%s sends SetTenantFlagDto and validates the stored override',
    async (method) => {
      const dto = { key: 'copy_trading', enabled: true, rolloutPercentage: 25, metadata: { reason: 'Approved rollout' } };
      jest.mocked(apiClient.put).mockResolvedValueOnce({ ...dto, id: 'id', tenantId: 'tenant' });
      await businessAdminApi[method](dto, 'flag-intent');
      expect(apiClient.put).toHaveBeenCalledWith('/v1/feature-flags', dto, { idempotencyKey: 'flag-intent' });
      expect(apiClient.put).toHaveBeenCalledTimes(1);
    },
  );

  it.each([{}, { key: 'other', enabled: true }, { key: 'copy_trading', enabled: false }, { key: 'copy_trading', enabled: true, rolloutPercentage: 10 }])(
    'does not claim an unconfirmed flag change: %p', async (response) => {
      jest.mocked(apiClient.put).mockResolvedValueOnce(response);
      await expect(businessAdminApi.setTenantFeatureFlag({ key: 'copy_trading', enabled: true, rolloutPercentage: 25 }, 'flag-intent')).rejects.toThrow('Invalid feature flag response');
    },
  );

  it('requires a fresh action- and method-matched proof', async () => {
    const payload = { action: 'FEATURE_FLAG_LIVE_TOGGLE' as const, method: 'TOTP' as const, code: '123456' };
    jest.mocked(apiClient.post).mockResolvedValueOnce({ ok: true });
    await expect(businessAdminApi.verifyStepUp(payload, 'proof-key')).rejects.toThrow('Invalid verification response');
    jest.mocked(apiClient.post).mockResolvedValueOnce({ proofId: 'proof', action: payload.action, method: payload.method, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await expect(businessAdminApi.verifyStepUp(payload, 'proof-key')).resolves.toBeUndefined();
    expect(apiClient.post).toHaveBeenCalledWith('/v1/auth/step-up/verify', payload, { idempotencyKey: 'proof-key' });
  });
});
