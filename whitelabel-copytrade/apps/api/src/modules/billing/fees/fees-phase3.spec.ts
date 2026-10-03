/**
 * Phase 3: platform-wide billing jobs iterate real tenants (no silent []),
 * and TRADER payouts verify the beneficiary belongs to the tenant.
 */

import { forEachTenant, listBillableTenantIds } from '../finance/tenant-iteration';
import { FeeReconciliationService } from './fee-reconciliation.service';
import { FeeAnalyticsService } from './fee-analytics.service';
import { PayoutService } from './payout.service';
import { BeneficiaryType } from './payout.types';

const TRADER_UUID = '11111111-2222-4333-8444-555555555555';

function prismaWithTenants(ids: string[]) {
  return {
    tenant: { findMany: jest.fn(async () => ids.map((id) => ({ id }))) },
    traderProfile: { findFirst: jest.fn() },
  };
}

describe('tenant iteration', () => {
  it('lists ACTIVE and SUSPENDED tenants ordered by id', async () => {
    const prisma = prismaWithTenants(['t1', 't2']);
    await expect(listBillableTenantIds(prisma as any, 50)).resolves.toEqual(['t1', 't2']);
    expect(prisma.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ['ACTIVE', 'SUSPENDED'] } }, orderBy: { id: 'asc' }, take: 50 }),
    );
  });

  it('refuses to run without prisma instead of returning an empty (all-clean) result', async () => {
    await expect(listBillableTenantIds(undefined)).rejects.toThrow(/Tenant iteration unavailable/);
  });

  it('isolates one tenant failure', async () => {
    const out = await forEachTenant(['a', 'b'], async (t) => {
      if (t === 'a') throw new Error('boom');
      return t.toUpperCase();
    });
    expect(out).toEqual([{ tenantId: 'a', error: 'boom' }, { tenantId: 'b', result: 'B' }]);
  });
});

describe('FeeReconciliationService.reconcileAllTenants', () => {
  it('reconciles every billable tenant', async () => {
    const svc = new FeeReconciliationService({} as any, {} as any, {} as any, {} as any, {} as any, prismaWithTenants(['t1', 't2']) as any);
    const spy = jest.spyOn(svc, 'reconcileTenant').mockImplementation(async (tenantId: string) => ({ tenantId, issues: [] }) as any);
    const results = await svc.reconcileAllTenants();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(results.map((r: any) => r.tenantId)).toEqual(['t1', 't2']);
  });
});

describe('FeeAnalyticsService.getPlatformAnalytics', () => {
  it('sums per-tenant analytics in minor units for one currency', async () => {
    const svc = new FeeAnalyticsService({} as any, {} as any, {} as any, prismaWithTenants(['t1', 't2']) as any);
    jest.spyOn(svc, 'getTenantAnalytics').mockImplementation(async (tenantId: string) => ({
      tenantId,
      platformFeeTotal: tenantId === 't1' ? '10.05' : '0.95',
      performanceFeeTotal: '1.00',
      totalFees: '2.00',
      accruedTotal: '2.00',
      settledTotal: '1.00',
      paidTotal: '0.50',
      pendingTotal: '0.25',
      reversedTotal: '0.00',
      failedCount: 1,
      accrualCount: 3,
      settlementCount: 1,
      payoutCount: 2,
      breakdownBySource: { COPY_TRADE: '1.50' },
      breakdownByCurrency: { USD: '2.00' },
      breakdownByFeeType: { PLATFORM_FEE: '2.00' },
    }));
    const r = await svc.getPlatformAnalytics({ currency: 'USD' });
    expect(r.tenantCount).toBe(2);
    expect(r.platformFeeTotal).toBe('11.00');
    expect(r.performanceFeeTotal).toBe('2.00');
    expect(r.breakdownBySource).toEqual({ COPY_TRADE: '3.00' });
    expect(r.failedCount).toBe(2);
    expect(r.payoutCount).toBe(4);
    expect(r.failedTenants).toEqual([]);
    expect(r.note).toBeUndefined();
  });
});

describe('PayoutService TRADER beneficiary verification', () => {
  function build(prisma: any) {
    const payoutRepository = { findByIdempotencyKey: jest.fn(async () => null), create: jest.fn() };
    const settlementRepository = {
      findById: jest.fn(async () => ({ id: 's1', status: 'FINALIZED', currency: 'USD', finalSettlementAmount: '100.00' })),
    };
    const svc = new PayoutService(payoutRepository as any, settlementRepository as any, {} as any, {} as any, undefined, prisma);
    return { svc, payoutRepository };
  }
  const params = {
    settlementId: 's1',
    tenantId: 'tenant-1',
    beneficiaryId: TRADER_UUID,
    beneficiaryType: BeneficiaryType.TRADER,
    destination: { type: 'internal_account' } as any,
  };

  it('refuses a trader that is not in this tenant', async () => {
    const prisma = prismaWithTenants([]);
    prisma.traderProfile.findFirst.mockResolvedValue(null);
    const { svc, payoutRepository } = build(prisma);
    await expect(svc.createPayout(params)).rejects.toThrow('Beneficiary is not a trader of this tenant');
    expect(prisma.traderProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-1', OR: [{ id: TRADER_UUID }, { userId: TRADER_UUID }] } }));
    expect(payoutRepository.create).not.toHaveBeenCalled();
  });

  it('refuses suspended traders and non-uuid ids', async () => {
    const prisma = prismaWithTenants([]);
    prisma.traderProfile.findFirst.mockResolvedValue({ id: TRADER_UUID, verificationState: 'SUSPENDED' });
    await expect(build(prisma).svc.createPayout(params)).rejects.toThrow(/not eligible/);
    await expect(build(prisma).svc.createPayout({ ...params, beneficiaryId: 'x' })).rejects.toThrow('Beneficiary is not a trader of this tenant');
  });

  it('fails closed without prisma', async () => {
    await expect(build(undefined).svc.createPayout(params)).rejects.toThrow('Trader beneficiary verification unavailable');
  });

  it('refuses a TENANT payout to another tenant', async () => {
    await expect(build(prismaWithTenants([])).svc.createPayout({ ...params, beneficiaryType: BeneficiaryType.TENANT, beneficiaryId: 'other' })).rejects.toThrow(
      'Tenant payout beneficiary must be the tenant itself',
    );
  });
});
