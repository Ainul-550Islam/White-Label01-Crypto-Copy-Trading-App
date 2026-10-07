// # Responsibility: verifies tenant-scoped persisted closed-period TWR retrieval and nullability of unsupported fill-derived metrics.

import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PerformanceCalculationService } from './performance-calculation.service';
import { TraderPerformanceService } from './trader-performance.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const TRADER_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const PROFILE_ID = '44444444-4444-4444-8444-444444444444';
const START = new Date('2026-01-01T00:00:00.000Z');
const MID = new Date('2026-01-02T00:00:00.000Z');
const NEXT = new Date('2026-01-03T00:00:00.000Z');
const END = new Date('2026-01-04T00:00:00.000Z');

interface PeriodFixture {
  id: string;
  profileId: string;
  periodId: string;
  periodStart: Date;
  periodEnd: Date;
  returnPercent: string | null;
  baseCurrency: string;
  methodology: string;
  calculationVersion: string;
  dataCompleteness: string;
  sourceReferences: Prisma.JsonValue;
  evidence: Prisma.JsonValue;
  period: {
    id: string;
    tenantId: string;
    profileId: string;
    periodStart: Date;
    periodEnd: Date;
    calculationVersion: string;
    state: string;
    closes: Array<{ validationPassed: boolean; reconciliationStatus: string; calculationVersion: string }>;
  };
}

function makePeriod(params: {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  returnPercent: string | null;
  calculationVersion?: string;
  state?: string;
  validationPassed?: boolean;
  reconciliationStatus?: string;
  baseCurrency?: string;
  dataCompleteness?: string;
  sourceReferences?: Prisma.JsonValue;
  flowBoundary?: string | null;
  periodTenantId?: string;
  periodProfileId?: string;
  periodCalculationVersion?: string;
  closeCalculationVersion?: string;
}): PeriodFixture {
  const calculationVersion = params.calculationVersion ?? 'accounting-close-v3';
  return {
    id: params.id,
    profileId: PROFILE_ID,
    periodId: `accounting-period-${params.id}`,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    returnPercent: params.returnPercent,
    baseCurrency: params.baseCurrency ?? 'USD',
    methodology: 'TIME_WEIGHTED_RETURN',
    calculationVersion,
    dataCompleteness: params.dataCompleteness ?? 'COMPLETE',
    sourceReferences: params.sourceReferences ?? [`accounting-close:${params.id}`],
    evidence: {
      flowBoundary: params.flowBoundary === undefined
        ? 'START_FLOWS_IN_OPENING_NAV_END_FLOWS_EXCLUDED_FROM_CLOSING_NAV'
        : params.flowBoundary,
    },
    period: {
      id: `accounting-period-${params.id}`,
      tenantId: params.periodTenantId ?? TENANT_ID,
      profileId: params.periodProfileId ?? PROFILE_ID,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      calculationVersion: params.periodCalculationVersion ?? calculationVersion,
      state: params.state ?? 'CLOSED',
      closes: [{
        validationPassed: params.validationPassed ?? true,
        reconciliationStatus: params.reconciliationStatus ?? 'OK',
        calculationVersion: params.closeCalculationVersion ?? calculationVersion,
      }],
    },
  };
}

function buildService(params: {
  records?: PeriodFixture[];
  profiles?: Array<{ id: string; baseCurrency: string; returnMethodology: string; calculationVersion: string }>;
  trader?: { id: string; userId: string } | null;
  latestPeriodEnd?: Date | null;
  readError?: Error;
} = {}): {
  service: TraderPerformanceService;
  traderFindFirst: jest.Mock;
  accountingProfileFindMany: jest.Mock;
  performanceFindMany: jest.Mock;
  performanceFindFirst: jest.Mock;
} {
  const traderFindFirst = jest.fn().mockResolvedValue(params.trader === undefined ? { id: TRADER_ID, userId: USER_ID } : params.trader);
  const accountingProfileFindMany = jest.fn().mockResolvedValue(params.profiles ?? [{ id: PROFILE_ID, baseCurrency: 'USD', returnMethodology: 'TIME_WEIGHTED_RETURN', calculationVersion: 'accounting-close-v3' }]);
  const performanceFindMany = params.readError
    ? jest.fn().mockRejectedValue(params.readError)
    : jest.fn().mockResolvedValue(params.records ?? []);
  const performanceFindFirst = params.readError
    ? jest.fn().mockRejectedValue(params.readError)
    : jest.fn().mockResolvedValue(params.latestPeriodEnd === null
      ? null
      : { periodEnd: params.latestPeriodEnd ?? END });
  const prisma = {
    traderProfile: { findFirst: traderFindFirst },
    portfolioAccountingProfile: { findMany: accountingProfileFindMany },
    portfolioPerformanceRecord: {
      findMany: performanceFindMany,
      findFirst: performanceFindFirst,
    },
  } as unknown as PrismaService;

  return {
    service: new TraderPerformanceService(prisma, new PerformanceCalculationService()),
    traderFindFirst,
    accountingProfileFindMany,
    performanceFindMany,
    performanceFindFirst,
  };
}

describe('TraderPerformanceService verified accounting-period integration (GAP-55)', () => {
  it('links only tenant-scoped closed and reconciled periods with exact decimal arithmetic', async () => {
    const records = [
      makePeriod({ id: 'p1', periodStart: START, periodEnd: MID, returnPercent: '10' }),
      makePeriod({ id: 'p2', periodStart: MID, periodEnd: NEXT, returnPercent: '-10' }),
      makePeriod({ id: 'p3', periodStart: NEXT, periodEnd: END, returnPercent: '21' }),
    ];
    const { service, traderFindFirst, accountingProfileFindMany, performanceFindMany, performanceFindFirst } = buildService({ records });

    const result = await service.getPerformance(TENANT_ID, TRADER_ID);

    expect(traderFindFirst).toHaveBeenCalledWith({
      where: { id: TRADER_ID, tenantId: TENANT_ID, deletedAt: null },
      select: { id: true, userId: true },
    });
    expect(accountingProfileFindMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, scope: 'TRADER', scopeId: { in: [TRADER_ID, USER_ID] }, isActive: true },
      select: { id: true, baseCurrency: true, returnMethodology: true, calculationVersion: true },
    });
    expect(performanceFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: TENANT_ID,
        profileId: PROFILE_ID,
        periodId: { not: null },
        methodology: 'TIME_WEIGHTED_RETURN',
        dataCompleteness: 'COMPLETE',
        period: { is: { tenantId: TENANT_ID, profileId: PROFILE_ID, state: 'CLOSED', closes: { some: { tenantId: TENANT_ID, validationPassed: true, reconciliationStatus: 'OK' } } } },
      }),
      orderBy: [{ periodStart: 'asc' }, { periodEnd: 'asc' }, { id: 'asc' }],
      take: 501,
    }));
    expect(performanceFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: TENANT_ID, profileId: PROFILE_ID }),
      orderBy: [{ periodEnd: 'desc' }, { id: 'asc' }],
      select: { periodEnd: true },
    }));
    expect(result).toMatchObject({
      traderId: TRADER_ID,
      tenantId: TENANT_ID,
      methodology: 'TIME_WEIGHTED_RETURN',
      flowBoundary: 'START_FLOWS_IN_OPENING_NAV_END_FLOWS_EXCLUDED_FROM_CLOSING_NAV',
      calculationVersion: 'twr-linked-periods-v1-integer-decimal',
      sourceCalculationVersion: 'accounting-close-v3',
      dataCompleteness: 'COMPLETE',
      source: 'RECONCILED_CLOSED_PERIOD_RECORDS',
      totalReturnPercent: '19.79',
      maxDrawdownPercent: '10',
      baseCurrency: 'USD',
      asOf: END.toISOString(),
      observationCount: 3,
      sourceReferences: ['accounting-close:p1', 'accounting-close:p2', 'accounting-close:p3'],
      currentnessRule: 'AS_OF_DISPLAYED_CURRENTNESS_NOT_ASSERTED',
      realizedPnl: null,
      unrealizedPnl: null,
      totalReturn: null,
      maxDrawdown: null,
      winCount: null,
      lossCount: null,
      tradeCount: null,
      winRate: null,
      totalVolume: null,
      profitFactor: null,
    });
  });

  it('fails closed when fewer than two verified accounting periods are persisted', async () => {
    const { service } = buildService({
      records: [makePeriod({ id: 'p1', periodStart: START, periodEnd: END, returnPercent: '500' })],
    });

    const result = await service.getPerformance(TENANT_ID, TRADER_ID);

    expect(result?.totalReturnPercent).toBeNull();
    expect(result?.maxDrawdownPercent).toBeNull();
    expect(result?.dataCompleteness).toBe('UNAVAILABLE');
    expect(result?.observationCount).toBe(1);
    expect(result?.unavailableReason).toMatch(/at least 2/i);
  });

  it('does not accept an open or unreconciled period even if the query mock returns it', async () => {
    const { service } = buildService({
      records: [
        makePeriod({ id: 'p1', periodStart: START, periodEnd: MID, returnPercent: '10', reconciliationStatus: 'MISMATCH' }),
        makePeriod({ id: 'p2', periodStart: MID, periodEnd: END, returnPercent: '10' }),
      ],
    });

    const result = await service.getPerformance(TENANT_ID, TRADER_ID);

    expect(result?.totalReturnPercent).toBeNull();
    expect(result?.dataCompleteness).toBe('UNAVAILABLE');
    expect(result?.unavailableReason).toMatch(/incomplete, unreconciled, unsupported, or missing flow-boundary evidence/i);
  });

  it('rejects a persisted performance row linked to a different accounting-profile period', async () => {
    const { service } = buildService({
      records: [
        makePeriod({ id: 'p1', periodStart: START, periodEnd: MID, returnPercent: '10', periodProfileId: 'other-profile' }),
        makePeriod({ id: 'p2', periodStart: MID, periodEnd: END, returnPercent: '10' }),
      ],
    });

    const result = await service.getPerformance(TENANT_ID, TRADER_ID);

    expect(result?.totalReturnPercent).toBeNull();
    expect(result?.dataCompleteness).toBe('UNAVAILABLE');
    expect(result?.unavailableReason).toMatch(/incomplete, unreconciled, unsupported, or missing flow-boundary evidence/i);
  });

  it('rejects accounting periods whose linked period or close calculation version does not match', async () => {
    const { service } = buildService({
      records: [
        makePeriod({ id: 'p1', periodStart: START, periodEnd: MID, returnPercent: '10', closeCalculationVersion: 'accounting-close-v2' }),
        makePeriod({ id: 'p2', periodStart: MID, periodEnd: END, returnPercent: '10' }),
      ],
    });

    const result = await service.getPerformance(TENANT_ID, TRADER_ID);

    expect(result?.dataCompleteness).toBe('UNAVAILABLE');
    expect(result?.totalReturnPercent).toBeNull();
    expect(result?.unavailableReason).toMatch(/incomplete, unreconciled, unsupported, or missing flow-boundary evidence/i);
  });

  it('rejects missing flow-boundary evidence and profile/source calculation-version mismatches', async () => {
    const missingBoundary = buildService({
      records: [
        makePeriod({ id: 'p1', periodStart: START, periodEnd: MID, returnPercent: '10', flowBoundary: null }),
        makePeriod({ id: 'p2', periodStart: MID, periodEnd: END, returnPercent: '10' }),
      ],
    });
    const missingBoundaryResult = await missingBoundary.service.getPerformance(TENANT_ID, TRADER_ID);
    expect(missingBoundaryResult?.dataCompleteness).toBe('UNAVAILABLE');
    expect(missingBoundaryResult?.totalReturnPercent).toBeNull();
    expect(missingBoundaryResult?.flowBoundary).toBeNull();
    expect(missingBoundaryResult?.unavailableReason).toMatch(/flow-boundary evidence/i);

    const versionMismatch = buildService({
      profiles: [{ id: PROFILE_ID, baseCurrency: 'USD', returnMethodology: 'TIME_WEIGHTED_RETURN', calculationVersion: 'accounting-close-v4' }],
      records: [
        makePeriod({ id: 'p1', periodStart: START, periodEnd: MID, returnPercent: '10' }),
        makePeriod({ id: 'p2', periodStart: MID, periodEnd: END, returnPercent: '10' }),
      ],
    });
    const versionMismatchResult = await versionMismatch.service.getPerformance(TENANT_ID, TRADER_ID);
    expect(versionMismatchResult?.dataCompleteness).toBe('UNAVAILABLE');
    expect(versionMismatchResult?.totalReturnPercent).toBeNull();
    expect(versionMismatchResult?.unavailableReason).toMatch(/persisted periods do not match the active accounting profile calculation version/i);
  });

  it('requires the active trader accounting profile to use time-weighted return', async () => {
    const { service, performanceFindMany } = buildService({
      profiles: [{ id: PROFILE_ID, baseCurrency: 'USD', returnMethodology: 'MONEY_WEIGHTED_RETURN', calculationVersion: 'accounting-close-v3' }],
    });

    const result = await service.getPerformance(TENANT_ID, TRADER_ID);

    expect(result?.dataCompleteness).toBe('UNAVAILABLE');
    expect(result?.unavailableReason).toMatch(/does not use time-weighted return/i);
    expect(performanceFindMany).not.toHaveBeenCalled();
  });

  it('keeps missing or ambiguous active accounting profiles unavailable and never merges profile scopes', async () => {
    const missing = buildService({ profiles: [] });
    const missingResult = await missing.service.getPerformance(TENANT_ID, TRADER_ID);
    expect(missingResult?.dataCompleteness).toBe('UNAVAILABLE');
    expect(missingResult?.unavailableReason).toMatch(/No active trader-scoped accounting profile/i);
    expect(missing.performanceFindMany).not.toHaveBeenCalled();

    const ambiguous = buildService({ profiles: [
      { id: PROFILE_ID, baseCurrency: 'USD', returnMethodology: 'TIME_WEIGHTED_RETURN', calculationVersion: 'accounting-close-v3' },
      { id: '55555555-5555-4555-8555-555555555555', baseCurrency: 'USD', returnMethodology: 'TIME_WEIGHTED_RETURN', calculationVersion: 'accounting-close-v3' },
    ] });
    const ambiguousResult = await ambiguous.service.getPerformance(TENANT_ID, TRADER_ID);
    expect(ambiguousResult?.dataCompleteness).toBe('UNAVAILABLE');
    expect(ambiguousResult?.unavailableReason).toMatch(/Multiple active trader-scoped accounting profiles/i);
    expect(ambiguous.performanceFindMany).not.toHaveBeenCalled();
  });

  it('returns null for a missing or cross-tenant trader profile', async () => {
    const { service, accountingProfileFindMany } = buildService({ trader: null });

    const result = await service.getPerformance(TENANT_ID, TRADER_ID);

    expect(result).toBeNull();
    expect(accountingProfileFindMany).not.toHaveBeenCalled();
  });

  it('fails closed on persistence errors and does not substitute zero-valued metrics', async () => {
    const { service } = buildService({ readError: new Error('database unavailable') });

    const result = await service.getPerformance(TENANT_ID, TRADER_ID);

    expect(result?.totalReturnPercent).toBeNull();
    expect(result?.realizedPnl).toBeNull();
    expect(result?.winRate).toBeNull();
    expect(result?.dataCompleteness).toBe('UNAVAILABLE');
    expect(result?.unavailableReason).toBe('Persisted reconciled accounting-period evidence could not be read.');
  });
});
