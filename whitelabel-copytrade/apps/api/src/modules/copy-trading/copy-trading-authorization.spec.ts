import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { NotFoundException, RequestMethod, type ExecutionContext } from '@nestjs/common';
import { SYSTEM_ROLE_DEFINITIONS, SystemRole } from '@wlct/shared-types';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../../common/constants/metadata.constants';
import { CopyTradingController } from './copy-trading.controller';
import { TraderStrategyStatus } from './copy-trading.types';

/**
 * The copy-trading controller used to carry no permission metadata, so every
 * authenticated tenant user passed the global PermissionsGuard: a FOLLOWER
 * could create a trader profile and publish strategies, FINANCE/COMPLIANCE
 * staff could open copy subscriptions, and any user could read every
 * strategy (drafts included) with the trader's private strategyConfig.
 *
 * Guard tests drive the real PermissionsGuard with the real role definitions
 * against every route of the real controller; handler tests cover catalogue
 * visibility.
 */

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface Route {
  handler: string;
  method: Method;
  path: string;
}

const METHOD_NAMES: Partial<Record<RequestMethod, Method>> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
};

const proto = CopyTradingController.prototype as unknown as Record<string, object>;

const routes: Route[] = Object.getOwnPropertyNames(CopyTradingController.prototype)
  .filter((name) => name !== 'constructor')
  .map((name) => {
    const fn = proto[name] as object;
    const path = Reflect.getMetadata(PATH_METADATA, fn) as string | undefined;
    const method = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
    if (path === undefined || method === undefined) return null;
    return { handler: name, method: METHOD_NAMES[method] ?? 'GET', path } as Route;
  })
  .filter((r): r is Route => r !== null);

function route(method: Method, path: string): Route {
  const found = routes.find((r) => r.method === method && r.path === path);
  if (!found) throw new Error(`route ${method} ${path} missing`);
  return found;
}

function roleActor(role: SystemRole) {
  const def = SYSTEM_ROLE_DEFINITIONS.find((d) => d.key === role);
  if (!def) throw new Error(`role ${role} missing`);
  return {
    userId: `user-${role}`,
    tenantId: 'tenant-1',
    isPlatformUser: false,
    roles: [role],
    permissions: [...def.permissions] as string[],
  };
}

type Actor = ReturnType<typeof roleActor>;

async function allowed(r: Route, actor: Actor): Promise<boolean> {
  const guard = new PermissionsGuard(
    new Reflector(),
    {
      getEffectiveAccess: async () => ({
        permissionKeys: actor.permissions,
        roleKeys: actor.roles,
      }),
    } as never,
    { record: async () => undefined } as never,
  );
  const request = {
    actor,
    headers: {},
    originalUrl: `/api/v1/copy-trading/${r.path}`,
    method: r.method,
    tenantContext: { tenantId: actor.tenantId },
  };
  const context = {
    getType: () => 'http',
    getHandler: () => proto[r.handler],
    getClass: () => CopyTradingController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  try {
    return await guard.canActivate(context);
  } catch {
    return false;
  }
}

const TRADER_SIDE: Array<[Method, string]> = [
  ['POST', 'traders/profile'],
  ['PUT', 'traders/:traderId/profile'],
  ['POST', 'strategies'],
  ['PUT', 'strategies/:strategyId'],
  ['POST', 'strategies/:strategyId/publish'],
  ['POST', 'executions/leader-event'],
];

const SUBSCRIBE_SIDE: Array<[Method, string]> = [
  ['POST', 'subscriptions'],
  ['POST', 'subscriptions/:subscriptionId/pause'],
  ['POST', 'subscriptions/:subscriptionId/stop'],
  ['DELETE', 'subscriptions/:subscriptionId'],
];

const CATALOGUE: Array<[Method, string]> = [
  ['GET', 'traders'],
  ['GET', 'strategies'],
  ['GET', 'strategies/:strategyId'],
  ['GET', 'rankings'],
  ['GET', 'traders/:traderId/performance'],
];

describe('CopyTradingController authorization (real guard, real roles)', () => {
  // The route count is a deliberate tripwire: adding a route must force a
  // conscious re-review of its permission metadata rather than letting it slip
  // in unreviewed. It moved 35 -> 37 when the two performance-evidence routes
  // were added, and the assertion below (every handler carries PERMISSIONS_KEY)
  // still holds for all of them.
  it('discovers all 37 routes and every one carries handler-level permission metadata', () => {
    expect(routes).toHaveLength(37);
    const undecorated = routes.filter((r) => {
      const required = Reflect.getMetadata(PERMISSIONS_KEY, proto[r.handler] as object) as
        string[] | undefined;
      return !required || required.length === 0;
    });
    expect(undecorated.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  it('a FOLLOWER cannot act as a trader (profile, strategies, leader events)', async () => {
    const follower = roleActor(SystemRole.FOLLOWER);
    for (const [m, p] of TRADER_SIDE)
      expect({ route: `${m} ${p}`, ok: await allowed(route(m, p), follower) }).toEqual({
        route: `${m} ${p}`,
        ok: false,
      });
  });

  it('a FOLLOWER can browse the catalogue and manage their own copies', async () => {
    const follower = roleActor(SystemRole.FOLLOWER);
    for (const [m, p] of [
      ...CATALOGUE,
      ...SUBSCRIBE_SIDE,
      ['GET', 'subscriptions/me'] as [Method, string],
      ['GET', 'executions'] as [Method, string],
    ]) {
      expect({ route: `${m} ${p}`, ok: await allowed(route(m, p), follower) }).toEqual({
        route: `${m} ${p}`,
        ok: true,
      });
    }
  });

  it('a TRADER can run the trader side', async () => {
    const trader = roleActor(SystemRole.TRADER);
    for (const [m, p] of [...TRADER_SIDE, ...CATALOGUE])
      expect({ route: `${m} ${p}`, ok: await allowed(route(m, p), trader) }).toEqual({
        route: `${m} ${p}`,
        ok: true,
      });
  });

  it('back-office roles without copy permissions cannot subscribe or act as traders', async () => {
    for (const role of [SystemRole.FINANCE, SystemRole.COMPLIANCE, SystemRole.SUPPORT]) {
      const actor = roleActor(role);
      for (const [m, p] of [...SUBSCRIBE_SIDE, ...TRADER_SIDE]) {
        expect({ role, route: `${m} ${p}`, ok: await allowed(route(m, p), actor) }).toEqual({
          role,
          route: `${m} ${p}`,
          ok: false,
        });
      }
    }
  });

  it('trader verification and copy reconciliation are tenant-admin only', async () => {
    const admin = roleActor(SystemRole.TENANT_ADMIN);
    for (const role of [SystemRole.FOLLOWER, SystemRole.TRADER, SystemRole.SUPPORT]) {
      const actor = roleActor(role);
      expect(await allowed(route('POST', 'traders/:traderId/verify'), actor)).toBe(false);
      expect(await allowed(route('POST', 'reconciliation/run'), actor)).toBe(false);
      expect(await allowed(route('GET', 'reconciliation/records'), actor)).toBe(false);
    }
    expect(await allowed(route('POST', 'traders/:traderId/verify'), admin)).toBe(true);
    expect(await allowed(route('POST', 'reconciliation/run'), admin)).toBe(true);
    expect(await allowed(route('POST', 'reconciliation/:recordId/resolve'), admin)).toBe(true);
  });
});

describe('CopyTradingController catalogue visibility', () => {
  const TENANT = 'tenant-1';

  function strategy(id: string, status: TraderStrategyStatus, userId = 'user-owner') {
    return {
      strategyId: id,
      tenantId: TENANT,
      traderId: 'trader-1',
      userId,
      name: id,
      description: null,
      status,
      type: 'MANUAL',
      supportedSymbols: [],
      supportedVenues: [],
      riskProfile: {},
      feePolicy: {},
      strategyConfig: { secretEdge: 42 },
      publishedAt: null,
      pausedAt: null,
      archivedAt: null,
      followerCount: 0,
      totalCopies: 0,
      createdAt: '',
      updatedAt: '',
    };
  }

  function build() {
    // The public profile route projects through `getSafePublicStatistics` as well as reading the
    // profile, so a double that stubs only `getProfile` reports the projection as a crash rather
    // than testing the visibility rules this suite is about.
    const traderProfileService = {
      getProfile: jest.fn(),
      getSafePublicStatistics: jest.fn(async () => ({
        traderId: 'trader-1',
        activeFollowers: { status: 'UNAVAILABLE', value: null },
      })),
    };
    const traderStrategyService = {
      getStrategy: jest.fn(),
      listByTenant: jest.fn(),
      listByTrader: jest.fn(),
    };
    const traderPerformanceService = {
      getPerformance: jest.fn(async () => ({ traderId: 'trader-1' })),
    };
    const none = {};
    const controller = new CopyTradingController(
      ...([
        traderProfileService,
        traderStrategyService,
        none,
        none,
        none,
        traderPerformanceService,
        none,
        none,
        none,
        none,
      ] as unknown as ConstructorParameters<typeof CopyTradingController>),
    );
    return { controller, traderProfileService, traderStrategyService, traderPerformanceService };
  }

  const req = (userId: string, roles: string[]) => ({
    user: { userId, tenantId: TENANT, roles },
    headers: {},
  });

  it('a follower lists only published/paused strategies and never sees strategyConfig', async () => {
    const { controller, traderStrategyService } = build();
    traderStrategyService.listByTenant.mockResolvedValue({
      data: [strategy('s1', TraderStrategyStatus.PUBLISHED)],
      total: 1,
    });
    const res = (await controller.listStrategies(
      req('user-f', ['FOLLOWER']),
      {} as never,
    )) as unknown as { data: Array<Record<string, unknown>> };
    expect(traderStrategyService.listByTenant).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({
        statuses: [TraderStrategyStatus.PUBLISHED, TraderStrategyStatus.PAUSED],
      }),
    );
    expect(res.data[0]).not.toHaveProperty('strategyConfig');
    expect(res.data[0]).toMatchObject({ strategyId: 's1' });
  });

  it('a tenant admin lists every status with the full record', async () => {
    const { controller, traderStrategyService } = build();
    traderStrategyService.listByTenant.mockResolvedValue({
      data: [strategy('s1', TraderStrategyStatus.DRAFT)],
      total: 1,
    });
    const res = (await controller.listStrategies(
      req('user-a', ['TENANT_ADMIN']),
      {} as never,
    )) as unknown as { data: Array<Record<string, unknown>> };
    expect(traderStrategyService.listByTenant.mock.calls[0]?.[1]).not.toHaveProperty('statuses');
    expect(res.data[0]).toHaveProperty('strategyConfig');
  });

  it("another user's draft is 404; the owner gets it with its configuration", async () => {
    const { controller, traderStrategyService } = build();
    traderStrategyService.getStrategy.mockResolvedValue(
      strategy('s-draft', TraderStrategyStatus.DRAFT, 'user-owner'),
    );
    await expect(
      controller.getStrategy(req('user-f', ['FOLLOWER']), 's-draft'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.getStrategy(req('user-owner', ['TRADER']), 's-draft'),
    ).resolves.toHaveProperty('strategyConfig', { secretEdge: 42 });
  });

  it('a published strategy is readable by followers without strategyConfig', async () => {
    const { controller, traderStrategyService } = build();
    traderStrategyService.getStrategy.mockResolvedValue(
      strategy('s-live', TraderStrategyStatus.PUBLISHED),
    );
    const res = await controller.getStrategy(req('user-f', ['FOLLOWER']), 's-live');
    expect(res).not.toHaveProperty('strategyConfig');
  });

  it("a trader's own strategy list is complete; others see the public subset", async () => {
    const { controller, traderProfileService, traderStrategyService } = build();
    traderProfileService.getProfile.mockResolvedValue({
      traderId: 'trader-1',
      userId: 'user-owner',
      isPublic: true,
    });
    traderStrategyService.listByTrader.mockResolvedValue({
      data: [strategy('s1', TraderStrategyStatus.PUBLISHED)],
      total: 1,
    });
    await controller.listTraderStrategies(req('user-owner', ['TRADER']), 'trader-1', {});
    expect(traderStrategyService.listByTrader.mock.calls[0]?.[2]).not.toHaveProperty('statuses');
    await controller.listTraderStrategies(req('user-f', ['FOLLOWER']), 'trader-1', {});
    expect(traderStrategyService.listByTrader.mock.calls[1]?.[2]).toMatchObject({
      statuses: [TraderStrategyStatus.PUBLISHED, TraderStrategyStatus.PAUSED],
    });
  });

  it('a non-public trader profile and its performance are 404 to other users', async () => {
    const { controller, traderProfileService, traderPerformanceService } = build();
    traderProfileService.getProfile.mockResolvedValue({
      traderId: 'trader-1',
      userId: 'user-owner',
      isPublic: false,
    });
    await expect(
      controller.getTraderProfile(req('user-f', ['FOLLOWER']), 'trader-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.getTraderPerformance(req('user-f', ['FOLLOWER']), 'trader-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(traderPerformanceService.getPerformance).not.toHaveBeenCalled();
    await expect(
      controller.getTraderProfile(req('user-owner', ['TRADER']), 'trader-1'),
    ).resolves.toMatchObject({ traderId: 'trader-1' });
  });
});
