import { ServiceUnavailableException } from '@nestjs/common';

import { MaintenanceModeService } from './maintenance-mode.service';
import { MaintenanceWindowService } from './maintenance-window.service';
import { OperationalMaintenanceScope, activeMaintenanceWhere } from './operations.types';

/**
 * Maintenance windows used to be display-only: enforceMaintenanceGate had no
 * caller, isInMaintenance returned false on any database error, and its scope
 * filter required `scope = <requested>` AND OR(scope = PLATFORM), so a
 * platform-wide or tenant-wide window never blocked a trading check. The
 * customer web, meanwhile, disabled copying for any active window - including
 * billing-only ones - based on a single window picked by end time.
 *
 * Now one rule (activeMaintenanceWhere) drives both the server gate and the
 * `blocksTrading` flag the web reads.
 */
describe('activeMaintenanceWhere', () => {
  const now = new Date('2026-10-01T00:00:00Z');

  it('trading check for a tenant: trading windows, the platform, or this tenant', () => {
    expect(activeMaintenanceWhere({ scope: OperationalMaintenanceScope.TRADING_CAPABILITY, tenantId: 't1', now })).toEqual({
      state: 'ACTIVE',
      scheduledStart: { lte: now },
      scheduledEnd: { gte: now },
      AND: [
        { OR: [{ tenantId: 't1' }, { tenantId: null }] },
        { OR: [{ scope: 'TRADING_CAPABILITY' }, { scope: 'PLATFORM' }, { scope: 'TENANT', tenantId: 't1' }] },
      ],
    });
  });

  it('a target also matches windows that cover every target', () => {
    const where = activeMaintenanceWhere({ scope: OperationalMaintenanceScope.VENUE, scopeTarget: 'binance', tenantId: 't1', now });
    expect((where.AND as unknown[])[1]).toEqual({
      OR: [
        { scope: 'VENUE', OR: [{ scopeTarget: 'binance' }, { scopeTarget: null }] },
        { scope: 'PLATFORM' },
        { scope: 'TENANT', tenantId: 't1' },
      ],
    });
  });

  it('without a tenant only platform-level (tenantId null) windows apply', () => {
    const where = activeMaintenanceWhere({ scope: OperationalMaintenanceScope.SERVICE, now });
    expect(where.AND).toEqual([{ tenantId: null }, { OR: [{ scope: 'SERVICE' }, { scope: 'PLATFORM' }] }]);
  });
});

describe('MaintenanceModeService gate', () => {
  function build(opts: { redisValue?: string | null; redisError?: boolean; window?: unknown; dbError?: boolean }) {
    const findFirst = jest.fn(async () => {
      if (opts.dbError) throw new Error('db unavailable');
      return opts.window ?? null;
    });
    const get = jest.fn(async () => {
      if (opts.redisError) throw new Error('redis down');
      return opts.redisValue ?? null;
    });
    const service = new MaintenanceModeService(
      { operationalMaintenanceWindow: { findFirst } } as never,
      {} as never,
      {} as never,
      {} as never,
      { client: { get } } as never,
    );
    return { service, findFirst };
  }
  const gate = { tenantId: 't1', scope: OperationalMaintenanceScope.TRADING_CAPABILITY, operation: 'copy_trading.subscribe' };

  it('an active window -> 503 naming the operation', async () => {
    const err = await build({ window: { id: 'mw-1' } }).service.enforceMaintenanceGate(gate).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as Error).message).toContain('copy_trading.subscribe');
  });

  it('no window -> passes', async () => {
    await expect(build({}).service.enforceMaintenanceGate(gate)).resolves.toBeUndefined();
  });

  it('the Redis fast path short-circuits; a Redis outage falls back to the database', async () => {
    const fast = build({ redisValue: 'ACTIVE' });
    await expect(fast.service.isInMaintenance(gate)).resolves.toBe(true);
    expect(fast.findFirst).not.toHaveBeenCalled();
    const fallback = build({ redisError: true, window: { id: 'mw-1' } });
    await expect(fallback.service.isInMaintenance(gate)).resolves.toBe(true);
  });

  it('a database failure propagates (it used to read as "no maintenance")', async () => {
    await expect(build({ dbError: true }).service.isInMaintenance(gate)).rejects.toThrow('db unavailable');
  });
});

describe('MaintenanceWindowService.getCurrentForTenant', () => {
  const start = new Date('2026-10-01T00:00:00Z');
  const end = new Date('2026-10-01T02:00:00Z');
  const row = (scope: string, title: string) => ({
    title,
    description: null,
    scope,
    scopeTarget: null,
    isEmergency: false,
    scheduledStart: start,
    scheduledEnd: end,
  });

  function build(blocking: unknown, any: unknown) {
    const findFirst = jest.fn().mockResolvedValueOnce(blocking).mockResolvedValueOnce(any);
    const service = new MaintenanceWindowService({ operationalMaintenanceWindow: { findFirst } } as never, {} as never, {} as never);
    return { service, findFirst };
  }

  it('reports a trading-blocking window first, with blocksTrading', async () => {
    const { service, findFirst } = build(row('TRADING_CAPABILITY', 'Exchange upgrade'), null);
    await expect(service.getCurrentForTenant('t1')).resolves.toMatchObject({
      active: true,
      title: 'Exchange upgrade',
      scope: 'TRADING_CAPABILITY',
      blocksTrading: true,
    });
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((findFirst.mock.calls[0] as [{ where: unknown }])[0].where)).toContain('"TRADING_CAPABILITY"');
  });

  it('a billing-only window is shown but does not block trading', async () => {
    const { service } = build(null, row('BILLING_CAPABILITY', 'Invoice run'));
    await expect(service.getCurrentForTenant('t1')).resolves.toMatchObject({
      active: true,
      scope: 'BILLING_CAPABILITY',
      message: 'Invoice run',
      blocksTrading: false,
    });
  });

  it('no window -> inactive', async () => {
    const { service } = build(null, null);
    await expect(service.getCurrentForTenant('t1')).resolves.toEqual({
      active: false,
      title: null,
      message: null,
      scope: null,
      scopeTarget: null,
      isEmergency: false,
      startedAt: null,
      endsAt: null,
      blocksTrading: false,
    });
  });
});
