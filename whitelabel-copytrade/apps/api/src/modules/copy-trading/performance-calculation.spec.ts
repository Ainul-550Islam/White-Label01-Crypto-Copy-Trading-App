// # Responsibility: proves exact-decimal closed-period TWR, minimum sample size, source integrity, and fail-closed boundary behavior.

import { TWR_FLOW_BOUNDARY_RULE } from '../portfolio-accounting/portfolio-accounting.types';
import { PerformanceCalculationService, PerformancePeriodEvidence } from './performance-calculation.service';

const START = '2026-01-01T00:00:00.000Z';
const MID = '2026-01-02T00:00:00.000Z';
const NEXT = '2026-01-03T00:00:00.000Z';
const END = '2026-01-04T00:00:00.000Z';

function period(params: {
  periodId: string;
  periodStart: string;
  periodEnd: string;
  returnPercent: string | null;
  baseCurrency?: string;
  methodology?: string;
  calculationVersion?: string;
  flowBoundary?: string | null;
  dataCompleteness?: string;
  sourceReferences?: unknown;
  closedAndReconciled?: boolean;
}): PerformancePeriodEvidence {
  return {
    periodId: params.periodId,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    returnPercent: params.returnPercent,
    baseCurrency: params.baseCurrency ?? 'USD',
    methodology: params.methodology ?? 'TIME_WEIGHTED_RETURN',
    calculationVersion: params.calculationVersion ?? 'accounting-close-v3',
    flowBoundary: params.flowBoundary === undefined ? TWR_FLOW_BOUNDARY_RULE : params.flowBoundary,
    dataCompleteness: params.dataCompleteness ?? 'COMPLETE',
    sourceReferences: params.sourceReferences ?? [`period:${params.periodId}`],
    closedAndReconciled: params.closedAndReconciled ?? true,
  };
}

describe('PerformanceCalculationService', () => {
  const service = new PerformanceCalculationService();

  it('links closed periods exactly and computes peak-to-trough drawdown independent of input order', () => {
    const result = service.calculatePeriods([
      period({ periodId: 'p3', periodStart: NEXT, periodEnd: END, returnPercent: '21' }),
      period({ periodId: 'p1', periodStart: START, periodEnd: MID, returnPercent: '10' }),
      period({ periodId: 'p2', periodStart: MID, periodEnd: NEXT, returnPercent: '-10' }),
    ], { expectedStart: START, expectedEnd: END, expectedBaseCurrency: 'USD' });

    expect(result).toMatchObject({
      returnPercent: '19.79',
      maxDrawdownPercent: '10',
      methodology: 'TIME_WEIGHTED_RETURN',
      calculationVersion: 'twr-linked-periods-v1-integer-decimal',
      sourceCalculationVersion: 'accounting-close-v3',
      observationCount: 3,
      cumulativeReturnPercentages: ['10', '-1', '19.79'],
      dataCompleteness: 'COMPLETE',
      periodStart: START,
      periodEnd: END,
      baseCurrency: 'USD',
      sourceReferences: ['period:p1', 'period:p2', 'period:p3'],
    });
  });

  it('uses the same exact-decimal compounding primitive for intermediate return series', () => {
    expect(service.compoundReturnSeries(['10', '-10', '21'])).toEqual(['10', '-1', '19.79']);
    expect(service.compoundReturnSeries(['-100'])).toBeNull();
    expect(service.compoundReturnSeries(['1e3'])).toBeNull();
  });

  it('requires at least two observations and never lets callers lower the verified minimum', () => {
    const single = service.calculatePeriods([
      period({ periodId: 'p1', periodStart: START, periodEnd: MID, returnPercent: '10' }),
    ]);
    const loweredMinimum = service.calculatePeriods([
      period({ periodId: 'p1', periodStart: START, periodEnd: MID, returnPercent: '10' }),
    ], { minimumPeriodCount: 1 });

    expect(single.dataCompleteness).toBe('UNAVAILABLE');
    expect(single.returnPercent).toBeNull();
    expect(single.unavailableReason).toMatch(/at least 2/i);
    expect(loweredMinimum.dataCompleteness).toBe('UNAVAILABLE');
    expect(loweredMinimum.unavailableReason).toMatch(/cannot be lower than 2/i);
  });

  it('requires the canonical flow-boundary rule and active profile calculation version', () => {
    const missingBoundary = service.calculatePeriods([
      period({ periodId: 'p1', periodStart: START, periodEnd: MID, returnPercent: '1', flowBoundary: null }),
      period({ periodId: 'p2', periodStart: MID, periodEnd: NEXT, returnPercent: '1' }),
    ]);
    const mismatchedProfileVersion = service.calculatePeriods([
      period({ periodId: 'p1', periodStart: START, periodEnd: MID, returnPercent: '1' }),
      period({ periodId: 'p2', periodStart: MID, periodEnd: NEXT, returnPercent: '1' }),
    ], { expectedCalculationVersion: 'accounting-close-v4' });

    expect(missingBoundary.dataCompleteness).toBe('UNAVAILABLE');
    expect(missingBoundary.returnPercent).toBeNull();
    expect(missingBoundary.unavailableReason).toMatch(/flow-boundary evidence/i);
    expect(mismatchedProfileVersion.dataCompleteness).toBe('UNAVAILABLE');
    expect(mismatchedProfileVersion.returnPercent).toBeNull();
    expect(mismatchedProfileVersion.unavailableReason).toMatch(/active accounting profile calculation version/i);
  });

  it('returns unavailable for missing IDs, duplicate identities, malformed periods, or missing references', () => {
    const duplicateIdentity = service.calculatePeriods([
      period({ periodId: 'same', periodStart: START, periodEnd: MID, returnPercent: '1' }),
      period({ periodId: 'same', periodStart: MID, periodEnd: NEXT, returnPercent: '1' }),
    ]);
    const noReference = service.calculatePeriods([
      period({ periodId: 'p1', periodStart: START, periodEnd: MID, returnPercent: '1', sourceReferences: [] }),
      period({ periodId: 'p2', periodStart: MID, periodEnd: NEXT, returnPercent: '1' }),
    ]);
    const malformedReference = service.calculatePeriods([
      period({ periodId: 'p1', periodStart: START, periodEnd: MID, returnPercent: '1', sourceReferences: ['valid', 42] }),
      period({ periodId: 'p2', periodStart: MID, periodEnd: NEXT, returnPercent: '1' }),
    ]);
    const noPeriodIdentity = service.calculatePeriods([
      period({ periodId: '', periodStart: START, periodEnd: MID, returnPercent: '1' }),
      period({ periodId: 'p2', periodStart: MID, periodEnd: NEXT, returnPercent: '1' }),
    ]);

    for (const result of [duplicateIdentity, noReference, malformedReference, noPeriodIdentity]) {
      expect(result.dataCompleteness).toBe('UNAVAILABLE');
      expect(result.returnPercent).toBeNull();
      expect(result.sourceReferences).toEqual([]);
    }
    expect(duplicateIdentity.unavailableReason).toMatch(/identity is duplicated/i);
    expect(noReference.unavailableReason).toMatch(/source-reference/i);
    expect(malformedReference.unavailableReason).toMatch(/source-reference/i);
  });

  it('rejects incomplete, unreconciled, open, or unsupported period evidence', () => {
    const cases: PerformancePeriodEvidence[] = [
      period({ periodId: 'p1', periodStart: START, periodEnd: MID, returnPercent: '10', dataCompleteness: 'PARTIAL' }),
      period({ periodId: 'p2', periodStart: MID, periodEnd: NEXT, returnPercent: '10', closedAndReconciled: false }),
    ];
    const result = service.calculatePeriods(cases);

    expect(result.dataCompleteness).toBe('UNAVAILABLE');
    expect(result.returnPercent).toBeNull();
    expect(result.unavailableReason).toMatch(/incomplete, unreconciled, unsupported, or missing flow-boundary evidence/i);
  });

  it('requires contiguous coverage, exact requested boundaries, consistent currency, and consistent source versions', () => {
    const gap = service.calculatePeriods([
      period({ periodId: 'p1', periodStart: START, periodEnd: MID, returnPercent: '1' }),
      period({ periodId: 'p2', periodStart: '2026-01-02T01:00:00.000Z', periodEnd: NEXT, returnPercent: '1' }),
    ]);
    const wrongStart = service.calculatePeriods([
      period({ periodId: 'p1', periodStart: MID, periodEnd: NEXT, returnPercent: '1' }),
      period({ periodId: 'p2', periodStart: NEXT, periodEnd: END, returnPercent: '1' }),
    ], { expectedStart: START, expectedEnd: END });
    const mixedCurrency = service.calculatePeriods([
      period({ periodId: 'p1', periodStart: START, periodEnd: MID, returnPercent: '1', baseCurrency: 'USD' }),
      period({ periodId: 'p2', periodStart: MID, periodEnd: NEXT, returnPercent: '1', baseCurrency: 'EUR' }),
    ]);
    const mixedVersion = service.calculatePeriods([
      period({ periodId: 'p1', periodStart: START, periodEnd: MID, returnPercent: '1', calculationVersion: 'close-v1' }),
      period({ periodId: 'p2', periodStart: MID, periodEnd: NEXT, returnPercent: '1', calculationVersion: 'close-v2' }),
    ]);

    expect(gap.unavailableReason).toMatch(/gap or overlap/i);
    expect(wrongStart.unavailableReason).toMatch(/exact requested window boundary/i);
    expect(mixedCurrency.unavailableReason).toMatch(/mixed base currencies/i);
    expect(mixedVersion.unavailableReason).toMatch(/mixed source calculation versions/i);
    for (const result of [gap, wrongStart, mixedCurrency, mixedVersion]) {
      expect(result.dataCompleteness).toBe('UNAVAILABLE');
      expect(result.returnPercent).toBeNull();
    }
  });

  it('rejects impossible or malformed decimal returns without coercing through Number', () => {
    const impossible = service.calculatePeriods([
      period({ periodId: 'p1', periodStart: START, periodEnd: MID, returnPercent: '-100' }),
      period({ periodId: 'p2', periodStart: MID, periodEnd: NEXT, returnPercent: '1' }),
    ]);
    const malformed = service.calculatePeriods([
      period({ periodId: 'p1', periodStart: START, periodEnd: MID, returnPercent: '1e3' }),
      period({ periodId: 'p2', periodStart: MID, periodEnd: NEXT, returnPercent: '1' }),
    ]);

    expect(impossible.dataCompleteness).toBe('UNAVAILABLE');
    expect(impossible.unavailableReason).toMatch(/not mathematically valid/i);
    expect(malformed.dataCompleteness).toBe('UNAVAILABLE');
    expect(malformed.unavailableReason).toMatch(/not an exact decimal string/i);
  });
});
