import { Logger } from '@nestjs/common';
import { OrderReconciliationService } from './order-reconciliation.service';
import { FillReconciliationService } from './fill-reconciliation.service';
import { reconciliationErrorCode } from './oms.types';

/**
 * Reconciliation findings that cannot be stored are never dropped silently:
 * they stay in the returned result, are counted (persistedFindings /
 * persistFailures) and are logged at error level with the error code only,
 * never with the row values that a Prisma error message can echo.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const SECRET_LOOKING_VALUE = 'row-value-that-must-not-be-logged';

function storeFailure(): Error {
  return Object.assign(new Error(`Foreign key constraint failed ... ${SECRET_LOOKING_VALUE}`), { code: 'P2003' });
}

describe('reconciliationErrorCode', () => {
  it('prefers the Prisma error code, then the error class name, never the message', () => {
    expect(reconciliationErrorCode(Object.assign(new Error('secret'), { code: 'P2002' }))).toBe('P2002');
    expect(reconciliationErrorCode(new TypeError('secret'))).toBe('TypeError');
    expect(reconciliationErrorCode(null)).toBe('UNKNOWN');
    expect(reconciliationErrorCode('secret')).toBe('UNKNOWN');
  });
});

describe('OMS reconciliation persistence observability', () => {
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  function orderPrisma(create: jest.Mock) {
    return {
      omsOrderIntent: { findFirst: jest.fn(async () => ({ id: 'intent-1', tenantId: TENANT, clientOrderId: 'c-1', state: 'SUBMITTED', metadata: {} })) },
      order: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
      orderEvent: { findFirst: jest.fn(async () => null) },
      omsReconciliation: { create },
    };
  }

  it('order reconciliation: counts and logs a finding that could not be stored', async () => {
    const service = new OrderReconciliationService(orderPrisma(jest.fn(async () => { throw storeFailure(); })) as any);
    const result = await service.reconcileOrder({ tenantId: TENANT, intentId: 'intent-1' });

    expect(result.totalFindings).toBe(1);
    expect(result.findings[0].category).toBe('MISSING_EXCHANGE_ORDER');
    expect(result.persistedFindings).toBe(0);
    expect(result.persistFailures).toBe(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0][0]);
    expect(logged).toContain('NOT persisted');
    expect(logged).toContain(TENANT);
    expect(logged).toContain('P2003');
    expect(logged).not.toContain(SECRET_LOOKING_VALUE);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('persistFailures 1'));
  });

  it('order reconciliation: reports every stored finding as persisted', async () => {
    const create = jest.fn(async ({ data }: any) => ({ id: 'rec-1', ...data }));
    const service = new OrderReconciliationService(orderPrisma(create) as any);
    const result = await service.reconcileOrder({ tenantId: TENANT, intentId: 'intent-1' });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.persistedFindings).toBe(1);
    expect(result.persistFailures).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  function fillPrisma(create: jest.Mock) {
    return {
      fill: { findMany: jest.fn(async () => [{ venueTradeId: 'trade-1', quantity: '1', price: '100' }]) },
      omsFill: { findMany: jest.fn(async () => []) },
      omsReconciliation: { create },
    };
  }

  it('fill reconciliation: counts and logs a finding that could not be stored', async () => {
    const service = new FillReconciliationService(fillPrisma(jest.fn(async () => { throw storeFailure(); })) as any);
    const result = await service.reconcileFillsForOrder({ tenantId: TENANT, orderId: 'order-1' });

    // One canonical fill with no OMS fill: MISSING_FILL plus the cumulative QUANTITY_DRIFT (1 vs 0).
    expect(result.findings.map((f: any) => f.category)).toEqual(['MISSING_FILL', 'QUANTITY_DRIFT']);
    expect(result.persistedFindings).toBe(0);
    expect(result.persistFailures).toBe(2);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('persistFailures 2'));
    const logged = String(errorSpy.mock.calls[0][0]);
    expect(logged).toContain('order-1');
    expect(logged).toContain('P2003');
    expect(logged).not.toContain(SECRET_LOOKING_VALUE);
  });

  it('fill reconciliation: reports every stored finding as persisted', async () => {
    const service = new FillReconciliationService(fillPrisma(jest.fn(async ({ data }: any) => ({ id: 'rec-1', ...data }))) as any);
    const result = await service.reconcileFillsForOrder({ tenantId: TENANT, orderId: 'order-1' });

    expect(result.totalFindings).toBe(2);
    expect(result.persistedFindings).toBe(2);
    expect(result.persistFailures).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
