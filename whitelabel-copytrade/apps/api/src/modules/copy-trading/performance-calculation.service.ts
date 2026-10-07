// # Responsibility: links only persisted, reconciled, closed-period TWR records using exact decimal arithmetic.
// # Safety: raw NAV snapshots without cash-flow adjustments are never treated as return evidence.

import { Injectable } from '@nestjs/common';
import { DECIMAL_FACTOR, divideDecimalStrings, formatDecimalString, multiplyDecimalStrings, parseDecimalString } from '../../common/decimal-string';
import { TWR_FLOW_BOUNDARY_RULE, TWRFlowBoundaryRule } from '../portfolio-accounting/portfolio-accounting.types';

export const MINIMUM_VERIFIED_PERFORMANCE_PERIODS = 2;
export const MAX_VERIFIED_PERFORMANCE_PERIODS = 500;
export const LINKED_PERIOD_CALCULATION_VERSION = 'twr-linked-periods-v1-integer-decimal' as const;

export interface PerformancePeriodEvidence {
  periodId: string | null;
  periodStart: Date | string;
  periodEnd: Date | string;
  returnPercent: string | null;
  baseCurrency: string;
  methodology: string;
  calculationVersion: string;
  flowBoundary: string | null;
  dataCompleteness: string;
  sourceReferences: unknown;
  closedAndReconciled: boolean;
}

export interface PerformanceCalculationOptions {
  expectedStart?: Date | string;
  expectedEnd?: Date | string;
  expectedBaseCurrency?: string;
  expectedCalculationVersion?: string;
  minimumPeriodCount?: number;
}

export interface PerformanceCalculationResult {
  methodology: 'TIME_WEIGHTED_RETURN';
  calculationVersion: typeof LINKED_PERIOD_CALCULATION_VERSION;
  flowBoundary: TWRFlowBoundaryRule;
  sourceCalculationVersion: string | null;
  returnPercent: string | null;
  maxDrawdownPercent: string | null;
  cumulativeReturnPercentages: string[];
  observationCount: number;
  dataCompleteness: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
  periodStart: string | null;
  periodEnd: string | null;
  baseCurrency: string | null;
  sourceReferences: string[];
  unavailableReason?: string;
}

interface NormalizedPeriod extends PerformancePeriodEvidence {
  startTime: number;
  endTime: number;
  returnScaled: bigint;
  references: string[];
}

interface CompoundedReturnSeries {
  cumulativeReturnPercentages: string[];
  wealthValues: bigint[];
}

function compoundScaledReturns(periodReturns: readonly bigint[]): CompoundedReturnSeries {
  let wealth = DECIMAL_FACTOR;
  const cumulativeReturnPercentages: string[] = [];
  const wealthValues: bigint[] = [];
  for (const periodReturn of periodReturns) {
    const growthFactor = DECIMAL_FACTOR + divideDecimalStrings(periodReturn, parseDecimalString('100'));
    wealth = multiplyDecimalStrings(wealth, growthFactor);
    wealthValues.push(wealth);
    cumulativeReturnPercentages.push(formatDecimalString((wealth - DECIMAL_FACTOR) * 100n, 8));
  }
  return { cumulativeReturnPercentages, wealthValues };
}

@Injectable()
export class PerformanceCalculationService {
  compoundReturnSeries(periodReturns: readonly string[]): string[] | null {
    if (periodReturns.length > MAX_VERIFIED_PERFORMANCE_PERIODS) return null;
    const scaledReturns: bigint[] = [];
    try {
      for (const periodReturn of periodReturns) {
        const scaled = parseDecimalString(periodReturn);
        if (DECIMAL_FACTOR + divideDecimalStrings(scaled, parseDecimalString('100')) <= 0n) return null;
        scaledReturns.push(scaled);
      }
      return compoundScaledReturns(scaledReturns).cumulativeReturnPercentages;
    } catch {
      return null;
    }
  }

  calculatePeriods(
    input: readonly PerformancePeriodEvidence[],
    options: PerformanceCalculationOptions = {},
  ): PerformanceCalculationResult {
    const minimumPeriodCount = options.minimumPeriodCount ?? MINIMUM_VERIFIED_PERFORMANCE_PERIODS;
    if (!Number.isInteger(minimumPeriodCount) || minimumPeriodCount < MINIMUM_VERIFIED_PERFORMANCE_PERIODS) {
      return this.unavailable(input.length, `The configured minimum period count cannot be lower than ${MINIMUM_VERIFIED_PERFORMANCE_PERIODS}.`);
    }
    if (input.length > MAX_VERIFIED_PERFORMANCE_PERIODS) {
      return this.unavailable(input.length, `The selected window exceeds the safe ${MAX_VERIFIED_PERFORMANCE_PERIODS}-period calculation limit.`);
    }
    if (input.length < minimumPeriodCount) {
      return this.unavailable(
        input.length,
        `At least ${minimumPeriodCount} complete, reconciled, closed accounting periods are required.`,
      );
    }

    const normalized: NormalizedPeriod[] = [];
    const seenPeriodIds = new Set<string>();
    for (const period of input) {
      const startTime = parseTimestamp(period.periodStart);
      const endTime = parseTimestamp(period.periodEnd);
      if (!period.periodId || !Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
        return this.unavailable(input.length, 'A closed accounting period is missing a valid identity or time interval.');
      }
      if (seenPeriodIds.has(period.periodId)) {
        return this.unavailable(input.length, 'A closed accounting-period identity is duplicated in the selected window.');
      }
      seenPeriodIds.add(period.periodId);
      if (
        period.methodology !== 'TIME_WEIGHTED_RETURN'
        || period.dataCompleteness !== 'COMPLETE'
        || period.closedAndReconciled !== true
        || period.flowBoundary !== TWR_FLOW_BOUNDARY_RULE
        || !period.returnPercent
        || !/^[A-Za-z0-9._:-]{1,128}$/.test(period.calculationVersion.trim())
        || !/^[A-Za-z0-9]{2,16}$/.test(period.baseCurrency.trim())
      ) {
        return this.unavailable(input.length, 'The selected window contains incomplete, unreconciled, unsupported, or missing flow-boundary evidence.');
      }
      const references = readSourceReferences(period.sourceReferences);
      if (references.length === 0) {
        return this.unavailable(input.length, 'A closed accounting period is missing source-reference evidence.');
      }
      let returnScaled: bigint;
      try {
        returnScaled = parseDecimalString(period.returnPercent);
      } catch {
        return this.unavailable(input.length, 'A persisted period return is not an exact decimal string.');
      }
      if (DECIMAL_FACTOR + divideDecimalStrings(returnScaled, parseDecimalString('100')) <= 0n) {
        return this.unavailable(input.length, 'A persisted period return is not mathematically valid for compounding.');
      }
      normalized.push({ ...period, startTime, endTime, returnScaled, references });
    }

    normalized.sort((left, right) => left.startTime - right.startTime || left.endTime - right.endTime || left.periodId!.localeCompare(right.periodId!));
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    if (!first || !last) {
      return this.unavailable(input.length, 'The selected performance window is empty after evidence validation.');
    }
    const baseCurrency = first.baseCurrency.trim().toUpperCase();
    const sourceCalculationVersion = first.calculationVersion.trim();
    const expectedBaseCurrency = options.expectedBaseCurrency?.trim().toUpperCase();
    const expectedCalculationVersion = options.expectedCalculationVersion?.trim() ?? null;
    if (expectedCalculationVersion !== null && !/^[A-Za-z0-9._:-]{1,128}$/.test(expectedCalculationVersion)) {
      return this.unavailable(input.length, 'The active accounting profile has an invalid calculation version.');
    }
    if (expectedCalculationVersion !== null && sourceCalculationVersion !== expectedCalculationVersion) {
      return this.unavailable(input.length, 'The persisted periods do not match the active accounting profile calculation version.');
    }
    if (expectedBaseCurrency && baseCurrency !== expectedBaseCurrency) {
      return this.unavailable(input.length, 'The selected accounting periods do not use the trader profile base currency.');
    }
    if (normalized.some((period) => period.baseCurrency.trim().toUpperCase() !== baseCurrency)) {
      return this.unavailable(input.length, 'The selected accounting periods contain mixed base currencies.');
    }
    if (normalized.some((period) => period.calculationVersion.trim() !== sourceCalculationVersion)) {
      return this.unavailable(input.length, 'The selected accounting periods use mixed source calculation versions.');
    }

    const expectedStartTime = options.expectedStart === undefined ? null : parseTimestamp(options.expectedStart);
    const expectedEndTime = options.expectedEnd === undefined ? null : parseTimestamp(options.expectedEnd);
    if (expectedStartTime !== null && !Number.isFinite(expectedStartTime)) {
      return this.unavailable(input.length, 'The requested start boundary is invalid.');
    }
    if (expectedEndTime !== null && !Number.isFinite(expectedEndTime)) {
      return this.unavailable(input.length, 'The requested end boundary is invalid.');
    }
    if (expectedStartTime !== null && normalized[0].startTime !== expectedStartTime) {
      return this.unavailable(input.length, 'The first accounting period does not start at the exact requested window boundary.');
    }
    if (expectedEndTime !== null && normalized[normalized.length - 1].endTime !== expectedEndTime) {
      return this.unavailable(input.length, 'The last closed accounting period does not end at the displayed as-of boundary.');
    }

    let previousEnd: number | null = null;
    const references: string[] = [];
    for (const period of normalized) {
      if (previousEnd !== null && period.startTime !== previousEnd) {
        return this.unavailable(input.length, 'Accounting-period coverage contains a gap or overlap.');
      }
      previousEnd = period.endTime;
      references.push(...period.references);
    }

    const compounded = compoundScaledReturns(normalized.map((period) => period.returnScaled));
    const finalWealth = compounded.wealthValues[compounded.wealthValues.length - 1];
    if (finalWealth === undefined) return this.unavailable(input.length, 'The selected period series could not be compounded.');
    let peak = DECIMAL_FACTOR;
    let maximumDrawdown = 0n;
    for (const wealth of compounded.wealthValues) {
      if (wealth > peak) peak = wealth;
      if (peak > 0n) {
        const drawdown = divideDecimalStrings(peak - wealth, peak);
        if (drawdown > maximumDrawdown) maximumDrawdown = drawdown;
      }
    }

    const uniqueReferences = Array.from(new Set(references));
    if (uniqueReferences.length > 100) {
      return this.unavailable(input.length, 'The selected period window exceeds the safe source-reference evidence limit.');
    }
    return {
      methodology: 'TIME_WEIGHTED_RETURN',
      calculationVersion: LINKED_PERIOD_CALCULATION_VERSION,
      flowBoundary: TWR_FLOW_BOUNDARY_RULE,
      sourceCalculationVersion,
      returnPercent: formatDecimalString((finalWealth - DECIMAL_FACTOR) * 100n, 8),
      maxDrawdownPercent: formatDecimalString(maximumDrawdown * 100n, 8),
      cumulativeReturnPercentages: compounded.cumulativeReturnPercentages,
      observationCount: normalized.length,
      dataCompleteness: 'COMPLETE',
      periodStart: new Date(first.startTime).toISOString(),
      periodEnd: new Date(last.endTime).toISOString(),
      baseCurrency,
      sourceReferences: uniqueReferences,
    };
  }

  private unavailable(observationCount: number, unavailableReason: string): PerformanceCalculationResult {
    return {
      methodology: 'TIME_WEIGHTED_RETURN',
      calculationVersion: LINKED_PERIOD_CALCULATION_VERSION,
      flowBoundary: TWR_FLOW_BOUNDARY_RULE,
      sourceCalculationVersion: null,
      returnPercent: null,
      maxDrawdownPercent: null,
      cumulativeReturnPercentages: [],
      observationCount,
      dataCompleteness: 'UNAVAILABLE',
      periodStart: null,
      periodEnd: null,
      baseCurrency: null,
      sourceReferences: [],
      unavailableReason,
    };
  }
}

function parseTimestamp(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

function readSourceReferences(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return [];
  const references = value.map((reference) => typeof reference === 'string' ? reference.trim() : '');
  if (references.some((reference) => reference.length === 0 || reference.length > 512 || /[\u0000-\u001f\u007f]/.test(reference))) {
    return [];
  }
  return Array.from(new Set(references));
}
