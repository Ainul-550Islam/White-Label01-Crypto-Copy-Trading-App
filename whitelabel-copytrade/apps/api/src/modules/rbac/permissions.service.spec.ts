// # Responsibility: verifies permission wildcard boundaries and cache invalidation after authorization changes.
import { Permission } from '@wlct/shared-types';
import { CACHE_KEY } from '@wlct/config';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { PermissionsService } from './permissions.service';

describe('PermissionsService effective access', () => {
  it('does not let action wildcards grant safety-sensitive permissions', () => {
    const service = new PermissionsService({} as PrismaService, {} as CacheService);

    expect(service.hasAny(['exchange_account:*'], [Permission.EXCHANGE_ACCOUNT_READ])).toBe(true);
    expect(service.hasAny(['exchange_account:*'], [Permission.EXCHANGE_ACCOUNT_ENABLE_LIVE])).toBe(false);
    expect(service.hasAny(['exchange_account:*'], [Permission.EXCHANGE_ACCOUNT_ROTATE_CREDENTIALS])).toBe(false);
    expect(service.hasAll(['execution:*'], [Permission.EXECUTION_READ, Permission.EXECUTION_SUBMIT])).toBe(false);
    expect(service.hasAny(['user:*'], [Permission.USER_READ])).toBe(true);
    expect(service.hasAny(['user:*'], ['user:read:all'])).toBe(false);
  });

  it('reloads role grants after cache invalidation so a revoked permission stops authorizing', async () => {
    const cacheValues = new Map<string, unknown>();
    const cache = {
      remember: jest.fn(async (key: string, _ttl: number, load: () => Promise<unknown>) => {
        if (cacheValues.has(key)) return cacheValues.get(key);
        const value = await load();
        cacheValues.set(key, value);
        return value;
      }),
      delete: jest.fn(async (key: string) => {
        cacheValues.delete(key);
      }),
    } as unknown as CacheService;
    const userRole = {
      findMany: jest.fn()
        .mockResolvedValueOnce([{
          role: { key: 'ANALYST', permissions: [{ permission: { key: Permission.USER_READ } }] },
        }])
        .mockResolvedValueOnce([]),
    };
    const prisma = { userRole } as unknown as PrismaService;
    const service = new PermissionsService(prisma, cache);

    const first = await service.getEffectiveAccess('user-1');
    expect(service.hasAny(first.permissionKeys, [Permission.USER_READ])).toBe(true);

    await service.invalidateUser('user-1');
    const afterRevocation = await service.getEffectiveAccess('user-1');
    expect(afterRevocation).toEqual({ roleKeys: [], permissionKeys: [] });
    expect(service.hasAny(afterRevocation.permissionKeys, [Permission.USER_READ])).toBe(false);
    expect(userRole.findMany).toHaveBeenCalledTimes(2);
  });

  it('invalidates every member cache after a role grant is revoked', async () => {
    const cache = { delete: jest.fn().mockResolvedValue(undefined) } as unknown as CacheService;
    const userRole = { findMany: jest.fn().mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }]) };
    const service = new PermissionsService({ userRole } as unknown as PrismaService, cache);

    await service.invalidateRoleMembers('role-a');

    expect(userRole.findMany).toHaveBeenCalledWith({ where: { roleId: 'role-a' }, select: { userId: true } });
    expect(cache.delete).toHaveBeenCalledWith(CACHE_KEY.userPermissions('user-1'));
    expect(cache.delete).toHaveBeenCalledWith(CACHE_KEY.userPermissions('user-2'));
  });
});
