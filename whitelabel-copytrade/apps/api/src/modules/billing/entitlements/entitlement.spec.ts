// # Responsibility: proves entitlement route authorization, tenant-plan restrictions, fail-safe denials, and tenant isolation across canonical and legacy access checks.
import 'reflect-metadata';

import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, SubscriptionStatus } from '@wlct/shared-types';

import { PERMISSIONS_KEY } from '../../../common/constants/metadata.constants';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { EnforcementContextBuilder } from '../enforcement/enforcement.context';
import { EnforcementService } from '../enforcement/enforcement.service';
import type { EnforcementActor, EnforcementContext, TenantBillingContext } from '../enforcement/enforcement.types';
import { TenantFeatureAccessService } from '../saas-admin/tenant-feature-access.service';
import { SaasAdminController } from '../saas-admin/saas-admin.controller';
import { EntitlementSource, EntitlementStatus, type Entitlement, type EntitlementFilter } from './entitlement.types';
import { EntitlementGuard } from './entitlement.guard';
import { EntitlementService, type EntitlementRepository } from './entitlement.service';
import { EntitlementResolver } from './entitlement.resolver';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const USER_A = 'user-a';
const USER_B = 'user-b';

const PLAN_LIMITS = {
  maxUsers: null,
  maxTraders: null,
  maxFollowersPerTrader: null,
  maxExchangeAccountsPerUser: null,
  maxCopySubscriptionsPerFollower: null,
  maxApiRequestsPerMinute: null,
  websocketConnections: null,
  customDomain: false,
  whiteLabelMobileApp: false,
  prioritySupport: false,
};

const PLAN_ADMIN_HANDLERS = ['assignPlan', 'changePlan', 'getFeatureAccess', 'checkFeature'] as const;

function makeEnforcementActor(tenantId: string, userId = USER_A): EnforcementActor {
  return {
    userId,
    tenantId,
    roles: ['TENANT_ADMIN'],
    ipHash: 'test-ip-hash',
    requestId: 'request-entitlement-test',
    correlationId: 'correlation-entitlement-test',
  };
}

function makeBillingContext(
  tenantId: string,
  overrides: Partial<TenantBillingContext> = {},
): TenantBillingContext {
  return {
    tenantId,
    subscriptionId: `subscription-${tenantId}`,
    subscriptionStatus: SubscriptionStatus.ACTIVE,
    planId: `plan-${tenantId}`,
    planCode: 'starter',
    planLimits: { ...PLAN_LIMITS },
    planFeatures: ['copy_trading'],
    subscriptionActive: true,
    isLifetime: false,
    ...overrides,
  };
}

function makeEntitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  const now = new Date('2026-10-01T00:00:00.000Z');
  return {
    id: 'entitlement-a',
    tenantId: TENANT_A,
    userId: USER_A,
    planId: 'plan-starter',
    status: EntitlementStatus.ACTIVE,
    source: EntitlementSource.PLAN,
    features: [{ key: 'copy_trading', name: 'Copy trading', enabled: true }],
    limits: [],
    startsAt: new Date('2026-09-01T00:00:00.000Z'),
    metadata: {},
    createdAt: now,
    updatedAt: now,
    createdBy: 'billing-system',
    updatedBy: 'billing-system',
    ...overrides,
  };
}

function makeRepository() {
  return {
    findById: jest.fn(),
    findByUserAndTenant: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    recordUsage: jest.fn(),
    resetUsage: jest.fn(),
  };
}

function permissionGuardFor(
  handlerName: (typeof PLAN_ADMIN_HANDLERS)[number],
  grantedPermissions: string[],
  actor?: { userId: string; tenantId: string; isPlatformUser: boolean; roles: string[]; permissions: string[] },
) {
  const controllerPrototype = SaasAdminController.prototype as unknown as Record<string, unknown>;
  const handler = controllerPrototype[handlerName];
  const permissionsService = {
    getEffectiveAccess: jest.fn().mockResolvedValue({
      permissionKeys: grantedPermissions,
      roleKeys: actor?.roles ?? [],
    }),
  };
  const securityEvents = { record: jest.fn().mockResolvedValue(undefined) };
  const request = {
    actor: actor ? { ...actor, permissions: [...actor.permissions], roles: [...actor.roles] } : undefined,
    headers: {},
    originalUrl: `/api/v1/billing/saas-admin/tenants/${TENANT_A}/plan/access`,
    method: handlerName === 'assignPlan' || handlerName === 'changePlan' ? 'POST' : 'GET',
    requestId: 'request-entitlement-authorization',
    tenantContext: actor ? { tenantId: actor.tenantId } : undefined,
  };
  const context = {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => SaasAdminController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const guard = new PermissionsGuard(
    new Reflector(),
    permissionsService as never,
    securityEvents as never,
  );

  return { context, guard, permissionsService, securityEvents, request };
}

describe('GAP-87 tenant and plan entitlement regression proof', () => {
  describe('SaaS plan-management and entitlement authorization', () => {
    it.each(PLAN_ADMIN_HANDLERS)('%s requires live PLATFORM_MANAGE permission', async (handlerName) => {
      const controllerPrototype = SaasAdminController.prototype as unknown as Record<string, object>;
      expect(Reflect.getMetadata(PERMISSIONS_KEY, controllerPrototype[handlerName])).toEqual([
        Permission.PLATFORM_MANAGE,
      ]);

      const tenantAdmin = {
        userId: USER_A,
        tenantId: TENANT_A,
        isPlatformUser: false,
        roles: ['TENANT_ADMIN'],
        permissions: [],
      };
      const denied = permissionGuardFor(handlerName, [], tenantAdmin);
      await expect(denied.guard.canActivate(denied.context)).rejects.toThrow();
      expect(denied.permissionsService.getEffectiveAccess).toHaveBeenCalledWith(USER_A);
      expect(denied.securityEvents.record).toHaveBeenCalledTimes(1);

      const platformOperator = {
        userId: 'platform-operator',
        tenantId: TENANT_A,
        isPlatformUser: true,
        roles: ['SUPER_ADMIN'],
        permissions: [Permission.PLATFORM_MANAGE],
      };
      const allowed = permissionGuardFor(handlerName, [Permission.PLATFORM_MANAGE], platformOperator);
      await expect(allowed.guard.canActivate(allowed.context)).resolves.toBe(true);
      expect(allowed.securityEvents.record).not.toHaveBeenCalled();
    });

    it('rejects plan-management access when no authenticated actor is present', async () => {
      const unauthenticated = permissionGuardFor('assignPlan', [], undefined);
      await expect(unauthenticated.guard.canActivate(unauthenticated.context)).rejects.toThrow();
      expect(unauthenticated.permissionsService.getEffectiveAccess).not.toHaveBeenCalled();
    });
  });

  describe('canonical plan restriction and fail-safe decisions', () => {
    it('denies a feature excluded by the active tenant plan even when a tenant flag is enabled', async () => {
      const billing = makeBillingContext(TENANT_A, {
        planCode: 'starter',
        planFeatures: ['copy_trading'],
        planLimits: { ...PLAN_LIMITS, customDomain: false },
      });
      const enforcementContext: EnforcementContext = {
        tenant: billing,
        actor: makeEnforcementActor(TENANT_A, 'system'),
      };
      const contextBuilder = {
        resolveBillingContext: jest.fn().mockResolvedValue(billing),
        build: jest.fn().mockResolvedValue(enforcementContext),
      };
      const enforcementAudit = { logFeatureCheck: jest.fn().mockResolvedValue(undefined) };
      const enforcement = new EnforcementService(
        contextBuilder as never,
        enforcementAudit as never,
        {} as never,
      );
      const prisma = {
        tenantFeatureFlag: {
          findFirst: jest.fn().mockResolvedValue({ enabled: true }),
        },
      };
      const saasAudit = { logFeatureAccessChecked: jest.fn().mockResolvedValue(undefined) };
      const service = new TenantFeatureAccessService(
        prisma as never,
        contextBuilder as never,
        enforcement as never,
        saasAudit as never,
      );

      const access = await service.checkFeatureAccess(TENANT_A, 'customDomain');

      expect(access).toMatchObject({
        featureKey: 'customDomain',
        enabled: false,
        source: 'none',
        planCode: 'starter',
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      });
      expect(access.reason).toContain('not included in the starter plan');
      expect(contextBuilder.build).toHaveBeenCalledWith({ tenantId: TENANT_A, userId: 'system' });
      expect(enforcementAudit.logFeatureCheck).toHaveBeenCalledWith(
        enforcementContext,
        expect.objectContaining({ allowed: false, featureKey: 'customDomain' }),
        undefined,
      );
      expect(prisma.tenantFeatureFlag.findFirst).not.toHaveBeenCalled();
    });

    it('falls back to disabled access, never allow, when the entitlement decision service fails', async () => {
      const billing = makeBillingContext(TENANT_A, {
        planFeatures: ['customDomain'],
        planLimits: { ...PLAN_LIMITS, customDomain: true },
      });
      const enforcementContext: EnforcementContext = {
        tenant: billing,
        actor: makeEnforcementActor(TENANT_A, 'system'),
      };
      const contextBuilder = {
        resolveBillingContext: jest.fn().mockResolvedValue(billing),
        build: jest.fn().mockResolvedValue(enforcementContext),
      };
      const decisionUnavailable = new Error('entitlement policy unavailable');
      const enforcement = { checkFeature: jest.fn().mockRejectedValue(decisionUnavailable) };
      const service = new TenantFeatureAccessService(
        {} as never,
        contextBuilder as never,
        enforcement as never,
        {} as never,
      );

      const access = await service.checkFeatureAccess(TENANT_A, 'customDomain');

      expect(access).toMatchObject({
        featureKey: 'customDomain',
        enabled: false,
        source: 'none',
        reason: decisionUnavailable.message,
      });
      expect(enforcement.checkFeature).toHaveBeenCalledTimes(1);
    });

    it('does not convert a billing-context storage outage into access or a successful fallback', async () => {
      const storageUnavailable = new Error('billing context storage unavailable');
      const contextBuilder = {
        resolveBillingContext: jest.fn().mockRejectedValue(storageUnavailable),
        build: jest.fn(),
      };
      const service = new TenantFeatureAccessService(
        {} as never,
        contextBuilder as never,
        {} as never,
        {} as never,
      );

      await expect(service.checkFeatureAccess(TENANT_A, 'customDomain')).rejects.toBe(storageUnavailable);
      expect(contextBuilder.build).not.toHaveBeenCalled();
    });

    it('propagates entitlement repository failure instead of granting access through the legacy guard', async () => {
      const storageUnavailable = new Error('user entitlement storage unavailable');
      const repository = makeRepository();
      repository.findByUserAndTenant.mockRejectedValue(storageUnavailable);
      const guard = new EntitlementGuard(new EntitlementService(repository as unknown as EntitlementRepository));

      await expect(
        guard.hasFeatureAccess('copy_trading', {
          userId: USER_A,
          tenantId: TENANT_A,
          roles: ['TENANT_ADMIN'],
          permissions: [],
        }),
      ).rejects.toBe(storageUnavailable);
      expect(repository.findByUserAndTenant).toHaveBeenCalledWith(USER_A, TENANT_A);
    });
  });

  describe('tenant isolation', () => {
    it('overrides a caller-supplied tenant filter and hides an entitlement id owned by another tenant', async () => {
      const owned = makeEntitlement({ id: 'entitlement-tenant-a', tenantId: TENANT_A, userId: USER_A });
      const foreign = makeEntitlement({ id: 'entitlement-tenant-b', tenantId: TENANT_B, userId: USER_B });
      const repository = makeRepository();
      repository.findMany.mockImplementation(async (filter: EntitlementFilter) =>
        filter.tenantId === TENANT_A ? [owned] : [foreign],
      );
      repository.findById.mockResolvedValue(foreign);
      const resolver = new EntitlementResolver(
        new EntitlementService(repository as unknown as EntitlementRepository),
      );

      const listed = await resolver.listEntitlements(
        { tenantId: TENANT_B, userId: USER_B },
        { userId: USER_A, tenantId: TENANT_A },
      );
      const hiddenForeignId = await resolver.getEntitlement('entitlement-tenant-b', {
        userId: USER_A,
        tenantId: TENANT_A,
      });

      expect(repository.findMany).toHaveBeenCalledWith({ tenantId: TENANT_A, userId: USER_B });
      expect(listed.map((entitlement) => entitlement.tenantId)).toEqual([TENANT_A]);
      expect(hiddenForeignId).toBeNull();
    });

    it('builds canonical plan context using only the authenticated actor tenant for database reads', async () => {
      const subscription = {
        id: `subscription-${TENANT_B}`,
        status: SubscriptionStatus.ACTIVE,
        planId: `plan-${TENANT_B}`,
        plan: {
          code: 'business',
          interval: 'MONTHLY',
          limits: { ...PLAN_LIMITS, customDomain: true },
          features: ['customDomain', 'copy_trading'],
        },
      };
      const prisma = {
        tenant: { findUnique: jest.fn().mockResolvedValue({ id: TENANT_B }) },
        tenantSubscription: { findFirst: jest.fn().mockResolvedValue(subscription) },
      };
      const cache = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
      };
      const logger = { warn: jest.fn(), debug: jest.fn() };
      const builder = new EnforcementContextBuilder(prisma as never, cache as never, logger as never);
      const actor = makeEnforcementActor(TENANT_B, USER_B);

      const context = await builder.build(actor);

      expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
        where: { id: TENANT_B },
        select: { id: true },
      });
      expect(prisma.tenantSubscription.findFirst).toHaveBeenCalledWith({
        where: { tenantId: TENANT_B },
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
      });
      expect(context.actor).toBe(actor);
      expect(context.tenant.tenantId).toBe(TENANT_B);
      expect(context.tenant.planCode).toBe('business');
      expect(cache.set).toHaveBeenCalledWith(`enforcement:ctx:${TENANT_B}`, context.tenant, 30);
    });
  });
});
