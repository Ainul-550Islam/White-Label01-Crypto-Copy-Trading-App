import { Logger } from '@nestjs/common';
import { OrderReconciliationService } from './order-reconciliation.service';
import { FillReconciliationService } from './fill-reconciliation.service';
import { PositionReconciliationService } from './position-reconciliation.service';

/**
 * Reconciliation read fallbacks are observable (round 7):
 *  - order reconciliation that cannot read the OMS intent table reconciles from the canonical
 *    order row, and says so (intentSource CANONICAL_ORDER_FALLBACK + intentReadError, warn log);
 *  - fill reconciliation whose OMS fill read fails does NOT turn the failure into "every
 *    canonical fill is missing": the OMS comparisons are skipped, the failure is logged and
 *    reported (omsFillsRead FAILED, readFailures 1); canonical-only checks still run;
 *  - the tenant-wide fill run counts intent lookup failures instead of swallowing them;
 *  - position reconciliation counts and logs findings that could not be stored, like order and
 *    fill reconciliation already did.
 * Logs carry the error code only, never the Prisma message (it can echo row values).
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const SECRET_LOOKING_VALUE = 'row-value-that-must-not-be-logged';

function readFailure(): Error {
  return Object.assign(new Error(`relation does not exist ${SECRET_LOOKING_VALUE}`), { code: 'P2021' });
}

describe('OMS reconciliation read fallbacks', () => {
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('order reconciliation', () => {
    const canonical = { id: 'intent-1', tenantId: TENANT, clientOrderId: 'c-1', status: 'SUBMITTED', exchangeOrderId: null, quantity: '1', metadata: {} };

    function prisma(intentRead: jest.Mock) {
      return {
        omsOrderIntent: { findFirst: intentRead, findMany: intentRead },
        order: {
          findFirst: jest.fn(async () => canonical),
          findMany: jest.fn(async () => [canonical]),
        },
        orderEvent: { findFirst: jest.fn(async () => ({ id: 'ack' })) },
        omsReconciliation: { create: jest.fn(async ({ data }: any) => ({ id: 'rec', ...data })) },
      };
    }

    it('reports the OMS intent as the source when the read works', async () => {
      const service = new OrderReconciliationService(
        prisma(jest.fn(async () => ({ ...canonical, state: 'SUBMITTED' }))) as any,
      );
      const result = await service.reconcileOrder({ tenantId: TENANT, intentId: 'intent-1' });

      expect(result).toMatchObject({ intentSource: 'OMS_INTENT', intentReadError: null });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('falls back to the canonical order visibly when the OMS intent read fails', async () => {
      const service = new OrderReconciliationService(prisma(jest.fn(async () => { throw readFailure(); })) as any);
      const result = await service.reconcileOrder({ tenantId: TENANT, intentId: 'intent-1' });

      expect(result).toMatchObject({ intentSource: 'CANONICAL_ORDER_FALLBACK', intentReadError: 'P2021' });
      const warned = JSON.stringify(warnSpy.mock.calls);
      expect(warned).toContain('OMS intent read failed');
      expect(warned).toContain('P2021');
      expect(warned).not.toContain(SECRET_LOOKING_VALUE);
    });

    it('tenant run: reports the list fallback and counts per-order fallbacks', async () => {
      const service = new OrderReconciliationService(prisma(jest.fn(async () => { throw readFailure(); })) as any);
      const result = await service.reconcileTenant({ tenantId: TENANT });

      expect(result).toMatchObject({ totalChecked: 1, intentSource: 'CANONICAL_ORDER_FALLBACK', intentReadError: 'P2021', readFallbacks: 1 });
      expect(JSON.stringify(warnSpy.mock.calls)).toContain('OMS intent list read failed');
    });
  });

  describe('fill reconciliation', () => {
    function prisma(omsRead: jest.Mock, create = jest.fn(async ({ data }: any) => ({ id: 'rec', ...data }))) {
      return {
        fill: {
          findMany: jest.fn(async () => [
            { venueTradeId: 'trade-1', quantity: '1', price: '100', fee: '0', feeCurrency: 'USDT' },
            { venueTradeId: 'trade-1', quantity: '1', price: '100', fee: '0', feeCurrency: 'USDT' },
          ]),
        },
        omsFill: { findMany: omsRead },
        omsOrderIntent: { findFirst: jest.fn(async () => { throw readFailure(); }) },
        order: { findMany: jest.fn(async () => [{ id: 'order-1', clientOrderId: 'c-1' }]) },
        omsReconciliation: { create },
      };
    }

    it('does not report a failed OMS read as missing fills; reports the read failure instead', async () => {
      const create = jest.fn(async ({ data }: any) => ({ id: 'rec', ...data }));
      const service = new FillReconciliationService(prisma(jest.fn(async () => { throw readFailure(); }), create) as any);
      const result = await service.reconcileFillsForOrder({ tenantId: TENANT, orderId: 'order-1' });

      expect(result).toMatchObject({ omsFillsRead: 'FAILED', omsFillsReadError: 'P2021', readFailures: 1 });
      // Only the canonical-only check (the duplicated canonical fill) produced a finding.
      expect(result.findings.map((f: any) => f.category)).toEqual(['DUPLICATE_FILL']);
      expect(create).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(errorSpy.mock.calls);
      expect(logged).toContain('OMS fill read failed');
      expect(logged).toContain('P2021');
      expect(logged).not.toContain(SECRET_LOOKING_VALUE);
    });

    it('still compares against OMS fills when the read works', async () => {
      const service = new FillReconciliationService(prisma(jest.fn(async () => [])) as any);
      const result = await service.reconcileFillsForOrder({ tenantId: TENANT, orderId: 'order-1' });

      expect(result).toMatchObject({ omsFillsRead: 'OK', omsFillsReadError: null, readFailures: 0 });
      expect(result.findings.map((f: any) => f.category)).toEqual(['MISSING_FILL', 'QUANTITY_DRIFT', 'DUPLICATE_FILL']);
    });

    it('tenant run: counts intent lookup failures and read failures', async () => {
      const service = new FillReconciliationService(prisma(jest.fn(async () => { throw readFailure(); })) as any);
      const result = await service.reconcileTenantFills({ tenantId: TENANT });

      expect(result).toMatchObject({ totalChecked: 1, intentLookupFailures: 1, readFailures: 1, withFindings: 1 });
      expect(result.results).toHaveLength(1);
      expect(JSON.stringify(warnSpy.mock.calls)).toContain('OMS intent lookup failed');
    });
  });

  describe('position reconciliation persistence', () => {
    function prisma(create: jest.Mock) {
      return {
        position: { findFirst: jest.fn(async () => null) },
        order: { findMany: jest.fn(async () => [{ id: 'order-1', side: 'BUY', symbol: 'BTCUSDT' }]) },
        fill: { findMany: jest.fn(async () => [{ orderId: 'order-1', quantity: '1', price: '100', fee: '0' }]) },
        omsReconciliation: { create },
      };
    }

    it('counts and logs a finding that could not be stored (error code only)', async () => {
      const create = jest.fn(async () => {
        throw Object.assign(new Error(`Foreign key constraint failed ${SECRET_LOOKING_VALUE}`), { code: 'P2003' });
      });
      const service = new PositionReconciliationService(prisma(create) as any);
      const result = await service.reconcilePosition({ tenantId: TENANT, accountId: 'acct-1', symbol: 'BTCUSDT' });

      expect(result.totalFindings).toBeGreaterThan(0);
      expect(result.persistedFindings).toBe(0);
      expect(result.persistFailures).toBe(result.totalFindings);
      const logged = JSON.stringify(errorSpy.mock.calls);
      expect(logged).toContain('NOT persisted');
      expect(logged).toContain('P2003');
      expect(logged).not.toContain(SECRET_LOOKING_VALUE);
      expect(JSON.stringify(warnSpy.mock.calls)).toContain(`persistFailures ${result.totalFindings}`);
    });

    it('reports stored findings as persisted', async () => {
      const service = new PositionReconciliationService(prisma(jest.fn(async ({ data }: any) => ({ id: 'rec', ...data }))) as any);
      const result = await service.reconcilePosition({ tenantId: TENANT, accountId: 'acct-1', symbol: 'BTCUSDT' });

      expect(result.totalFindings).toBeGreaterThan(0);
      expect(result.persistedFindings).toBe(result.totalFindings);
      expect(result.persistFailures).toBe(0);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
