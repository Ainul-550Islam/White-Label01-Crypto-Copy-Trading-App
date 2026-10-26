// # Regresses global kill-switch precedence over tenant overrides and cache behavior.
import { FeatureFlagsService } from './feature-flags.service';

describe('FeatureFlagsService kill switch', () => {
  it('forces all platform features off when globally engaged regardless of tenant overrides', async () => {
    const prisma = {
      featureFlag: {
        findMany: jest.fn().mockResolvedValue([
          { key: 'platform.kill_switch', isGlobalDefault: true },
          { key: 'copy_trading', isGlobalDefault: true },
          { key: 'withdrawals', isGlobalDefault: true },
        ]),
      },
      tenantFeatureFlag: {
        findMany: jest.fn().mockResolvedValue([
          { enabled: true, featureFlag: { key: 'copy_trading' } },
          { enabled: true, featureFlag: { key: 'platform.kill_switch' } },
        ]),
      },
    };
    const cache = {
      remember: jest.fn(async (_key: string, _ttl: number, factory: () => Promise<unknown>) =>
        factory(),
      ),
    };
    const service = new FeatureFlagsService(
      prisma as never,
      cache as never,
      {} as never,
      { warn: jest.fn(), info: jest.fn() } as never,
    );
    await expect(service.getAllForTenant('tenant-a')).resolves.toEqual({
      'platform.kill_switch': true,
      copy_trading: false,
      withdrawals: false,
    });
  });

  it('lets an explicit tenant override beat the global default and fails unknown flags off', async () => {
    const cache = {
      remember: jest.fn(async (_key: string, _ttl: number, factory: () => Promise<unknown>) =>
        factory(),
      ),
    };
    const service = new FeatureFlagsService(
      {
        featureFlag: {
          findMany: jest.fn().mockResolvedValue([{ key: 'copy_trading', isGlobalDefault: true }]),
        },
        tenantFeatureFlag: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ enabled: false, featureFlag: { key: 'copy_trading' } }]),
        },
      } as never,
      cache as never,
      {} as never,
      { warn: jest.fn(), info: jest.fn() } as never,
    );
    await expect(service.getAllForTenant('tenant-a')).resolves.toMatchObject({
      copy_trading: false,
    });
    await expect(service.isEnabled('tenant-a', 'unknown.flag')).resolves.toBe(false);
  });

  it('keeps tenant override resolution scoped to the requested tenant', async () => {
    const cache = {
      remember: jest.fn(async (_key: string, _ttl: number, factory: () => Promise<unknown>) =>
        factory(),
      ),
    };
    const tenantFindMany = jest.fn().mockResolvedValue([]);
    const service = new FeatureFlagsService(
      {
        featureFlag: { findMany: jest.fn().mockResolvedValue([]) },
        tenantFeatureFlag: { findMany: tenantFindMany },
      } as never,
      cache as never,
      {} as never,
      { warn: jest.fn(), info: jest.fn() } as never,
    );
    await service.getAllForTenant('tenant-b');
    expect(tenantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-b' } }),
    );
  });
});
