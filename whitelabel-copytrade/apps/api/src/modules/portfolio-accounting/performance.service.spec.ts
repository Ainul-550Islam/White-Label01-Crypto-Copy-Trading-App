// # Responsibility: verifies canonical exact-decimal TWR cash-flow boundaries, NAV provenance, and fail-closed behavior.

import { PerformanceService } from './performance.service';
import { AccountingPolicyService } from './accounting-policy.service';
import { NavService } from './nav.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PortfolioReturnMethodology, TWR_FLOW_BOUNDARY_RULE } from './portfolio-accounting.types';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = '22222222-2222-4222-8222-222222222222';
const START = new Date('2026-01-01T00:00:00.000Z');
const MID = new Date('2026-01-02T00:00:00.000Z');
const END = new Date('2026-01-03T00:00:00.000Z');
const CALCULATION_VERSION = 'accounting-close-v3';
const POLICY_VERSION = 'policy-v3';

function nav(at: Date, value: string, overrides: Record<string, unknown> = {}) {
  return {
    nav: value,
    cash: value,
    grossAssetValue: '0',
    grossLiability: '0',
    adjustments: '0',
    baseCurrency: 'USD',
    valuationTimestamp: at.toISOString(),
    calculationVersion: CALCULATION_VERSION,
    policyVersion: POLICY_VERSION,
    sourceReferences: [`NAV:${at.toISOString()}`],
    methodology: 'CASH_PLUS_VALUED_POSITIONS_FIFO',
    dataCompleteness: 'COMPLETE',
    evidences: [],
    canPublish: true,
    ...overrides,
  };
}

function flow(params: {
  id: string;
  idempotencyKey?: string;
  occurredAt: Date;
  cashFlowType: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER_IN' | 'TRANSFER_OUT';
  amount: string;
  currency?: string;
  baseCurrency?: string;
  baseCurrencyAmount?: string | null;
  conversionRate?: string | null;
  conversionSource?: string | null;
  conversionTimestamp?: Date | null;
  conversionStatus?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
}) {
  return {
    id: params.id,
    idempotencyKey: params.idempotencyKey ?? `idempotency:${params.id}`,
    occurredAt: params.occurredAt,
    cashFlowType: params.cashFlowType,
    amount: params.amount,
    currency: params.currency ?? 'USD',
    baseCurrency: params.baseCurrency ?? 'USD',
    baseCurrencyAmount: params.baseCurrencyAmount === undefined ? params.amount : params.baseCurrencyAmount,
    conversionRate: params.conversionRate ?? null,
    conversionSource: params.conversionSource ?? null,
    conversionTimestamp: params.conversionTimestamp ?? null,
    conversionStatus: params.conversionStatus === undefined ? 'SAME_CURRENCY' : params.conversionStatus,
    sourceType: params.sourceType ?? 'TEST_LEDGER',
    sourceId: params.sourceId ?? params.id,
  };
}

function buildService(params: {
  cashFlows?: unknown[];
  cashFlowReadError?: Error;
  navFor?: (at: Date) => ReturnType<typeof nav>;
  policyOverrides?: Record<string, unknown>;
} = {}) {
  const policy = {
    baseCurrency: 'USD',
    valuationCurrency: 'USD',
    valuationFrequency: 'DAILY',
    returnMethodology: PortfolioReturnMethodology.TIME_WEIGHTED_RETURN,
    costBasisMethod: 'FIFO',
    feeTreatment: 'NET',
    periodBoundary: 'UTC_MIDNIGHT',
    roundingMode: 'HALF_UP',
    roundingScale: 8,
    supportedAssets: ['BTC', 'USD'],
    closeRules: {
      requireReconciliation: true,
      requireValuation: true,
      requireFeeReconciliation: true,
      requireCashReconciliation: true,
      requirePositionReconciliation: true,
      allowIncompleteValuation: false,
    },
    policyVersion: POLICY_VERSION,
    calculationVersion: CALCULATION_VERSION,
    ...params.policyOverrides,
  };
  const cashFlowFindMany = params.cashFlowReadError
    ? jest.fn().mockRejectedValue(params.cashFlowReadError)
    : jest.fn().mockResolvedValue(params.cashFlows ?? []);
  const calculateNav = jest.fn(async ({ at }: { at: Date }) => params.navFor?.(at) ?? nav(at, '100'));
  const prisma = { portfolioCashLedgerEntry: { findMany: cashFlowFindMany } } as unknown as PrismaService;
  const accountingPolicy = { resolvePolicy: jest.fn().mockResolvedValue(policy) } as unknown as AccountingPolicyService;
  const navService = { calculateNav } as unknown as NavService;
  return {
    service: new PerformanceService(prisma, accountingPolicy, navService),
    cashFlowFindMany,
    calculateNav,
  };
}

describe('PerformanceService canonical TWR cash-flow accounting', () => {
  it('calculates a no-flow return only from complete source-referenced NAV observations', async () => {
    const { service, cashFlowFindMany, calculateNav } = buildService({
      navFor: (at) => nav(at, at.getTime() === START.getTime() ? '100' : '110'),
    });

    const result = await service.calculateTWR({ tenantId: TENANT_ID, profileId: PROFILE_ID, periodStart: START, periodEnd: END });

    expect(result).toMatchObject({ returnPercent: '10', canCalculate: true });
    expect(result.evidence).toMatchObject({
      methodology: 'TIME_WEIGHTED_RETURN',
      flowBoundary: TWR_FLOW_BOUNDARY_RULE,
      periodStart: START.toISOString(),
      periodEnd: END.toISOString(),
      startingNav: '100',
      endingNav: '110',
      externalCashFlows: [],
      dataCompleteness: 'COMPLETE',
      calculationVersion: CALCULATION_VERSION,
      sourceReferences: [`NAV:${START.toISOString()}`, `NAV:${END.toISOString()}`],
    });
    expect(cashFlowFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId: TENANT_ID,
        profileId: PROFILE_ID,
        cashFlowType: { in: ['DEPOSIT', 'WITHDRAWAL', 'TRANSFER_IN', 'TRANSFER_OUT'] },
        occurredAt: { gte: START, lte: END },
      },
      take: 101,
    }));
    expect(calculateNav).toHaveBeenCalledTimes(2);
  });

  it('neutralizes an interior deposit before continuing the exact chain-linked return', async () => {
    const { service, calculateNav } = buildService({
      cashFlows: [flow({ id: 'deposit-1', occurredAt: MID, cashFlowType: 'DEPOSIT', amount: '100' })],
      navFor: (at) => at.getTime() === START.getTime()
        ? nav(at, '100')
        : at.getTime() === MID.getTime()
          ? nav(at, '200')
          : nav(at, '220'),
    });

    const result = await service.calculateTWR({ tenantId: TENANT_ID, profileId: PROFILE_ID, periodStart: START, periodEnd: END });

    expect(result).toMatchObject({ returnPercent: '10', canCalculate: true });
    expect(result.evidence.flowBoundary).toBe(TWR_FLOW_BOUNDARY_RULE);
    expect(result.evidence.externalCashFlows).toEqual([expect.objectContaining({
      date: MID.toISOString(),
      amount: '100',
      type: 'DEPOSIT',
      baseCurrency: 'USD',
      sourceReference: 'TEST_LEDGER:deposit-1',
    })]);
    expect(calculateNav).toHaveBeenCalledTimes(3);
  });

  it('includes period-start flows in opening NAV and excludes period-end withdrawals from closing NAV', async () => {
    const { service } = buildService({
      cashFlows: [
        flow({ id: 'opening-deposit', occurredAt: START, cashFlowType: 'DEPOSIT', amount: '100' }),
        flow({ id: 'closing-withdrawal', occurredAt: END, cashFlowType: 'WITHDRAWAL', amount: '20' }),
      ],
      navFor: (at) => at.getTime() === START.getTime() ? nav(at, '200') : nav(at, '200'),
    });

    const result = await service.calculateTWR({ tenantId: TENANT_ID, profileId: PROFILE_ID, periodStart: START, periodEnd: END });

    expect(result).toMatchObject({ returnPercent: '10', canCalculate: true });
    expect(result.evidence.flowBoundary).toBe(TWR_FLOW_BOUNDARY_RULE);
    expect(result.evidence.externalCashFlows).toHaveLength(2);
  });

  it('aggregates same-timestamp deposits and withdrawals before measuring the boundary NAV', async () => {
    const { service } = buildService({
      cashFlows: [
        flow({ id: 'deposit-same-time', occurredAt: MID, cashFlowType: 'DEPOSIT', amount: '100' }),
        flow({ id: 'withdrawal-same-time', occurredAt: MID, cashFlowType: 'WITHDRAWAL', amount: '50' }),
      ],
      navFor: (at) => at.getTime() === START.getTime()
        ? nav(at, '100')
        : at.getTime() === MID.getTime()
          ? nav(at, '150')
          : nav(at, '165'),
    });

    const result = await service.calculateTWR({ tenantId: TENANT_ID, profileId: PROFILE_ID, periodStart: START, periodEnd: END });

    expect(result).toMatchObject({ returnPercent: '10', canCalculate: true });
  });

  it('fails closed for missing FX, duplicated idempotency evidence, NAV gaps, or failed cash-flow reads', async () => {
    const missingFx = buildService({
      cashFlows: [flow({
        id: 'foreign-flow',
        occurredAt: MID,
        cashFlowType: 'DEPOSIT',
        amount: '1',
        currency: 'BTC',
        baseCurrency: 'USD',
        baseCurrencyAmount: null,
        conversionStatus: 'MISSING_FX',
      })],
    });
    const missingFxResult = await missingFx.service.calculateTWR({ tenantId: TENANT_ID, profileId: PROFILE_ID, periodStart: START, periodEnd: END });
    expect(missingFxResult.canCalculate).toBe(false);
    expect(missingFxResult.evidence.dataCompleteness).toBe('UNAVAILABLE');
    expect(missingFxResult.evidence.flowBoundary).toBe(TWR_FLOW_BOUNDARY_RULE);
    expect(missingFx.calculateNav).not.toHaveBeenCalled();

    const duplicateFlow = flow({ id: 'duplicate-1', idempotencyKey: 'same-key', occurredAt: MID, cashFlowType: 'DEPOSIT', amount: '1' });
    const duplicate = buildService({ cashFlows: [duplicateFlow, { ...duplicateFlow, id: 'duplicate-2' }] });
    const duplicateResult = await duplicate.service.calculateTWR({ tenantId: TENANT_ID, profileId: PROFILE_ID, periodStart: START, periodEnd: END });
    expect(duplicateResult.canCalculate).toBe(false);
    expect(duplicateResult.reason).toBe('INVALID_EXTERNAL_CASH_FLOW_EVIDENCE');

    const incompleteNav = buildService({
      navFor: (at) => nav(at, '100', { dataCompleteness: 'MISSING_PRICE_INCOMPLETE', canPublish: true }),
    });
    const incompleteNavResult = await incompleteNav.service.calculateTWR({ tenantId: TENANT_ID, profileId: PROFILE_ID, periodStart: START, periodEnd: END });
    expect(incompleteNavResult.canCalculate).toBe(false);
    expect(incompleteNavResult.evidence.dataCompleteness).toBe('UNAVAILABLE');
    expect(incompleteNavResult.returnPercent).toBeNull();

    const readFailure = buildService({ cashFlowReadError: new Error('storage outage') });
    const readFailureResult = await readFailure.service.calculateTWR({ tenantId: TENANT_ID, profileId: PROFILE_ID, periodStart: START, periodEnd: END });
    expect(readFailureResult.canCalculate).toBe(false);
    expect(readFailureResult.reason).toBe('CASH_FLOW_SOURCE_UNAVAILABLE');
    expect(readFailureResult.evidence.externalCashFlows).toBeNull();
  });
});
