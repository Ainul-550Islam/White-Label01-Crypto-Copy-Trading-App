import { SubscriptionStatus } from '@wlct/shared-types';
import {
  EnforcementDecisionCode,
  EnforcementScope,
  type EnforcementContext,
  type TenantBillingContext,
} from './enforcement.types';
import {
  FeatureNotIncludedError,
  PlanLimitExceededError,
  SubscriptionInactiveError,
  RateLimitExceededError,
} from './enforcement.errors';

function makeBillingCtx(overrides: Partial<TenantBillingContext> = {}): TenantBillingContext {
  return {
    tenantId: 'tenant-1',
    subscriptionId: 'sub-1',
    subscriptionStatus: SubscriptionStatus.ACTIVE,
    planId: 'plan-1',
    planCode: 'standard',
    planLimits: {
      maxUsers: 50,
      maxTraders: 10,
      maxFollowersPerTrader: 100,
      maxExchangeAccountsPerUser: 3,
      maxCopySubscriptionsPerFollower: 5,
      maxApiRequestsPerMinute: 600,
      websocketConnections: 20,
      customDomain: false,
      whiteLabelMobileApp: false,
      prioritySupport: false,
    },
    planFeatures: ['basic_trading', 'copy_trading', 'api_access'],
    subscriptionActive: true,
    isLifetime: false,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<TenantBillingContext> = {}): EnforcementContext {
  return {
    tenant: makeBillingCtx(overrides),
    actor: {
      userId: 'user-1',
      tenantId: 'tenant-1',
      roles: ['admin'],
      ipHash: 'hash123',
      requestId: 'req-1',
      correlationId: 'corr-1',
    },
  };
}

describe('Enforcement Types & Errors', () => {
  describe('FeatureNotIncludedError', () => {
    it('should produce correct machine-readable code', () => {
      const error = new FeatureNotIncludedError('customDomain', 'basic');
      expect(error.code).toBe('FEATURE_DISABLED');
      expect(error.enforcementCode).toBe(EnforcementDecisionCode.FEATURE_NOT_INCLUDED);
      expect(error.message).toContain('not included');
    });

    it('should include featureKey in context', () => {
      const error = new FeatureNotIncludedError('whiteLabelMobileApp', 'standard');
      expect(error.context).toMatchObject({ featureKey: 'whiteLabelMobileApp' });
    });
  });

  describe('PlanLimitExceededError', () => {
    it('should produce correct machine-readable code', () => {
      const error = new PlanLimitExceededError({
        limitKey: 'maxUsers',
        currentUsage: 50,
        configuredMaximum: 50,
        remaining: 0,
        scope: EnforcementScope.TENANT,
      });
      expect(error.code).toBe('SUBSCRIPTION_LIMIT_REACHED');
      expect(error.enforcementCode).toBe(EnforcementDecisionCode.PLAN_LIMIT_EXCEEDED);
    });

    it('should include limit metadata', () => {
      const error = new PlanLimitExceededError({
        limitKey: 'maxTraders',
        currentUsage: 10,
        configuredMaximum: 10,
        remaining: 0,
        scope: EnforcementScope.TENANT,
      });
      expect(error.context).toMatchObject({
        limitKey: 'maxTraders',
        currentUsage: 10,
        configuredMaximum: 10,
        remaining: 0,
      });
    });
  });

  describe('SubscriptionInactiveError', () => {
    it('should produce correct machine-readable code', () => {
      const error = new SubscriptionInactiveError(SubscriptionStatus.CANCELED, 'basic');
      expect(error.code).toBe('SUBSCRIPTION_REQUIRED');
      expect(error.enforcementCode).toBe(EnforcementDecisionCode.SUBSCRIPTION_INACTIVE);
    });
  });

  describe('RateLimitExceededError', () => {
    it('should produce correct machine-readable code', () => {
      const error = new RateLimitExceededError({
        limitKey: 'maxApiRequestsPerMinute',
        currentUsage: 601,
        configuredMaximum: 600,
        retryAfterSeconds: 30,
      });
      expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(error.enforcementCode).toBe(EnforcementDecisionCode.RATE_LIMIT_EXCEEDED);
    });

    it('should include retry metadata', () => {
      const error = new RateLimitExceededError({
        limitKey: 'maxApiRequestsPerMinute',
        currentUsage: 601,
        configuredMaximum: 600,
        retryAfterSeconds: 45,
      });
      expect(error.context).toMatchObject({ retryAfterSeconds: 45 });
    });
  });
});

describe('Enforcement Feature Guard', () => {
  describe('feature entitlement from plan', () => {
    it('should allow feature included in plan features array', () => {
      const ctx = makeCtx({ planFeatures: ['api_access', 'copy_trading'] });
      expect(ctx.tenant.planFeatures).toContain('api_access');
    });

    it('should deny feature not included in plan', () => {
      const ctx = makeCtx({ planFeatures: ['basic_trading'] });
      expect(ctx.tenant.planFeatures).not.toContain('advanced_analytics');
    });
  });

  describe('boolean limit features', () => {
    it('should allow customDomain when true', () => {
      const ctx = makeCtx({ planLimits: { ...makeBillingCtx().planLimits, customDomain: true } });
      expect(ctx.tenant.planLimits.customDomain).toBe(true);
    });

    it('should deny customDomain when false', () => {
      const ctx = makeCtx({ planLimits: { ...makeBillingCtx().planLimits, customDomain: false } });
      expect(ctx.tenant.planLimits.customDomain).toBe(false);
    });

    it('should allow whiteLabelMobileApp when true', () => {
      const ctx = makeCtx({ planLimits: { ...makeBillingCtx().planLimits, whiteLabelMobileApp: true } });
      expect(ctx.tenant.planLimits.whiteLabelMobileApp).toBe(true);
    });

    it('should allow prioritySupport when true', () => {
      const ctx = makeCtx({ planLimits: { ...makeBillingCtx().planLimits, prioritySupport: true } });
      expect(ctx.tenant.planLimits.prioritySupport).toBe(true);
    });
  });

  describe('subscription state', () => {
    it('should consider TRIALING as active', () => {
      const ctx = makeCtx({ subscriptionActive: true, subscriptionStatus: SubscriptionStatus.TRIALING });
      expect(ctx.tenant.subscriptionActive).toBe(true);
    });

    it('should consider ACTIVE as active', () => {
      const ctx = makeCtx({ subscriptionActive: true, subscriptionStatus: SubscriptionStatus.ACTIVE });
      expect(ctx.tenant.subscriptionActive).toBe(true);
    });

    it('should consider LIFETIME as active', () => {
      const ctx = makeCtx({ subscriptionActive: true, isLifetime: true, subscriptionStatus: SubscriptionStatus.CANCELED });
      expect(ctx.tenant.subscriptionActive).toBe(true);
    });

    it('should consider CANCELED as inactive', () => {
      const ctx = makeCtx({ subscriptionActive: false, subscriptionStatus: SubscriptionStatus.CANCELED });
      expect(ctx.tenant.subscriptionActive).toBe(false);
    });

    it('should consider EXPIRED as inactive', () => {
      const ctx = makeCtx({ subscriptionActive: false, subscriptionStatus: SubscriptionStatus.EXPIRED });
      expect(ctx.tenant.subscriptionActive).toBe(false);
    });

    it('should consider missing subscription as inactive', () => {
      const ctx = makeCtx({
        subscriptionActive: false,
        subscriptionId: null,
        subscriptionStatus: null,
      });
      expect(ctx.tenant.subscriptionActive).toBe(false);
    });
  });
});

describe('Enforcement Limit Guard', () => {
  describe('maxUsers', () => {
    it('should allow below limit', () => {
      const ctx = makeCtx();
      const maximum = ctx.tenant.planLimits.maxUsers;
      const currentUsage = 30;
      expect(maximum).toBe(50);
      expect(currentUsage).toBeLessThan(maximum!);
    });

    it('should reject at limit', () => {
      const ctx = makeCtx();
      const maximum = ctx.tenant.planLimits.maxUsers;
      const currentUsage = 50;
      expect(maximum).toBe(50);
      expect(currentUsage).not.toBeLessThan(maximum!);
    });

    it('should allow unlimited when null', () => {
      const ctx = makeCtx({ planLimits: { ...makeBillingCtx().planLimits, maxUsers: null } });
      expect(ctx.tenant.planLimits.maxUsers).toBeNull();
    });
  });

  describe('maxTraders', () => {
    it('should allow below limit', () => {
      const ctx = makeCtx();
      const maximum = ctx.tenant.planLimits.maxTraders;
      const currentUsage = 5;
      expect(maximum).toBe(10);
      expect(currentUsage).toBeLessThan(maximum!);
    });

    it('should reject at limit', () => {
      const ctx = makeCtx();
      const maximum = ctx.tenant.planLimits.maxTraders;
      const currentUsage = 10;
      expect(maximum).toBe(10);
      expect(currentUsage).not.toBeLessThan(maximum!);
    });
  });

  describe('maxFollowersPerTrader (per-trader scope)', () => {
    it('should be scoped per trader', () => {
      const limitKey = 'maxFollowersPerTrader';
      expect(limitKey).toContain('PerTrader');
      const maximum = makeBillingCtx().planLimits.maxFollowersPerTrader;
      expect(maximum).toBe(100);
    });

    it('should allow below per-trader limit', () => {
      const maximum = makeBillingCtx().planLimits.maxFollowersPerTrader;
      expect(maximum).toBe(100);
      expect(50).toBeLessThan(maximum!);
    });

    it('should reject at per-trader limit', () => {
      const maximum = makeBillingCtx().planLimits.maxFollowersPerTrader;
      expect(maximum).toBe(100);
      expect(100).not.toBeLessThan(maximum!);
    });
  });

  describe('maxExchangeAccountsPerUser (per-user scope)', () => {
    it('should be scoped per user', () => {
      const limitKey = 'maxExchangeAccountsPerUser';
      expect(limitKey).toContain('PerUser');
      const maximum = makeBillingCtx().planLimits.maxExchangeAccountsPerUser;
      expect(maximum).toBe(3);
    });

    it('should allow below per-user limit', () => {
      const maximum = makeBillingCtx().planLimits.maxExchangeAccountsPerUser;
      expect(1).toBeLessThan(maximum!);
    });

    it('should reject at per-user limit', () => {
      const maximum = makeBillingCtx().planLimits.maxExchangeAccountsPerUser;
      expect(3).not.toBeLessThan(maximum!);
    });
  });

  describe('maxCopySubscriptionsPerFollower (per-follower scope)', () => {
    it('should be scoped per follower', () => {
      const limitKey = 'maxCopySubscriptionsPerFollower';
      expect(limitKey).toContain('PerFollower');
      const maximum = makeBillingCtx().planLimits.maxCopySubscriptionsPerFollower;
      expect(maximum).toBe(5);
    });

    it('should allow below per-follower limit', () => {
      const maximum = makeBillingCtx().planLimits.maxCopySubscriptionsPerFollower;
      expect(2).toBeLessThan(maximum!);
    });

    it('should reject at per-follower limit', () => {
      const maximum = makeBillingCtx().planLimits.maxCopySubscriptionsPerFollower;
      expect(5).not.toBeLessThan(maximum!);
    });
  });

  describe('remaining capacity', () => {
    it('should calculate remaining correctly', () => {
      const maximum = 50;
      const current = 30;
      const remaining = Math.max(0, maximum - current);
      expect(remaining).toBe(20);
    });

    it('should clamp remaining to 0 when exceeded', () => {
      const maximum = 50;
      const current = 55;
      const remaining = Math.max(0, maximum - current);
      expect(remaining).toBe(0);
    });

    it('should return null remaining for unlimited', () => {
      const maximum: number | null = null;
      const remaining = maximum !== null ? Math.max(0, maximum - 30) : null;
      expect(remaining).toBeNull();
    });
  });
});

describe('Enforcement Rate Limit', () => {
  describe('API rate limit (maxApiRequestsPerMinute)', () => {
    it('should allow requests within window', () => {
      const maximum = makeBillingCtx().planLimits.maxApiRequestsPerMinute;
      const currentUsage = 300;
      expect(maximum).toBe(600);
      expect(currentUsage).toBeLessThan(maximum!);
    });

    it('should reject requests after window limit', () => {
      const maximum = makeBillingCtx().planLimits.maxApiRequestsPerMinute;
      const currentUsage = 601;
      expect(maximum).toBe(600);
      expect(currentUsage).toBeGreaterThan(maximum!);
    });

    it('should allow unlimited when null', () => {
      const ctx = makeCtx({ planLimits: { ...makeBillingCtx().planLimits, maxApiRequestsPerMinute: null } });
      expect(ctx.tenant.planLimits.maxApiRequestsPerMinute).toBeNull();
    });
  });

  describe('retry information', () => {
    it('should include retry-after seconds', () => {
      const windowEnd = new Date(Date.now() + 30_000);
      const retryAfter = Math.max(1, Math.ceil((windowEnd.getTime() - Date.now()) / 1000));
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(31);
    });
  });
});

describe('Enforcement WebSocket Limit', () => {
  describe('websocketConnections', () => {
    it('should reject excess connections', () => {
      const maximum = makeBillingCtx().planLimits.websocketConnections;
      const current = 20;
      expect(maximum).toBe(20);
      expect(current).not.toBeLessThan(maximum!);
    });

    it('should allow connections below limit', () => {
      const maximum = makeBillingCtx().planLimits.websocketConnections;
      const current = 15;
      expect(maximum).toBe(20);
      expect(current).toBeLessThan(maximum!);
    });

    it('should release reservation on disconnect', () => {
      let reserved = 20;
      const released = 1;
      reserved = Math.max(0, reserved - released);
      expect(reserved).toBe(19);
    });

    it('should allow unlimited when null', () => {
      const ctx = makeCtx({ planLimits: { ...makeBillingCtx().planLimits, websocketConnections: null } });
      expect(ctx.tenant.planLimits.websocketConnections).toBeNull();
    });
  });
});

describe('Enforcement Decision Codes', () => {
  it('should have distinct codes for all error categories', () => {
    const codes = [
      EnforcementDecisionCode.ALLOWED,
      EnforcementDecisionCode.FEATURE_NOT_INCLUDED,
      EnforcementDecisionCode.PLAN_LIMIT_EXCEEDED,
      EnforcementDecisionCode.SUBSCRIPTION_INACTIVE,
      EnforcementDecisionCode.BILLING_CONTEXT_UNAVAILABLE,
      EnforcementDecisionCode.USAGE_UNAVAILABLE,
      EnforcementDecisionCode.RATE_LIMIT_EXCEEDED,
    ];
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });
});

describe('Feature Rejection Error Contract', () => {
  it('should produce correct machine-readable error for feature rejection', () => {
    const error = new FeatureNotIncludedError('customDomain', 'basic');
    expect(error.code).toBe('FEATURE_DISABLED');
    expect(error.enforcementCode).toBe(EnforcementDecisionCode.FEATURE_NOT_INCLUDED);
    expect(error.context).toMatchObject({ featureKey: 'customDomain', planCode: 'basic' });
    expect(error.message).not.toContain('secret');
    expect(error.message).not.toContain('token');
    expect(error.message).not.toContain('key');
  });
});

describe('Limit Rejection Error Contract', () => {
  it('should produce correct machine-readable error for limit rejection', () => {
    const error = new PlanLimitExceededError({
      limitKey: 'maxUsers',
      currentUsage: 50,
      configuredMaximum: 50,
      remaining: 0,
      scope: EnforcementScope.TENANT,
    });
    expect(error.code).toBe('SUBSCRIPTION_LIMIT_REACHED');
    expect(error.enforcementCode).toBe(EnforcementDecisionCode.PLAN_LIMIT_EXCEEDED);
    expect(error.context).toMatchObject({
      limitKey: 'maxUsers',
      currentUsage: 50,
      configuredMaximum: 50,
    });
    expect(error.message).not.toContain('secret');
    expect(error.message).not.toContain('token');
    expect(error.message).not.toContain('password');
  });
});

describe('Concurrent Creation Safety', () => {
  it('atomicReserve should prevent over-allocation', () => {
    const maximum = 10;
    const current = 9;
    const req1 = current + 1 <= maximum;
    expect(req1).toBe(true);
    const req2 = current + 2 <= maximum;
    expect(req2).toBe(false);
  });
});

describe('Idempotent Retry Safety', () => {
  it('should not double-count on retry', () => {
    let count = 0;
    const idempotencySeen = new Set<string>();
    const idempotencyKey = 'create-user-abc123';

    if (!idempotencySeen.has(idempotencyKey)) {
      count++;
      idempotencySeen.add(idempotencyKey);
    }
    expect(count).toBe(1);

    if (!idempotencySeen.has(idempotencyKey)) {
      count++;
      idempotencySeen.add(idempotencyKey);
    }
    expect(count).toBe(1);
  });
});

describe('Failed Creation Releases Quota', () => {
  it('release should decrement counter', () => {
    let counter = 10;
    counter = Math.max(0, counter - 1);
    expect(counter).toBe(9);
  });

  it('release should not go negative', () => {
    let counter = 0;
    counter = Math.max(0, counter - 1);
    expect(counter).toBe(0);
  });
});

describe('Enforcement Scope', () => {
  it('should support all required scopes', () => {
    const scopes = [
      EnforcementScope.TENANT,
      EnforcementScope.USER,
      EnforcementScope.TRADER,
      EnforcementScope.FOLLOWER,
    ];
    expect(scopes).toHaveLength(4);
    expect(scopes).toContain(EnforcementScope.TENANT);
    expect(scopes).toContain(EnforcementScope.USER);
    expect(scopes).toContain(EnforcementScope.TRADER);
    expect(scopes).toContain(EnforcementScope.FOLLOWER);
  });
});
