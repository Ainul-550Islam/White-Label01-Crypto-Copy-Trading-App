// Verifies tenant context, plan entitlement, the route proof gate, transactional audit and kill-switch precedence.
import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { FeatureFlagsController } from '../feature-flags/feature-flags.controller';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { CacheService } from '../../infrastructure/redis/cache.service';
import type { PinoLogger } from 'nestjs-pino';

describe('tenant feature-flag isolation and entitlement', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const prisma = {
    featureFlag: { findUnique: jest.fn(), findMany: jest.fn() },
    tenantFeatureFlag: { findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn() },
    tenantSubscription: { findFirst: jest.fn() },
    auditLog: { create: jest.fn() },
    $queryRaw: jest.fn(), $executeRaw: jest.fn(),
    withTenantRls: jest.fn(),
  };
  const cache = { delete: jest.fn(), remember: jest.fn() };
  const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
  let service: FeatureFlagsService;
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.withTenantRls.mockImplementation(async (_tenant: string, fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.tenantFeatureFlag.findUnique.mockResolvedValue(null);
    prisma.auditLog.create.mockResolvedValue({});
    service = new FeatureFlagsService(prisma as unknown as PrismaService, cache as unknown as CacheService, logger as unknown as PinoLogger);
  });
  it('lists overrides using only the authenticated tenant id', async () => {
    prisma.tenantFeatureFlag.findMany.mockResolvedValue([]);
    await service.listForTenant(tenantId);
    expect(prisma.withTenantRls).toHaveBeenCalledWith(tenantId, expect.any(Function));
    expect(prisma.tenantFeatureFlag.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId } }));
  });
  it('refuses enabling a flag absent from the current tenant plan entitlement', async () => {
    prisma.featureFlag.findUnique.mockResolvedValue({ id: 'flag-id', key: 'copy_trading' });
    prisma.tenantSubscription.findFirst.mockResolvedValue({ plan: { features: ['analytics'] } });
    await expect(service.setForTenant(tenantId, { key: 'copy_trading', enabled: true }, { actorId: 'u', ipHash: 'h', requestId: 'r' }, 'request-key-123')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.tenantFeatureFlag.upsert).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
  it('requires action-bound step-up on the route and writes a scoped flag and audit in one transaction', async () => {
    expect(Reflect.getMetadata('security:require-step-up', FeatureFlagsController.prototype.setForTenant)).toBe('FEATURE_FLAG_LIVE_TOGGLE');
    prisma.tenantSubscription.findFirst.mockResolvedValue({ plan: { features: ['live_trading'] } });
    prisma.featureFlag.findUnique.mockResolvedValue({ id: 'flag-id', key: 'live_trading' });
    prisma.tenantFeatureFlag.upsert.mockResolvedValue({ id: 'o1', tenantId, featureFlagId: 'flag-id', enabled: true, rolloutPercentage: null, metadata: {}, updatedAt: new Date('2026-01-01T00:00:00Z') });
    const context = { actorId: 'operator', ipHash: 'hash', requestId: 'req' };
    await service.setForTenant(tenantId, { key: 'live_trading', enabled: true }, context, 'request-key-123');
    expect(prisma.withTenantRls).toHaveBeenCalledWith(tenantId, expect.any(Function));
    expect(prisma.tenantFeatureFlag.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId_featureFlagId: { tenantId, featureFlagId: 'flag-id' } }, create: expect.objectContaining({ tenantId, enabled: true }) }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId, actorId: 'operator', action: 'FEATURE_FLAG_UPDATED' }) }));
    expect(cache.delete).toHaveBeenCalled();
  });
  it('refuses tenant writes to the platform-only kill switch', async () => {
    await expect(service.setForTenant(tenantId, { key: 'platform.kill_switch', enabled: false }, { actorId: 'u', ipHash: 'h', requestId: 'r' }, 'request-key-123')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.withTenantRls).not.toHaveBeenCalled();
  });
  it('preserves platform kill-switch precedence over tenant overrides', async () => {
    cache.remember.mockImplementation(async (_key: string, _ttl: number, load: () => Promise<unknown>) => load());
    prisma.featureFlag.findMany.mockResolvedValue([{ key: 'platform.kill_switch', isGlobalDefault: true }, { key: 'copy_trading', isGlobalDefault: true }]);
    prisma.tenantFeatureFlag.findMany.mockResolvedValue([{ enabled: true, featureFlag: { key: 'copy_trading' } }]);
    const result = await service.getAllForTenant(tenantId);
    expect(result['platform.kill_switch']).toBe(true);
    expect(result.copy_trading).toBe(false);
    expect(prisma.tenantFeatureFlag.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId } }));
  });
});
