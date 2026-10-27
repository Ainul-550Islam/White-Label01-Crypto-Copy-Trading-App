// # Tests controller delegation uses authenticated tenant, user, and platform audit context.
import { FeatureFlagsController } from './feature-flags.controller';
import { Permission } from '@wlct/shared-types';

describe('FeatureFlagsController', () => {
  it('resolves and lists flags only for the JWT tenant', async () => {
    const featureFlags = {
      getAllForTenant: jest.fn().mockResolvedValue({ copy_trading: false }),
      listForTenant: jest.fn().mockResolvedValue([]),
    };
    const controller = new FeatureFlagsController(featureFlags as never);
    await expect(controller.resolved('tenant-b')).resolves.toEqual({ copy_trading: false });
    await controller.listForTenant('tenant-b');
    expect(featureFlags.getAllForTenant).toHaveBeenCalledWith('tenant-b');
    expect(featureFlags.listForTenant).toHaveBeenCalledWith('tenant-b');
  });

  it('passes verified user and request metadata to a tenant override write', async () => {
    const featureFlags = {
      setForTenant: jest.fn().mockResolvedValue({ key: 'copy_trading', enabled: true }),
    };
    const controller = new FeatureFlagsController(featureFlags as never);
    const dto = { key: 'copy_trading', enabled: true } as never;
    await controller.setForTenant(
      dto,
      'tenant-b',
      { userId: 'user-b' } as never,
      { ipHash: 'ip-b', requestId: 'request-b' } as never,
      { headers: { 'idempotency-key': 'request-key-123' } } as never,
    );
    expect(featureFlags.setForTenant).toHaveBeenCalledWith('tenant-b', dto, {
      actorId: 'user-b',
      ipHash: 'ip-b',
      requestId: 'request-b',
    }, 'request-key-123');
    expect(Permission.FEATURE_FLAG_MANAGE).toBeDefined();
  });
});
