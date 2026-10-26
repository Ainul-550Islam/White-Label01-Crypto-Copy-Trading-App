// # Responsibility: verifies exact chain-linked TWR treatment of interior cash flows, withdrawals, and flow limits.
import { PerformanceService } from './performance.service';
import { AccountingPolicyService } from './accounting-policy.service';
import { NavService } from './nav.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PortfolioReturnMethodology, formatScaled, mul, SCALE_FACTOR } from './portfolio-accounting.types';

const TENANT_ID = 'tenant-twr-chain';
const PROFILE_ID = 'profile-twr-chain';
const START = new Date('2026-01-01T00:00:00.000Z');
const END = new Date('2026-01-03T00:00:00.000Z');
const MID = new Date('2026-01-02T00:00:00.000Z');

function nav(at: Date, value: string) {
  return {
    nav: value,
    cash: value,
    grossAssetValue: '0',
    grossLiability: '0',
    adjustments: '0',
    baseCurrency: 'USD',
    valuationTimestamp: at.toISOString(),
    calculationVersion: 'twr-chain-v1',
    policyVersion: 'twr-policy-v1',
    sourceReferences: [`NAV:${at.toISOString()}`],
    methodology: 'CASH_PLUS_VALUED_POSITIONS_FIFO',
    dataCompleteness: 'COMPLETE',
    evidences: [],
    canPublish: true,
  };
}

function flow(params: {
  id: string;
  occurredAt: Date;
  cashFlowType: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER_IN' | 'TRANSFER_OUT';
  amount: string;
}) {
  return {
    id: params.id,
    tenantId: TENANT_ID,
    profileId: PROFILE_ID,
    idempotencyKey: `twr-chain:${params.id}`,
    occurredAt: params.occurredAt,
    cashFlowType: params.cashFlowType,
    amount: params.amount,
    currency: 'USD',
    baseCurrency: 'USD',
    baseCurrencyAmount: params.amount,
    conversionRate: null,
    conversionSource: null,
    conversionTimestamp: null,
    conversionStatus: 'SAME_CURRENCY',
    sourceType: 'TEST_LEDGER',
    sourceId: params.id,
  };
}

function buildService(params: {
  cashFlows?: unknown[];
  cashFlowReadError?: Error;
  navFor?: (at: Date) => ReturnType<typeof nav>;
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
    policyVersion: 'twr-policy-v1',
    calculationVersion: 'twr-chain-v1',
  };
  const prisma = {
    portfolioCashLedgerEntry: {
      findMany: jest.fn(async () => {
        if (params.cashFlowReadError) throw params.cashFlowReadError;
        return params.cashFlows ?? [];
      }),
    },
  } as unknown as PrismaService;
  const policyService = {
    resolvePolicy: jest.fn(async () => policy),
  } as unknown as AccountingPolicyService;
  const navService = {
    calculateNav: jest.fn(async ({ at }: { at: Date }) => params.navFor?.(at) ?? nav(at, '100')),
  } as unknown as NavService;
  return {
    service: new PerformanceService(prisma, policyService, navService),
    calculateNav: navService.calculateNav as jest.Mock,
  };
}

const calculate = (service: PerformanceService) => service.calculateTWR({
  tenantId: TENANT_ID,
  profileId: PROFILE_ID,
  periodStart: START,
  periodEnd: END,
});

describe('PerformanceService exact TWR chain linking', () => {
  it('chains two interior cash flows at different timestamps', async () => {
    const firstFlow = new Date('2026-01-02T06:00:00.000Z');
    const secondFlow = new Date('2026-01-02T18:00:00.000Z');
    const { service } = buildService({
      cashFlows: [
        flow({ id: 'flow-1', occurredAt: firstFlow, cashFlowType: 'DEPOSIT', amount: '100' }),
        flow({ id: 'flow-2', occurredAt: secondFlow, cashFlowType: 'WITHDRAWAL', amount: '20' }),
      ],
      navFor: (at) => {
        if (at.getTime() === START.getTime()) return nav(at, '100');
        if (at.getTime() === firstFlow.getTime()) return nav(at, '200');
        if (at.getTime() === secondFlow.getTime()) return nav(at, '180');
        return nav(at, '198');
      },
    });

    const result = await calculate(service);
    expect(result).toMatchObject({ returnPercent: '10', canCalculate: true });
    expect(result.evidence.externalCashFlows).toHaveLength(2);
  });

  it('does not count a withdrawal as a loss when the portfolio later loses value', async () => {
    const { service } = buildService({
      cashFlows: [flow({
        id: 'withdrawal-before-loss',
        occurredAt: MID,
        cashFlowType: 'WITHDRAWAL',
        amount: '20',
      })],
      navFor: (at) => at.getTime() === START.getTime()
        ? nav(at, '100')
        : at.getTime() === MID.getTime()
          ? nav(at, '80')
          : nav(at, '72'),
    });

    const result = await calculate(service);
    expect(result).toMatchObject({ returnPercent: '-10', canCalculate: true });
  });

  it('does not accumulate floating-point rounding drift across 50 exact subperiods', async () => {
    const flows = Array.from({ length: 49 }, (_, index) => {
      const at = new Date(START.getTime() + (index + 1) * 1_000);
      return flow({ id: `zero-flow-${index + 1}`, occurredAt: at, cashFlowType: 'DEPOSIT', amount: '0' });
    });
    let navValue = '100';
    const navByTimestamp = new Map<number, string>([[START.getTime(), navValue]]);
    for (const item of flows) {
      navValue = mul(navValue, '1.01');
      navByTimestamp.set(item.occurredAt.getTime(), navValue);
    }
    navValue = mul(navValue, '1.01');
    navByTimestamp.set(END.getTime(), navValue);

    const { service } = buildService({
      cashFlows: flows,
      navFor: (at) => nav(at, navByTimestamp.get(at.getTime()) ?? navValue),
    });
    const toScaled = (value: string): bigint => {
      const [whole, fraction = ''] = value.split('.');
      return BigInt(whole ?? '0') * SCALE_FACTOR + BigInt(fraction.padEnd(12, '0').slice(0, 12));
    };
    let exactChainFactor = SCALE_FACTOR;
    let previousNav = toScaled('100');
    for (const item of [...flows.map((entry) => entry.occurredAt), END]) {
      const currentNav = toScaled(navByTimestamp.get(item.getTime()) ?? navValue);
      const subperiodReturn = (currentNav * SCALE_FACTOR) / previousNav;
      exactChainFactor = (exactChainFactor * subperiodReturn) / SCALE_FACTOR;
      previousNav = currentNav;
    }
    const expected = formatScaled((exactChainFactor - SCALE_FACTOR) * 100n);

    const result = await calculate(service);
    expect(result.canCalculate).toBe(true);
    expect(result.returnPercent).toBe(expected);
    expect(result.evidence.externalCashFlows).toHaveLength(49);
  });

  it('refuses more than 100 external cash flows before requesting NAV', async () => {
    const { service, calculateNav } = buildService({
      cashFlows: Array.from({ length: 101 }, (_, index) => flow({
        id: `too-many-${index}`,
        occurredAt: MID,
        cashFlowType: 'DEPOSIT',
        amount: '1',
      })),
    });

    const result = await calculate(service);
    expect(result).toMatchObject({ canCalculate: false, reason: 'TOO_MANY_CASH_FLOWS' });
    expect(calculateNav).not.toHaveBeenCalled();
  });

  it('reports an unavailable cash-flow lookup with the explicit lookup-failed code', async () => {
    const { service } = buildService({ cashFlowReadError: new Error('ledger unavailable') });
    const result = await calculate(service);
    expect(result.canCalculate).toBe(false);
    expect(result.reason).toBe('CASH_FLOW_SOURCE_UNAVAILABLE');
    expect(result.failureCode).toBe('CASH_FLOW_LOOKUP_FAILED');
    expect(result.evidence.externalCashFlows).toBeNull();
  });

});
