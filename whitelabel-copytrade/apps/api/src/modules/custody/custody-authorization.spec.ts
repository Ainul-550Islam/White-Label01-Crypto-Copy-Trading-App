import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod, type ExecutionContext } from '@nestjs/common';
import { SYSTEM_ROLE_DEFINITIONS, SystemRole } from '@wlct/shared-types';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CustodyController } from './custody.controller';

/**
 * Custody endpoints move or attest to real funds and are not scoped to an
 * individual customer. They used to carry no permission metadata at all, so
 * the global PermissionsGuard let every authenticated tenant user through
 * (including POST deposits/observe, which fabricates an on-chain deposit).
 *
 * This spec drives the real PermissionsGuard with the real role definitions
 * against every route of the real controller.
 */

interface Route {
  handler: string;
  method: 'GET' | 'POST';
  path: string;
}

const routes: Route[] = Object.getOwnPropertyNames(CustodyController.prototype)
  .filter((name) => name !== 'constructor')
  .map((name) => {
    const fn = (CustodyController.prototype as unknown as Record<string, unknown>)[name] as object;
    const path = Reflect.getMetadata(PATH_METADATA, fn) as string | undefined;
    const method = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
    if (path === undefined || method === undefined) return null;
    return { handler: name, method: method === RequestMethod.GET ? 'GET' : 'POST', path } as Route;
  })
  .filter((r): r is Route => r !== null);

function roleActor(role: SystemRole, isPlatformUser = false) {
  const def = SYSTEM_ROLE_DEFINITIONS.find((d) => d.key === role);
  if (!def) throw new Error(`role ${role} missing`);
  return {
    userId: `user-${role}`,
    tenantId: 'tenant-1',
    isPlatformUser,
    roles: [role],
    permissions: [...def.permissions] as string[],
  };
}

type Actor = ReturnType<typeof roleActor>;

async function allowed(route: Route, actor: Actor): Promise<boolean> {
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
    originalUrl: `/api/v1/custody/${route.path}`,
    method: route.method,
    tenantContext: { tenantId: actor.tenantId },
  };
  const context = {
    getType: () => 'http',
    getHandler: () =>
      (CustodyController.prototype as unknown as Record<string, unknown>)[route.handler],
    getClass: () => CustodyController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  try {
    return await guard.canActivate(context);
  } catch {
    return false;
  }
}

const CHAIN_INGESTION = new Set([
  'deposits/observe',
  'deposits/:depositId/confirmations',
  'deposits/:depositId/reorg',
  'transactions/:transactionId/poll',
  'transactions/:transactionId/reorg',
  'confirmations/observe',
]);

describe('CustodyController authorization', () => {
  it('discovers every custody route', () => {
    expect(routes).toHaveLength(46);
    expect(routes.filter((r) => r.method === 'GET')).toHaveLength(18);
  });

  it.each([SystemRole.FOLLOWER, SystemRole.TRADER, SystemRole.SUPPORT])(
    '%s cannot call any custody route',
    async (role) => {
      const actor = roleActor(role);
      const open: string[] = [];
      for (const route of routes)
        if (await allowed(route, actor)) open.push(`${route.method} ${route.path}`);
      expect(open).toEqual([]);
    },
  );

  it('a tenant user never reaches chain-ingestion routes, even with every tenant permission', async () => {
    const tenantAdmin = roleActor(SystemRole.TENANT_ADMIN);
    const finance = roleActor(SystemRole.FINANCE);
    const superAdmin = roleActor(SystemRole.SUPER_ADMIN, true);
    const allTenantPerms = {
      ...finance,
      permissions: [...new Set([...tenantAdmin.permissions, ...finance.permissions])],
    };
    for (const route of routes.filter((r) => CHAIN_INGESTION.has(r.path))) {
      expect(await allowed(route, allTenantPerms)).toBe(false);
      expect(await allowed(route, superAdmin)).toBe(true);
    }
  });

  it('finance (payout:manage) operates treasury mutations and reads, but not chain ingestion', async () => {
    const finance = roleActor(SystemRole.FINANCE);
    for (const route of routes) {
      if (CHAIN_INGESTION.has(route.path)) continue;
      if (route.path === 'reconciliation/resolve' || route.path === 'reconciliation/run') continue;
      expect({ route: route.path, ok: await allowed(route, finance) }).toEqual({
        route: route.path,
        ok: true,
      });
    }
  });

  it('report readers (tenant admin, compliance) get read-only oversight', async () => {
    for (const role of [SystemRole.TENANT_ADMIN, SystemRole.COMPLIANCE]) {
      const actor = roleActor(role);
      for (const route of routes.filter((r) => r.method === 'GET')) {
        expect({ role, route: route.path, ok: await allowed(route, actor) }).toEqual({
          role,
          route: route.path,
          ok: true,
        });
      }
      for (const path of [
        'wallets',
        'withdrawals/submit',
        'settlement/deposit/finalize',
        'sweeps/execute',
        'internal-transfers/settle',
        'reserves',
      ]) {
        const route = routes.find((r) => r.method === 'POST' && r.path === path);
        expect(route).toBeDefined();
        expect({ role, path, ok: await allowed(route as Route, actor) }).toEqual({
          role,
          path,
          ok: false,
        });
      }
    }
  });

  it('super admin can call every route', async () => {
    const superAdmin = roleActor(SystemRole.SUPER_ADMIN, true);
    for (const route of routes) expect(await allowed(route, superAdmin)).toBe(true);
  });
});
