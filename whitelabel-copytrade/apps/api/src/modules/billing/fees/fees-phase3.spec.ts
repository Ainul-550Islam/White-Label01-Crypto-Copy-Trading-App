// # Responsibility: prove typed billable-tenant iteration, complete analytics contracts, and tenant-bound payout beneficiary validation.
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { Provider } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Prisma, Tenant, TraderProfile } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { forEachTenant, listBillableTenantIds } from '../finance/tenant-iteration';
import { FeeAccrualRepository } from './fee-accrual.repository';
import { FeeSettlementRepository } from './fee-settlement.repository';
import { PayoutRepository } from './payout.repository';
import { FeeLedgerService } from './fee-ledger.service';
import { FeeAuditService } from './fee-audit.service';
import { FeeReconciliationService } from './fee-reconciliation.service';
import { FeeAnalyticsService, type TenantFeeAnalytics } from './fee-analytics.service';
import { PayoutService } from './payout.service';
import { PayoutProviderFactory } from './payout-provider.factory';
import { BeneficiaryType, type Payout } from './payout.types';
import { FeeType, FeeSourceType, FeeAccrualStatus, SettlementState, RateBasis, type FeeAccrual, type SettlementBatch } from './fee.types';
import { ForbiddenException } from '@nestjs/common';
import { FeeSettlementService } from './fee-settlement.service';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service';
import { PayoutProvider, PayoutStatus, type CreatePayoutInput, type PayoutProviderResult, type PayoutStatusResult } from './payout.types';
import type { IPayoutProvider } from './payout-provider.interface';
import { BillingNotificationController } from '../notifications/billing-notification.controller';
import { NotificationJobRepository } from '../notifications/notification-job.repository';
import { NotificationPreferenceService } from '../notifications/notification-preference.service';
import { BillingWebhookNotificationService } from '../notifications/billing-webhook-notification.service';
import { NotificationWorkerService } from '../notifications/notification-worker.service';
import { NotificationReconciliationService } from '../notifications/notification-reconciliation.service';
import { InAppNotificationService } from '../notifications/in-app-notification.service';
import { type BillingNotificationJob } from '../notifications/billing-notification.types';
import { NotificationHistoryQueryDto } from '../notifications/dto/notification-query.dto';
import { WebhookSignatureService } from '../payments/webhook.signature';
import { PaymentConfigService } from '../payments/payment.config';
import { PaymentProviderFactory } from '../payments/payment-provider.factory';
import { PaymentProvider } from '../payments/payment.types';


const TRADER_UUID = '11111111-2222-4333-8444-555555555555';
const modules: TestingModule[] = [];

async function moduleWith(providers: Provider[]): Promise<TestingModule> {
  const module = await Test.createTestingModule({ providers }).compile();
  modules.push(module);
  return module;
}

afterEach(async () => {
  for (const module of modules.splice(0)) await module.close();
  jest.restoreAllMocks();
});

function prismaWithTenants(ids: string[]) {
  return {
    tenant: {
      findMany: jest.fn<(args: Prisma.TenantFindManyArgs) => Promise<Array<Pick<Tenant, 'id'>>>>()
        .mockResolvedValue(ids.map((id) => ({ id }))),
    },
    traderProfile: {
      findFirst: jest.fn<(args: Prisma.TraderProfileFindFirstArgs) => Promise<Pick<TraderProfile, 'id' | 'verificationState'> | null>>()
        .mockResolvedValue(null),
    },
  };
}

function tenantAnalytics(tenantId: string): TenantFeeAnalytics {
  return {
    tenantId, period: 'ALL', currency: 'USD', fetchedAt: '2026-10-10T00:00:00.000Z',
    platformFeeTotal: tenantId === 't1' ? '10.05' : '0.95',
    performanceFeeTotal: '1.00', totalFees: '2.00', accruedTotal: '2.00', settledTotal: '1.00',
    paidTotal: '0.50', pendingTotal: '0.25', reversedTotal: '0.00', failedCount: 1,
    accrualCount: 3, settlementCount: 1, payoutCount: 2,
    breakdownBySource: { COPY_TRADE: '1.50' },
    breakdownByCurrency: { USD: '2.00' },
    breakdownByFeeType: { PLATFORM_FEE: '2.00' },
  };
}

function settlementRecord(): SettlementBatch {
  return {
    id: 's1', tenantId: 'tenant-1', currency: 'USD', grossFeeAmount: '100.00', adjustments: '0',
    finalSettlementAmount: '100.00', numberOfAccruals: 1, feeType: FeeType.PLATFORM_FEE,
    status: SettlementState.FINALIZED, idempotencyKey: 'settlement-key', accrualIds: ['accrual-1'],
    createdAt: '2026-10-10T00:00:00.000Z', calculatedAt: null, approvedAt: null,
    finalizedAt: '2026-10-10T00:00:00.000Z', paidAt: null, metadata: null,
  };
}

describe('tenant iteration', () => {
  it('lists ACTIVE and SUSPENDED tenants ordered by id', async () => {
    const db = prismaWithTenants(['t1', 't2']);
    const module = await moduleWith([{ provide: PrismaService, useValue: db }]);
    await expect(listBillableTenantIds(module.get<PrismaService>(PrismaService), 50)).resolves.toEqual(['t1', 't2']);
    expect(db.tenant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { in: ['ACTIVE', 'SUSPENDED'] } }, orderBy: { id: 'asc' }, take: 50,
    }));
  });

  it('refuses to run without prisma instead of returning an empty all-clean result', async () => {
    await expect(listBillableTenantIds(undefined)).rejects.toThrow(/Tenant iteration unavailable/);
  });

  it('isolates one tenant failure', async () => {
    const out = await forEachTenant(['a', 'b'], async (tenantId) => {
      if (tenantId === 'a') throw new Error('boom');
      return tenantId.toUpperCase();
    });
    expect(out).toEqual([{ tenantId: 'a', error: 'boom' }, { tenantId: 'b', result: 'B' }]);
  });
});

describe('FeeReconciliationService.reconcileAllTenants', () => {
  it('reconciles every billable tenant', async () => {
    const module = await moduleWith([
      FeeReconciliationService,
      { provide: FeeAccrualRepository, useValue: {} },
      { provide: FeeSettlementRepository, useValue: {} },
      { provide: PayoutRepository, useValue: {} },
      { provide: FeeLedgerService, useValue: {} },
      { provide: FeeAuditService, useValue: {} },
      { provide: PrismaService, useValue: prismaWithTenants(['t1', 't2']) },
    ]);
    const service = module.get<FeeReconciliationService>(FeeReconciliationService);
    const spy = jest.spyOn(service, 'reconcileTenant').mockImplementation(async (tenantId) => ({
      tenantId, checkedAccruals: 0, checkedSettlements: 0, checkedPayouts: 0, issues: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0 },
    }));
    const results = await service.reconcileAllTenants();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(results.map((row) => row.tenantId)).toEqual(['t1', 't2']);
  });
});

describe('FeeAnalyticsService.getPlatformAnalytics', () => {
  it('sums complete typed per-tenant analytics in minor units for one currency', async () => {
    const module = await moduleWith([
      FeeAnalyticsService,
      { provide: FeeAccrualRepository, useValue: {} },
      { provide: FeeSettlementRepository, useValue: {} },
      { provide: PayoutRepository, useValue: {} },
      { provide: PrismaService, useValue: prismaWithTenants(['t1', 't2']) },
    ]);
    const service = module.get<FeeAnalyticsService>(FeeAnalyticsService);
    jest.spyOn(service, 'getTenantAnalytics').mockImplementation(async (tenantId) => tenantAnalytics(tenantId));
    const result = await service.getPlatformAnalytics({ currency: 'USD' });
    if (!('tenantCount' in result)) throw new Error('Expected a platform analytics response');
    expect(result.tenantCount).toBe(2);
    expect(result.platformFeeTotal).toBe('11.00');
    expect(result.performanceFeeTotal).toBe('2.00');
    expect(result.breakdownBySource).toEqual({ COPY_TRADE: '3.00' });
    expect(result.failedCount).toBe(2);
    expect(result.payoutCount).toBe(4);
    expect(result.failedTenants).toEqual([]);
    expect(result).not.toHaveProperty('note');
  });
});

describe('PayoutService TRADER beneficiary verification', () => {
  async function build(db?: ReturnType<typeof prismaWithTenants>) {
    const payoutRepository = {
      findByIdempotencyKey: jest.fn<(key: string, tenantId: string) => Promise<Payout | null>>().mockResolvedValue(null),
      create: jest.fn<(data: Parameters<PayoutRepository['create']>[0]) => Promise<Payout>>()
        .mockRejectedValue(new Error('Unexpected payout creation before beneficiary validation')),
    };
    const settlementRepository = {
      findById: jest.fn<(id: string, tenantId?: string) => Promise<SettlementBatch | null>>().mockResolvedValue(settlementRecord()),
    };
    const providers: Provider[] = [
      PayoutService,
      { provide: PayoutRepository, useValue: payoutRepository },
      { provide: FeeSettlementRepository, useValue: settlementRepository },
      { provide: PayoutProviderFactory, useValue: {} },
      { provide: FeeAuditService, useValue: {} },
    ];
    if (db) providers.push({ provide: PrismaService, useValue: db });
    const module = await moduleWith(providers);
    return { service: module.get<PayoutService>(PayoutService), payoutRepository };
  }

  const params: Parameters<PayoutService['createPayout']>[0] = {
    settlementId: 's1', tenantId: 'tenant-1', beneficiaryId: TRADER_UUID,
    beneficiaryType: BeneficiaryType.TRADER,
    destination: { type: 'internal_account', reference: 'account-ref', maskedReference: '****-ref', currency: 'USD' },
  };

  it('refuses a trader that is not in this tenant', async () => {
    const db = prismaWithTenants([]);
    const { service, payoutRepository } = await build(db);
    await expect(service.createPayout(params)).rejects.toThrow('Beneficiary is not a trader of this tenant');
    expect(db.traderProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', OR: [{ id: TRADER_UUID }, { userId: TRADER_UUID }] },
    }));
    expect(payoutRepository.create).not.toHaveBeenCalled();
  });

  it('refuses suspended traders and non-uuid ids', async () => {
    const db = prismaWithTenants([]);
    db.traderProfile.findFirst.mockResolvedValue({ id: TRADER_UUID, verificationState: 'SUSPENDED' });
    const { service } = await build(db);
    await expect(service.createPayout(params)).rejects.toThrow(/not eligible/);
    await expect(service.createPayout({ ...params, beneficiaryId: 'x' })).rejects.toThrow('Beneficiary is not a trader of this tenant');
  });

  it('fails closed without prisma', async () => {
    const { service } = await build();
    await expect(service.createPayout(params)).rejects.toThrow('Trader beneficiary verification unavailable');
  });

  it('refuses a TENANT payout to another tenant', async () => {
    const { service } = await build();
    await expect(service.createPayout({ ...params, beneficiaryType: BeneficiaryType.TENANT, beneficiaryId: 'different-tenant' }))
      .rejects.toThrow('Tenant payout beneficiary must be the tenant itself');
  });
});


function accrualRecord(overrides: Partial<FeeAccrual> = {}): FeeAccrual {
  return {
    id: 'accrual-1', tenantId: 'tenant-1', sourceType: FeeSourceType.PAYMENT, sourceId: 'source_1',
    feeType: FeeType.PLATFORM_FEE, feeRateBps: 100, rateBasis: RateBasis.BPS,
    grossAmount: '100.00', feeAmount: '1.00', netAmount: '99.00', currency: 'USD',
    status: FeeAccrualStatus.ACCRUED, settlementState: SettlementState.DRAFT,
    payoutState: null, settlementId: null, payoutId: null, ledgerTransactionId: null,
    idempotencyKey: 'accrual-key',
    policySnapshot: {
      tenantId: 'tenant-1', planId: null, planCode: null, platformFeeBps: 100, performanceFeeBps: 0,
      currency: 'USD', effectiveAt: '2026-10-10T00:00:00.000Z', source: 'plan',
    },
    calculationTimestamp: '2026-10-10T00:00:00.000Z', settlementTimestamp: null,
    createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z',
    metadata: null, safeMetadata: null, ...overrides,
  };
}

function payoutRecord(overrides: Partial<Payout> = {}): Payout {
  return {
    id: 'payout-1', settlementId: 's1', tenantId: 'tenant-1', beneficiaryId: 'tenant-1',
    beneficiaryType: BeneficiaryType.TENANT, amount: '100.00', currency: 'USD',
    destination: { type: 'internal_account', reference: 'account-ref', maskedReference: '****-ref', currency: 'USD' },
    provider: PayoutProvider.MANUAL, providerPayoutId: 'external-payout-1', providerReference: null,
    status: PayoutStatus.PENDING, failureReason: null, idempotencyKey: 'payout-key',
    requestedAt: '2026-10-10T00:00:00.000Z', processedAt: null, succeededAt: null, failedAt: null,
    cancelledAt: null, metadata: null, safeMetadata: null,
    createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z', ...overrides,
  };
}

async function feeServices(records: FeeAccrual[] = []) {
  const accruals = {
    listByTenant: jest.fn<(tenantId: string, filter?: Parameters<FeeAccrualRepository['listByTenant']>[1]) => Promise<FeeAccrual[]>>().mockResolvedValue(records),
    listEligibleForSettlement: jest.fn<(tenantId: string, currency?: string, feeType?: FeeType, limit?: number) => Promise<FeeAccrual[]>>().mockResolvedValue(records),
    findById: jest.fn<(id: string, tenantId?: string) => Promise<FeeAccrual | null>>()
      .mockImplementation(async (id, tenantId) => records.find((row) => row.id === id && (!tenantId || row.tenantId === tenantId)) ?? null),
    updateStatus: jest.fn<(id: string, updates: Parameters<FeeAccrualRepository['updateStatus']>[1]) => Promise<FeeAccrual | null>>().mockResolvedValue(null),
  };
  const settlements = {
    listByTenant: jest.fn<(tenantId: string, filter?: Parameters<FeeSettlementRepository['listByTenant']>[1]) => Promise<SettlementBatch[]>>().mockResolvedValue([]),
    findById: jest.fn<(id: string, tenantId?: string) => Promise<SettlementBatch | null>>()
      .mockResolvedValue({ ...settlementRecord(), status: SettlementState.CALCULATED }),
    updateStatus: jest.fn<(id: string, status: SettlementState, updates?: Parameters<FeeSettlementRepository['updateStatus']>[2]) => Promise<SettlementBatch | null>>().mockResolvedValue(null),
  };
  const payouts = {
    listByTenant: jest.fn<(tenantId: string, filter?: Parameters<PayoutRepository['listByTenant']>[1]) => Promise<Payout[]>>().mockResolvedValue([]),
  };
  const audit = { logSettlementApproved: jest.fn<(tenantId: string, id: string, amount: string, currency: string) => Promise<void>>().mockResolvedValue(undefined) };
  const module = await moduleWith([
    FeeAnalyticsService, FeeSettlementService, FeeReconciliationService,
    { provide: FeeAccrualRepository, useValue: accruals },
    { provide: FeeSettlementRepository, useValue: settlements },
    { provide: PayoutRepository, useValue: payouts },
    { provide: FeeAuditService, useValue: audit },
    { provide: FeeLedgerService, useValue: {} },
    { provide: PrismaService, useValue: prismaWithTenants(['tenant-1']) },
    { provide: OutboxService, useValue: {} },
  ]);
  return {
    analytics: module.get<FeeAnalyticsService>(FeeAnalyticsService),
    settlement: module.get<FeeSettlementService>(FeeSettlementService),
    reconciliation: module.get<FeeReconciliationService>(FeeReconciliationService),
    accruals, settlements, payouts, audit,
  };
}

describe('Typed fee evidence and settlement regressions', () => {
  it('filters every tenant analytics source to the actual report currency, including the USD default', async () => {
    const { analytics, accruals, settlements, payouts } = await feeServices([accrualRecord()]);
    const result = await analytics.getTenantAnalytics('tenant-1');
    expect(result.currency).toBe('USD');
    expect(result.totalFees).toBe('1.00');
    expect(accruals.listByTenant).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ currency: 'USD' }));
    expect(settlements.listByTenant).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ currency: 'USD' }));
    expect(payouts.listByTenant).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ currency: 'USD' }));
  });

  it('refuses an invalid required fee amount instead of silently reporting partial totals', async () => {
    const { analytics } = await feeServices([accrualRecord({ feeAmount: 'invalid-money' })]);
    await expect(analytics.getTenantAnalytics('tenant-1', { currency: 'USD' })).rejects.toThrow();
  });

  it('rejects invalid fee source filters before issuing a repository query', async () => {
    const { analytics, accruals } = await feeServices();
    await expect(analytics.getFeeSummary('tenant-1', { sourceType: 'UNREVIEWED_SOURCE' })).rejects.toThrow('Invalid fee source type filter');
    expect(accruals.listByTenant).not.toHaveBeenCalled();
  });

  it('does not silently sum mixed-currency fee summary rows into one reported currency', async () => {
    const { analytics } = await feeServices([accrualRecord(), accrualRecord({ id: 'eur-accrual', currency: 'EUR' })]);
    await expect(analytics.getFeeSummary('tenant-1')).rejects.toThrow('Fee summary requires a single currency');
  });

  it('reports a failed tenant explicitly in platform analytics rather than manufacturing its totals', async () => {
    const { analytics } = await feeServices();
    jest.spyOn(analytics, 'getTenantAnalytics').mockRejectedValueOnce(new Error('tenant source unavailable'));
    const result = await analytics.getPlatformAnalytics({ currency: 'USD' });
    if (!('failedTenants' in result)) throw new Error('Expected platform analytics');
    expect(result.failedTenants).toEqual(['tenant-1']);
    expect(result.tenantCount).toBe(1);
  });

  it('deduplicates explicitly supplied accrual IDs before calculating settlement amounts', async () => {
    const { settlement } = await feeServices([accrualRecord()]);
    const result = await settlement.previewSettlement({ tenantId: 'tenant-1', accrualIds: ['accrual-1', 'accrual-1'] });
    expect(result.numberOfAccruals).toBe(1);
    expect(result.grossFeeAmount).toBe('1.00');
    expect(result.eligibleAccruals.map((row) => row.id)).toEqual(['accrual-1']);
  });

  it('does not let an explicit accrual from another tenant become settlement evidence', async () => {
    const { settlement } = await feeServices([accrualRecord({ tenantId: 'tenant-2' })]);
    const result = await settlement.previewSettlement({ tenantId: 'tenant-1', accrualIds: ['accrual-1'] });
    expect(result.eligibleAccruals).toEqual([]);
    expect(result.numberOfAccruals).toBe(0);
  });

  it('rejects an accrual whose currency differs from the settlement currency', async () => {
    const { settlement } = await feeServices([accrualRecord({ currency: 'EUR' })]);
    await expect(settlement.previewSettlement({ tenantId: 'tenant-1', accrualIds: ['accrual-1'], currency: 'USD' }))
      .rejects.toThrow('Settlement accrual currency does not match');
  });

  it('rejects malformed eligible amounts rather than creating understated settlement totals', async () => {
    const { settlement } = await feeServices([accrualRecord({ feeAmount: 'invalid-money' })]);
    await expect(settlement.previewSettlement({ tenantId: 'tenant-1' })).rejects.toThrow();
  });

  it('does not audit a successful approval when persistence returns no confirmed settlement', async () => {
    const { settlement, audit } = await feeServices();
    await expect(settlement.approveSettlement('s1', 'tenant-1')).rejects.toThrow('persistence did not confirm');
    expect(audit.logSettlementApproved).not.toHaveBeenCalled();
  });

  it('keeps enum and underscore-containing source IDs intact in duplicate-fee evidence', async () => {
    const duplicate = accrualRecord({
      sourceType: FeeSourceType.TRADING_PERFORMANCE, sourceId: 'trade_source_with_underscores', status: FeeAccrualStatus.REVERSED,
    });
    const { reconciliation } = await feeServices([duplicate, { ...duplicate, id: 'second-accrual' }]);
    const result = await reconciliation.reconcileTenant('tenant-1');
    expect(result.issues.find((issue) => issue.category === 'DUPLICATE_FEE')).toMatchObject({
      sourceType: FeeSourceType.TRADING_PERFORMANCE, sourceId: 'trade_source_with_underscores', severity: 'CRITICAL',
    });
  });
});

async function cancellationService() {
  const stored = payoutRecord();
  const cancel = jest.fn<(id: string) => Promise<{ cancelled: boolean; reason?: string }>>().mockResolvedValue({ cancelled: true });
  const provider: IPayoutProvider = {
    providerName: 'controlled-test-provider', isAvailable: () => true, normalizeStatus: () => PayoutStatus.PENDING,
    createPayout: jest.fn<(input: CreatePayoutInput) => Promise<PayoutProviderResult>>().mockRejectedValue(new Error('Unexpected payout execution')),
    getPayoutStatus: jest.fn<(id: string) => Promise<PayoutStatusResult>>().mockRejectedValue(new Error('Unexpected payout status lookup')),
    cancelPayout: cancel,
  };
  const repository = {
    findById: jest.fn<(id: string, tenantId?: string) => Promise<Payout | null>>().mockResolvedValue(stored),
    updateStatus: jest.fn<(id: string, updates: Parameters<PayoutRepository['updateStatus']>[1]) => Promise<Payout | null>>()
      .mockImplementation(async (_id, updates) => ({ ...stored, status: updates.status ?? stored.status })),
  };
  const module = await moduleWith([
    PayoutService,
    { provide: PayoutRepository, useValue: repository },
    { provide: FeeSettlementRepository, useValue: {} },
    { provide: PayoutProviderFactory, useValue: { getProvider: () => provider } },
    { provide: FeeAuditService, useValue: {} },
  ]);
  return { service: module.get<PayoutService>(PayoutService), repository, stored, provider, cancel };
}

describe('Payout cancellation confirmation', () => {
  it('refuses to mark an externally submitted payout cancelled when the provider refuses', async () => {
    const { service, repository, cancel } = await cancellationService();
    cancel.mockResolvedValue({ cancelled: false });
    await expect(service.cancelPayout('payout-1', 'tenant-1')).rejects.toThrow('Provider did not confirm');
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it('propagates provider cancellation failures without writing a fabricated cancellation', async () => {
    const { service, repository, cancel } = await cancellationService();
    const failure = new Error('provider unavailable');
    cancel.mockRejectedValue(failure);
    await expect(service.cancelPayout('payout-1', 'tenant-1')).rejects.toBe(failure);
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it('refuses external cancellation when the provider has no confirmation capability', async () => {
    const { service, repository, provider } = await cancellationService();
    delete provider.cancelPayout;
    await expect(service.cancelPayout('payout-1', 'tenant-1')).rejects.toThrow('Provider cannot confirm');
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it('writes cancellation only after positive provider confirmation', async () => {
    const { service, repository, cancel } = await cancellationService();
    const result = await service.cancelPayout('payout-1', 'tenant-1');
    expect(result?.status).toBe(PayoutStatus.CANCELLED);
    expect(cancel).toHaveBeenCalledWith('external-payout-1');
    expect(repository.updateStatus).toHaveBeenCalledWith('payout-1', expect.objectContaining({ status: PayoutStatus.CANCELLED }));
  });

  it('preserves local cancellation without inventing an external provider confirmation', async () => {
    const { service, stored, cancel } = await cancellationService();
    stored.providerPayoutId = null;
    const result = await service.cancelPayout('payout-1', 'tenant-1');
    expect(result?.status).toBe(PayoutStatus.CANCELLED);
    expect(cancel).not.toHaveBeenCalled();
  });
});

async function notificationController() {
  const jobs = {
    listByTenant: jest.fn<(tenantId: string, filter?: Parameters<NotificationJobRepository['listByTenant']>[1]) => Promise<BillingNotificationJob[]>>().mockResolvedValue([]),
  };
  const inApp = {
    getUnreadCount: jest.fn<(tenantId: string, userId: string) => Promise<number>>().mockResolvedValue(0),
  };
  const preferences = {
    getPreferences: jest.fn<(tenantId: string, userId?: string) => Promise<unknown[]>>().mockResolvedValue([]),
  };
  const module = await moduleWith([
    BillingNotificationController,
    { provide: NotificationJobRepository, useValue: jobs },
    { provide: NotificationPreferenceService, useValue: preferences },
    { provide: BillingWebhookNotificationService, useValue: {} },
    { provide: NotificationWorkerService, useValue: {} },
    { provide: NotificationReconciliationService, useValue: {} },
    { provide: InAppNotificationService, useValue: inApp },
  ]);
  return { controller: module.get<BillingNotificationController>(BillingNotificationController), jobs, inApp, preferences };
}

describe('Notification authenticated context', () => {
  it('rejects history reads when only request or query tenant overrides exist', async () => {
    const { controller, jobs } = await notificationController();
    const query = Object.assign(new NotificationHistoryQueryDto(), { tenantId: 'other-tenant' });
    await expect(controller.getHistory({ user: { userId: 'user-1' }, tenantId: 'other-tenant' }, query)).rejects.toThrow(ForbiddenException);
    expect(jobs.listByTenant).not.toHaveBeenCalled();
  });

  it('uses authenticated history scope rather than caller-supplied tenant overrides', async () => {
    const { controller, jobs } = await notificationController();
    const query = Object.assign(new NotificationHistoryQueryDto(), { tenantId: 'other-tenant' });
    const result = await controller.getHistory({ user: { userId: 'user-1', tenantId: 'tenant-1' }, tenantId: 'other-tenant' }, query);
    expect(result.tenantId).toBe('tenant-1');
    expect(jobs.listByTenant).toHaveBeenCalledWith('tenant-1', expect.any(Object));
  });

  it('supports the verified actor context and preserves its real userId', async () => {
    const { controller, inApp } = await notificationController();
    const result = await controller.getUnreadCount({ actor: { tenantId: 'tenant-1', userId: 'user-1' } });
    expect(result.userId).toBe('user-1');
    expect(inApp.getUnreadCount).toHaveBeenCalledWith('tenant-1', 'user-1');
  });

  it('does not infer a tenant from request-level fallback context for an ordinary user', async () => {
    const { controller, inApp } = await notificationController();
    await expect(controller.getUnreadCount({ user: { userId: 'user-1' }, tenantId: 'tenant-2' })).rejects.toThrow(ForbiddenException);
    expect(inApp.getUnreadCount).not.toHaveBeenCalled();
  });

  it('does not mix a user identity from one context with a tenant from a second context', async () => {
    const { controller, inApp } = await notificationController();
    await expect(controller.getUnreadCount({
      user: { userId: 'user-1' }, actor: { userId: 'other-user', tenantId: 'other-tenant' },
    })).rejects.toThrow(ForbiddenException);
    expect(inApp.getUnreadCount).not.toHaveBeenCalled();
  });

  it('does not let an ordinary actor read another user preference set', async () => {
    const { controller, preferences } = await notificationController();
    await expect(controller.getPreferences({ actor: { tenantId: 'tenant-1', userId: 'user-1', permissions: [] } }, 'user-2'))
      .rejects.toThrow(ForbiddenException);
    expect(preferences.getPreferences).not.toHaveBeenCalled();
  });
});

describe('Webhook event extraction without unsafe casts', () => {
  async function signatureService(): Promise<WebhookSignatureService> {
    const module = await moduleWith([
      WebhookSignatureService,
      { provide: PaymentConfigService, useValue: {} },
      { provide: PaymentProviderFactory, useValue: {} },
    ]);
    return module.get<WebhookSignatureService>(WebhookSignatureService);
  }

  it('preserves valid Stripe event IDs and types', async () => {
    const service = await signatureService();
    expect(service.extractEventId(PaymentProvider.STRIPE, { id: 'evt-1' })).toBe('evt-1');
    expect(service.extractEventType(PaymentProvider.STRIPE, { type: 'payment_intent.succeeded' })).toBe('payment_intent.succeeded');
  });

  it('preserves valid NowPayments numeric identifiers and order-id fallback', async () => {
    const service = await signatureService();
    expect(service.extractEventId(PaymentProvider.NOWPAYMENTS, { payment_id: 123 })).toBe('123');
    expect(service.extractEventId(PaymentProvider.NOWPAYMENTS, { order_id: 'order-1' })).toBe('order-1');
  });

  it.each([null, [], true, 'scalar'])('rejects non-record webhook event input %p', async (value) => {
    const service = await signatureService();
    expect(service.extractEventId(PaymentProvider.STRIPE, value)).toBeNull();
    expect(service.extractEventType(PaymentProvider.NOWPAYMENTS, value)).toBeNull();
  });

  it('does not return unvalidated objects or booleans as provider event IDs or types', async () => {
    const service = await signatureService();
    expect(service.extractEventId(PaymentProvider.STRIPE, { id: { nested: 'id' } })).toBeNull();
    expect(service.extractEventId(PaymentProvider.NOWPAYMENTS, { payment_id: true, order_id: [] })).toBeNull();
    expect(service.extractEventType(PaymentProvider.STRIPE, { type: 42 })).toBeNull();
    expect(service.extractEventType(PaymentProvider.NOWPAYMENTS, { payment_status: false })).toBeNull();
  });
});
