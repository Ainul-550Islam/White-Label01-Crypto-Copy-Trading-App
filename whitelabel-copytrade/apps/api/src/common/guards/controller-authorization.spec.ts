import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { ForbiddenException, RequestMethod, type ExecutionContext } from '@nestjs/common';
import { Permission, SYSTEM_ROLE_DEFINITIONS, SystemRole } from '@wlct/shared-types';
import { PermissionsGuard } from '../../modules/auth/guards/permissions.guard';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, PLATFORM_ONLY_KEY } from '../constants/metadata.constants';
import { BindTenantParamsGuard } from './bind-tenant-params.guard';
import { GovernanceController } from '../../modules/governance/governance.controller';
import { PartnerController } from '../../modules/partners/partner.controller';
import { OperationsController } from '../../modules/operations/operations.controller';
import { OmsController } from '../../modules/oms/oms.controller';
import { RiskManagementController } from '../../modules/risk-management/risk.controller';
import { BillingNotificationController } from '../../modules/billing/notifications/billing-notification.controller';
import { ProviderController } from '../../modules/providers/provider.controller';
import { ResearchController } from '../../modules/research/research.controller';
import { WebhookController } from '../../modules/billing/payments/webhook.controller';
import { SsoAuthController } from '../../modules/auth/sso/sso-auth.controller';
import { DeveloperController } from '../../modules/developer-platform/developer.controller';

/**
 * Authorization audit (round 4). Every controller below used to carry no
 * permission metadata at all, so each of its routes was open to any
 * authenticated user of any role (and, where tenantId came from the body or
 * query, of any tenant): a FOLLOWER could execute GDPR deletions, release
 * legal holds, trigger partner payouts, enter maintenance mode, rewrite the
 * risk policy, clear kill switches, disable providers or publish research
 * signals. The payment webhooks had the opposite defect: without @Public()
 * the global JwtAuthGuard answered 401 to every Stripe/NowPayments callback.
 *
 * These tests drive the real PermissionsGuard with the real system role
 * definitions against every route of the real controllers.
 */

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Ctor = abstract new (...args: never[]) => object;

interface Route {
  controller: Ctor;
  handler: string;
  method: Method;
  path: string;
}

const METHOD_NAMES: Partial<Record<RequestMethod, Method>> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
};

function handlers(controller: Ctor): Record<string, object> {
  return controller.prototype as unknown as Record<string, object>;
}

function routesOf(controller: Ctor): Route[] {
  const proto = handlers(controller);
  return Object.getOwnPropertyNames(controller.prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => {
      const fn = proto[name];
      if (typeof fn !== 'function') return null;
      const rawPath = Reflect.getMetadata(PATH_METADATA, fn) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
      if (rawPath === undefined || method === undefined) return null;
      const path = rawPath === '/' ? '' : rawPath.replace(/^\//, '');
      return { controller, handler: name, method: METHOD_NAMES[method] ?? 'GET', path } as Route;
    })
    .filter((r): r is Route => r !== null);
}

function route(controller: Ctor, method: Method, path: string): Route {
  const found = routesOf(controller).find((r) => r.method === method && r.path === path);
  if (!found) throw new Error(`route ${method} ${path} missing on ${controller.name}`);
  return found;
}

interface Actor {
  userId: string;
  tenantId: string;
  isPlatformUser: boolean;
  roles: string[];
  permissions: string[];
}

const TENANT_ROLES: SystemRole[] = [
  SystemRole.TENANT_ADMIN,
  SystemRole.TRADER,
  SystemRole.FOLLOWER,
  SystemRole.SUPPORT,
  SystemRole.FINANCE,
  SystemRole.COMPLIANCE,
];

function roleActor(role: SystemRole): Actor {
  const def = SYSTEM_ROLE_DEFINITIONS.find((d) => d.key === role);
  if (!def) throw new Error(`role ${role} missing`);
  return {
    userId: `user-${role}`,
    tenantId: 'tenant-1',
    isPlatformUser: role === SystemRole.SUPER_ADMIN,
    roles: [role],
    permissions: [...def.permissions] as string[],
  };
}

/** Holds every permission but is not platform staff: PlatformOnly must still refuse it. */
const WILDCARD_TENANT_USER: Actor = {
  userId: 'user-wildcard',
  tenantId: 'tenant-1',
  isPlatformUser: false,
  roles: ['CUSTOM'],
  permissions: ['*'],
};

async function allowed(r: Route, actor: Actor | undefined): Promise<boolean> {
  const guard = new PermissionsGuard(
    new Reflector(),
    {
      getEffectiveAccess: async () => ({
        permissionKeys: actor?.permissions ?? [],
        roleKeys: actor?.roles ?? [],
      }),
    } as never,
    { record: async () => undefined } as never,
  );
  const request = {
    actor: actor ? { ...actor, permissions: [...actor.permissions], roles: [...actor.roles] } : undefined,
    headers: {},
    originalUrl: `/api/v1/${r.path}`,
    method: r.method,
    tenantContext: actor ? { tenantId: actor.tenantId } : undefined,
  };
  const context = {
    getType: () => 'http',
    getHandler: () => handlers(r.controller)[r.handler],
    getClass: () => r.controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  try {
    return await guard.canActivate(context);
  } catch {
    return false;
  }
}

/** Tenant roles (never platform) the guard lets through, sorted. */
async function tenantRolesAllowed(r: Route): Promise<SystemRole[]> {
  const out: SystemRole[] = [];
  for (const role of TENANT_ROLES) {
    if (await allowed(r, roleActor(role))) out.push(role);
  }
  return out.sort();
}

function sorted(...roles: SystemRole[]): SystemRole[] {
  return [...roles].sort();
}

const { TENANT_ADMIN: TA, TRADER: TR, FOLLOWER: FO, SUPPORT: SU, FINANCE: FI, COMPLIANCE: CO } = SystemRole;
const SUPER_ADMIN = roleActor(SystemRole.SUPER_ADMIN);

const AUDITED: Array<{ controller: Ctor; routeCount: number; followerRoutes: Array<[Method, string]> }> = [
  { controller: GovernanceController, routeCount: 47, followerRoutes: [] },
  { controller: PartnerController, routeCount: 47, followerRoutes: [] },
  {
    controller: OperationsController,
    routeCount: 48,
    followerRoutes: [['GET', 'maintenance/current']],
  },
  { controller: OmsController, routeCount: 35, followerRoutes: [] },
  { controller: RiskManagementController, routeCount: 28, followerRoutes: [] },
  {
    controller: BillingNotificationController,
    routeCount: 18,
    followerRoutes: [
      ['GET', 'inbox'],
      ['GET', 'inbox/unread-count'],
      ['PUT', 'inbox/:id/read'],
      ['PUT', 'inbox/read-all'],
      ['GET', 'preferences'],
      ['PUT', 'preferences'],
      ['PUT', 'preferences/bulk'],
    ],
  },
  { controller: ProviderController, routeCount: 11, followerRoutes: [] },
  { controller: ResearchController, routeCount: 51, followerRoutes: [] },
];

describe('controller authorization (audited controllers)', () => {
  describe.each(AUDITED)('$controller.name', ({ controller, routeCount, followerRoutes }) => {
    const routes = routesOf(controller);

    it('exposes the expected number of routes (a new route must be classified here)', () => {
      expect(routes).toHaveLength(routeCount);
    });

    it('carries explicit permission metadata on every route', () => {
      const reflector = new Reflector();
      const open = routes.filter((r) => {
        const targets = [handlers(controller)[r.handler] as () => void, controller];
        const required = reflector.getAllAndOverride<unknown>(PERMISSIONS_KEY, targets);
        const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
        return required === undefined && isPublic !== true;
      });
      expect(open.map((r) => `${r.method} ${r.path}`)).toEqual([]);
    });

    it('lets a FOLLOWER reach only the self-service routes', async () => {
      const follower = roleActor(FO);
      const reachable: string[] = [];
      for (const r of routes) {
        if (await allowed(r, follower)) reachable.push(`${r.method} ${r.path}`);
      }
      expect(reachable.sort()).toEqual(followerRoutes.map(([m, p]) => `${m} ${p}`).sort());
    });

    it('still lets platform super admins through every route', async () => {
      for (const r of routes) {
        expect(await allowed(r, SUPER_ADMIN)).toBe(true);
      }
    });
  });

  describe('governance (GDPR, retention, legal holds, regulatory reports)', () => {
    it('reads need compliance:read (COMPLIANCE only; TENANT_ADMIN deliberately lacks compliance:*)', async () => {
      expect(await tenantRolesAllowed(route(GovernanceController, 'GET', 'privacy-requests'))).toEqual([CO]);
      expect(await tenantRolesAllowed(route(GovernanceController, 'GET', 'legal-holds/active'))).toEqual([CO]);
    });

    it('writes need compliance:write', async () => {
      expect(await tenantRolesAllowed(route(GovernanceController, 'POST', 'privacy-requests'))).toEqual([CO]);
      expect(await tenantRolesAllowed(route(GovernanceController, 'POST', 'legal-holds'))).toEqual([CO]);
    });

    it.each([
      'privacy-requests/:id/deletion-execute',
      'retention/:id/action',
      'legal-holds/:id/release',
      'reports/:id/certification/:certId/certify',
      'evidence-packages/:id/finalize',
    ])('irreversible step %s needs compliance:write AND compliance:reviewer', async (path) => {
      const r = route(GovernanceController, 'POST', path);
      expect(await tenantRolesAllowed(r)).toEqual([CO]);
      const writerOnly: Actor = { ...roleActor(CO), permissions: [Permission.COMPLIANCE_WRITE] };
      const reviewerOnly: Actor = { ...roleActor(CO), permissions: [Permission.COMPLIANCE_REVIEWER] };
      expect(await allowed(r, writerOnly)).toBe(false);
      expect(await allowed(r, reviewerOnly)).toBe(false);
    });

    it('audit export needs compliance:read AND audit_log:read', async () => {
      const r = route(GovernanceController, 'POST', 'audit/export');
      const readOnly: Actor = { ...roleActor(CO), permissions: [Permission.COMPLIANCE_READ] };
      expect(await allowed(r, readOnly)).toBe(false);
      expect(await tenantRolesAllowed(r)).toEqual([CO]);
    });

    it('binds body/query tenantId to the authenticated tenant', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, GovernanceController) as unknown[] | undefined;
      expect(guards).toContain(BindTenantParamsGuard);
    });
  });

  describe('partners (platform reseller programme)', () => {
    it('refuses every tenant role and a wildcard non-platform user on every route', async () => {
      for (const r of routesOf(PartnerController)) {
        expect(await tenantRolesAllowed(r)).toEqual([]);
        expect(await allowed(r, WILDCARD_TENANT_USER)).toBe(false);
      }
    });

    it('reads accept platform:read_metrics, payouts and transfers need platform:manage', async () => {
      const metricsOnly: Actor = { ...SUPER_ADMIN, permissions: [Permission.PLATFORM_READ_METRICS] };
      expect(await allowed(route(PartnerController, 'GET', ':id/payouts'), metricsOnly)).toBe(true);
      expect(await allowed(route(PartnerController, 'GET', ''), metricsOnly)).toBe(true);
      expect(await allowed(route(PartnerController, 'POST', ':id/payouts'), metricsOnly)).toBe(false);
      expect(await allowed(route(PartnerController, 'POST', ':id/tenants/transfer'), metricsOnly)).toBe(false);
      expect(Reflect.getMetadata(PLATFORM_ONLY_KEY, PartnerController)).toBe(true);
    });
  });

  describe('operations', () => {
    it('reads need operations:read', async () => {
      expect(await tenantRolesAllowed(route(OperationsController, 'GET', 'incidents'))).toEqual(sorted(TA, SU, CO));
      expect(await tenantRolesAllowed(route(OperationsController, 'GET', 'recovery/runs'))).toEqual(sorted(TA, SU, CO));
    });

    it.each([
      ['POST', 'maintenance/enter'],
      ['POST', 'maintenance/exit'],
      ['POST', 'recovery/runs/:id/execute'],
      ['POST', 'degradations/clear'],
      ['POST', 'incidents/:id/resolve'],
    ] as Array<[Method, string]>)('%s %s needs operations:alerts_update (TENANT_ADMIN)', async (m, p) => {
      expect(await tenantRolesAllowed(route(OperationsController, m, p))).toEqual([TA]);
    });

    it('the customer maintenance notice is open to every signed-in role', async () => {
      expect(await tenantRolesAllowed(route(OperationsController, 'GET', 'maintenance/current'))).toEqual(
        sorted(...TENANT_ROLES),
      );
    });

    it('declares maintenance/current before maintenance/:id so Express matches the static segment', () => {
      const order = routesOf(OperationsController).map((r) => `${r.method} ${r.path}`);
      expect(order.indexOf('GET maintenance/current')).toBeGreaterThanOrEqual(0);
      expect(order.indexOf('GET maintenance/current')).toBeLessThan(order.indexOf('GET maintenance/:id'));
    });
  });

  describe('oms (no ownership checks, so no customer access)', () => {
    it('tenant-wide order data needs trading:read or compliance:read', async () => {
      for (const p of ['intents', 'fills', 'trades', 'orders', 'audit', 'allocations']) {
        expect(await tenantRolesAllowed(route(OmsController, 'GET', p))).toEqual(sorted(TA, CO));
      }
    });

    it.each([
      ['POST', 'intents'],
      ['POST', 'intents/:id/route'],
      ['POST', 'orders/cancel'],
      ['POST', 'orders/replace'],
      ['POST', 'operational/recovery'],
      ['POST', 'post-trade/:intentId'],
    ] as Array<[Method, string]>)('%s %s needs trading:manage', async (m, p) => {
      expect(await tenantRolesAllowed(route(OmsController, m, p))).toEqual([TA]);
    });
  });

  describe('risk-management (mirrors /risk)', () => {
    it('reads need risk:read', async () => {
      expect(await tenantRolesAllowed(route(RiskManagementController, 'GET', 'dashboard'))).toEqual(
        sorted(TA, TR, SU, CO),
      );
    });

    it('policy changes need risk:config:update', async () => {
      expect(await tenantRolesAllowed(route(RiskManagementController, 'POST', 'policy'))).toEqual([TA]);
    });

    it('trigger/request/acknowledge need risk:kill_switch_update', async () => {
      for (const p of ['breaker/trigger', 'breaker/:id/acknowledge', 'kill-switch/request', 'kill-switch/:id/acknowledge']) {
        expect(await tenantRolesAllowed(route(RiskManagementController, 'POST', p))).toEqual(sorted(TA, TR, CO));
      }
    });

    it('clearing a breaker or kill switch needs risk:protection_clear', async () => {
      for (const p of ['breaker/:id/clear', 'kill-switch/:id/clear']) {
        expect(await tenantRolesAllowed(route(RiskManagementController, 'POST', p))).toEqual([TA]);
      }
    });

    it('the pre-trade check needs execution:submit or risk:config:update', async () => {
      expect(await tenantRolesAllowed(route(RiskManagementController, 'POST', 'check'))).toEqual(sorted(TA, TR));
    });
  });

  describe('billing notifications', () => {
    it('history needs subscription:read or invoice:read', async () => {
      expect(await tenantRolesAllowed(route(BillingNotificationController, 'GET', 'history'))).toEqual(
        sorted(TA, SU, FI),
      );
    });

    it('outbound webhook subscriptions need tenant:update', async () => {
      for (const [m, p] of [
        ['GET', 'webhooks'],
        ['POST', 'webhooks'],
        ['POST', 'webhooks/:id/rotate-secret'],
        ['DELETE', 'webhooks/:id'],
      ] as Array<[Method, string]>) {
        expect(await tenantRolesAllowed(route(BillingNotificationController, m, p))).toEqual([TA]);
      }
    });

    it('worker and cross-tenant reconciliation are platform-only', async () => {
      for (const [m, p] of [
        ['POST', 'worker/process'],
        ['GET', 'worker/stuck'],
        ['GET', 'reconciliation/:tenantId'],
        ['POST', 'reconciliation/all'],
      ] as Array<[Method, string]>) {
        const r = route(BillingNotificationController, m, p);
        expect(await tenantRolesAllowed(r)).toEqual([]);
        expect(await allowed(r, WILDCARD_TENANT_USER)).toBe(false);
      }
    });
  });

  describe('providers', () => {
    it('is platform-only', async () => {
      for (const r of routesOf(ProviderController)) {
        expect(await tenantRolesAllowed(r)).toEqual([]);
        expect(await allowed(r, WILDCARD_TENANT_USER)).toBe(false);
      }
      const metricsOnly: Actor = { ...SUPER_ADMIN, permissions: [Permission.PLATFORM_READ_METRICS] };
      expect(await allowed(route(ProviderController, 'GET', 'health'), metricsOnly)).toBe(true);
      expect(await allowed(route(ProviderController, 'POST', 'actions/enable-disable'), metricsOnly)).toBe(false);
    });
  });

  describe('research', () => {
    it.each([
      ['POST', 'datasets', [TA]],
      ['GET', 'datasets', [TA, TR, SU, CO]],
      ['POST', 'datasets/:datasetId/validate', [TA]],
      ['GET', 'market-data/candles', [TA, TR, SU, CO]],
      ['POST', 'backtests', [TA, TR]],
      ['POST', 'backtests/monte-carlo', [TA, TR]],
      ['GET', 'backtests/:runId', [TA, TR, CO]],
      ['POST', 'paper-sessions/:sessionId/orders', [TA, TR]],
      ['GET', 'paper-sessions', [TA, TR, SU, CO]],
      ['GET', 'strategy-versions/:versionId', [TA, TR, CO]],
      ['POST', 'strategy-versions/:versionId/publish', [TA, TR]],
      ['POST', 'signals/:signalId/publish', [TA, TR]],
      ['GET', 'signals', [TA, TR, CO]],
      ['POST', 'promotions/:promotionId/request', [TA, TR]],
      ['POST', 'promotions/:promotionId/approve', [TA]],
      ['POST', 'promotions/:promotionId/promote', [TA]],
    ] as Array<[Method, string, SystemRole[]]>)('%s %s', async (m, p, roles) => {
      expect(await tenantRolesAllowed(route(ResearchController, m, p))).toEqual(sorted(...roles));
    });
  });

  describe('payment webhooks', () => {
    it('Stripe and NowPayments callbacks pass the guards without a user (signature is the authentication)', async () => {
      for (const p of ['stripe', 'nowpayments']) {
        const r = route(WebhookController, 'POST', p);
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, handlers(WebhookController)[r.handler])).toBe(true);
        expect(await allowed(r, undefined)).toBe(true);
      }
    });

    it('the signature-bypassing test endpoint is not public and is platform-only', async () => {
      const r = route(WebhookController, 'POST', 'stripe/test');
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handlers(WebhookController)[r.handler])).toBeUndefined();
      expect(await allowed(r, undefined)).toBe(false);
      expect(await allowed(r, WILDCARD_TENANT_USER)).toBe(false);
      expect(await tenantRolesAllowed(r)).toEqual([]);
      expect(await allowed(r, SUPER_ADMIN)).toBe(true);
    });
  });
});

describe('handler identity fixes', () => {
  function billingController(overrides: Record<string, unknown> = {}) {
    const inApp = {
      listNotifications: jest.fn(async () => []),
      getUnreadCount: jest.fn(async () => 0),
      markRead: jest.fn(async () => ({ ok: true })),
      markAllRead: jest.fn(async () => ({ count: 0 })),
    };
    const prefs = {
      getPreferences: jest.fn(async () => []),
      updatePreference: jest.fn(async () => ({})),
      updatePreferencesBulk: jest.fn(async () => []),
    };
    const ctrl = new BillingNotificationController(
      {} as never,
      prefs as never,
      {} as never,
      {} as never,
      {} as never,
      inApp as never,
    );
    Object.assign(ctrl, overrides);
    return { ctrl, inApp, prefs };
  }

  const followerReq = (extra: Record<string, unknown> = {}) => ({
    user: { userId: 'user-7', tenantId: 'tenant-1', permissions: roleActor(FO).permissions, isPlatformUser: false },
    ...extra,
  });

  it('billing inbox uses the actor userId (it used to read user.id and resolve every inbox to "unknown")', async () => {
    const { ctrl, inApp } = billingController();
    const res = await ctrl.getInbox(followerReq(), {} as never);
    expect(inApp.listNotifications).toHaveBeenCalledWith('tenant-1', 'user-7', expect.any(Object));
    expect(res.userId).toBe('user-7');
    await ctrl.markAllRead(followerReq());
    expect(inApp.markAllRead).toHaveBeenCalledWith('tenant-1', 'user-7');
  });

  it('refuses to guess a user when the actor has no userId', async () => {
    const { ctrl, inApp } = billingController();
    await expect(ctrl.getUnreadCount({ user: { tenantId: 'tenant-1' } })).rejects.toBeInstanceOf(ForbiddenException);
    expect(inApp.getUnreadCount).not.toHaveBeenCalled();
  });

  it('preference writes are scoped to the caller', async () => {
    const { ctrl, prefs } = billingController();
    await ctrl.updatePreference(followerReq(), { eventKey: 'invoice.paid', channel: 'EMAIL', enabled: false } as never);
    expect(prefs.updatePreference).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-7' }));
  });

  it("reading another user's preferences needs tenant:update", async () => {
    const { ctrl, prefs } = billingController();
    await expect(ctrl.getPreferences(followerReq(), 'user-other')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prefs.getPreferences).not.toHaveBeenCalled();

    await ctrl.getPreferences(followerReq(), 'user-7');
    expect(prefs.getPreferences).toHaveBeenLastCalledWith('tenant-1', 'user-7');

    const admin = {
      user: { userId: 'admin-1', tenantId: 'tenant-1', permissions: roleActor(TA).permissions, isPlatformUser: false },
    };
    await ctrl.getPreferences(admin, 'user-other');
    expect(prefs.getPreferences).toHaveBeenLastCalledWith('tenant-1', 'user-other');
  });

  it('developer-portal audit entries are attributed to the real user, not "system"', () => {
    const ctrl = Object.create(DeveloperController.prototype) as {
      actor: (tenantId: string, request: unknown) => { actorId: string; actorType: string };
    };
    const result = ctrl.actor('tenant-1', { user: { userId: 'user-9' }, headers: {}, id: 'req-1' });
    expect(result.actorId).toBe('user-9');
    expect(result.actorType).toBe('USER');
  });

  it('the SSO routes (moved to modules/auth/sso in Part 11) take the tenant only from the host and pass no client-supplied tenant or user through', async () => {
    const complete = jest.fn(async () => ({ result: { tokens: { accessToken: 'a' }, user: { id: 'user-1' }, sessionId: 's' }, returnTo: null }));
    const start = jest.fn(async () => ({ providerType: 'OIDC', authorizationUrl: 'https://idp/authorize', bindingToken: 'b', expiresIn: 600 }));
    const ctrl = new SsoAuthController({ complete, start } as never);
    const tenant = { tenantId: 'tenant-host', slug: 'acme', status: 'ACTIVE', source: 'subdomain', defaultLocale: 'en', defaultCurrency: 'USD' };
    const meta = { requestId: 'r', correlationId: 'c', ipHash: 'ip', ip: '1.2.3.4', userAgent: 'ua', locale: 'en', method: 'POST', path: '/' };
    const forgedBody = { state: 's', code: 'c', bindingToken: 'b', deviceId: 'd', tenantId: 'tenant-evil', userId: 'admin-1' };
    await ctrl.callback(forgedBody as never, tenant as never, meta as never);
    const [tenantArg, input] = complete.mock.calls[0] as unknown as [{ tenantId: string }, Record<string, unknown>];
    expect(tenantArg.tenantId).toBe('tenant-host');
    expect(input).not.toHaveProperty('tenantId');
    expect(input).not.toHaveProperty('userId');
    await ctrl.start({ providerType: 'OIDC', deviceId: 'd', tenantId: 'tenant-evil' } as never, tenant as never, meta as never);
    expect((start.mock.calls[0] as unknown as [{ tenantId: string }])[0].tenantId).toBe('tenant-host');

    // All three are public (no JWT yet) and on a strict throttle.
    for (const method of ['start', 'callback', 'samlAcs'] as const) {
      const handler = SsoAuthController.prototype[method];
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
      expect(Reflect.getMetadataKeys(handler).some((key: unknown) => String(key).startsWith('THROTTLER:LIMIT'))).toBe(true);
    }
  });

  it('the SAML ACS answers 303 to the configured completion URI, or a generic 401 when the login is unknown', async () => {
    const consumeSamlResponse = jest
      .fn()
      .mockResolvedValueOnce({ redirectTo: 'https://acme.app.test/api/auth/sso/callback?state=s&code=h' })
      .mockResolvedValueOnce({ redirectTo: null });
    const ctrl = new SsoAuthController({ consumeSamlResponse } as never);
    const res = () => {
      const r: Record<string, jest.Mock> = {};
      r.setHeader = jest.fn(() => r);
      r.redirect = jest.fn(() => r);
      r.status = jest.fn(() => r);
      r.json = jest.fn(() => r);
      return r;
    };
    const tenant = { tenantId: 'tenant-host' };
    const meta = { requestId: 'r', ipHash: 'ip', userAgent: 'ua', locale: 'en' };
    const ok = res();
    await ctrl.samlAcs({ body: { SAMLResponse: 'x', RelayState: 's', tenantId: 'evil' } } as never, ok as never, tenant as never, meta as never);
    expect(consumeSamlResponse).toHaveBeenLastCalledWith(tenant, { SAMLResponse: 'x', RelayState: 's' }, expect.any(Object));
    expect(ok.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(ok.redirect).toHaveBeenCalledWith(303, 'https://acme.app.test/api/auth/sso/callback?state=s&code=h');
    const unknown = res();
    await ctrl.samlAcs({ body: {} } as never, unknown as never, tenant as never, meta as never);
    expect(unknown.status).toHaveBeenCalledWith(401);
    expect(unknown.redirect).not.toHaveBeenCalled();
    expect(JSON.stringify(unknown.json.mock.calls)).not.toMatch(/tenant|user|exist/i);
  });
});
