// # Responsibility: serves benchmark comparisons only from persisted, complete, reconciled closed-period TWR records with source evidence.
// # Safety: never synthesizes prices, joins tenant/profile scopes, bridges gaps, or labels partial benchmark history as a complete curve.

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isDecimalString, parseDecimalString } from '../../common/decimal-string';
import { TWR_FLOW_BOUNDARY_RULE } from '../portfolio-accounting/portfolio-accounting.types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PerformanceCalculationService } from './performance-calculation.service';

const MAX_BENCHMARK_PERIODS = 500;
const MIN_BENCHMARK_PERIODS = 2;

export interface PerformanceBenchmarkObservation {
  periodStart: string;
  periodEnd: string;
  traderPeriodReturnPercent: string;
  benchmarkPeriodReturnPercent: string;
  traderCumulativeReturnPercent: string;
  benchmarkCumulativeReturnPercent: string;
}

export interface PerformanceBenchmarkResult {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  traderId: string;
  benchmarkKey: string | null;
  baseCurrency: string | null;
  methodology: string | null;
  flowBoundary: typeof TWR_FLOW_BOUNDARY_RULE | null;
  calculationVersion: string | null;
  dataCompleteness: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
  observations: PerformanceBenchmarkObservation[];
  sourceReferences: string[];
  asOf: string | null;
  currentnessRule: 'AS_OF_DISPLAYED_CURRENTNESS_NOT_ASSERTED';
  reason?: string;
}

const BENCHMARK_PERIOD_SELECT = {
  id: true,
  tenantId: true,
  profileId: true,
  periodId: true,
  periodStart: true,
  periodEnd: true,
  returnPercent: true,
  benchmarkReturn: true,
  baseCurrency: true,
  methodology: true,
  calculationVersion: true,
  dataCompleteness: true,
  evidence: true,
  sourceReferences: true,
  period: {
    select: {
      id: true,
      tenantId: true,
      profileId: true,
      periodStart: true,
      periodEnd: true,
      calculationVersion: true,
      state: true,
      closes: {
        select: {
          validationPassed: true,
          reconciliationStatus: true,
          calculationVersion: true,
        },
      },
    },
  },
} satisfies Prisma.PortfolioPerformanceRecordSelect;
type ClosedPeriodRecord = Prisma.PortfolioPerformanceRecordGetPayload<{ select: typeof BENCHMARK_PERIOD_SELECT }>;

interface BenchmarkMetadata {
  benchmarkKey: string;
  flowBoundary: typeof TWR_FLOW_BOUNDARY_RULE;
  sourceReferences: string[];
}

function toIso(value: Date | string): string | null {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function safeReferences(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return null;
  const references = value.map((item) => typeof item === 'string' ? item.trim() : '');
  if (references.some((reference) => reference.length === 0
    || reference.length > 512
    || /[\u0000-\u001f\u007f]/.test(reference))) return null;
  return Array.from(new Set(references));
}

function benchmarkMetadata(evidence: unknown): BenchmarkMetadata | null {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const record = evidence as Record<string, unknown>;
  const rawKey = record.benchmarkKey;
  const benchmarkKey = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (benchmarkKey.length < 2 || benchmarkKey.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(benchmarkKey)) return null;
  const sourceReferences = safeReferences(record.benchmarkSourceReferences);
  if (record.flowBoundary !== TWR_FLOW_BOUNDARY_RULE || !sourceReferences) return null;
  return { benchmarkKey, flowBoundary: TWR_FLOW_BOUNDARY_RULE, sourceReferences };
}

function isVerifiedReturn(value: unknown): value is string {
  return isDecimalString(value);
}

function closedAndReconciled(record: ClosedPeriodRecord, tenantId: string, profileId: string): boolean {
  return record.tenantId === tenantId
    && record.profileId === profileId
    && record.periodId !== null
    && record.period !== null
    && record.period.id === record.periodId
    && record.period.tenantId === tenantId
    && record.period.profileId === profileId
    && record.period.periodStart.getTime() === record.periodStart.getTime()
    && record.period.periodEnd.getTime() === record.periodEnd.getTime()
    && record.period.calculationVersion === record.calculationVersion
    && record.period.state === 'CLOSED'
    && record.period.closes.some((close) => close.validationPassed
      && close.reconciliationStatus === 'OK'
      && close.calculationVersion === record.calculationVersion);
}

/**
 * Benchmark observations are accepted only from a complete, reconciled, closed TWR record
 * that carries both a canonical benchmark key and explicit market/index source references.
 */
@Injectable()
export class PerformanceBenchmarkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly performanceCalculation: PerformanceCalculationService,
  ) {}

  async getTraderBenchmarkSeries(tenantId: string, traderId: string, requestedBenchmarkKey?: string): Promise<PerformanceBenchmarkResult> {
    const trader = await this.prisma.traderProfile.findFirst({
      where: { id: traderId, tenantId, deletedAt: null },
      select: { id: true, userId: true },
    });
    if (!trader) return this.unavailable(traderId, 'Trader profile is unavailable in this tenant.');

    const profileScopeIds = Array.from(new Set([trader.id, trader.userId]));
    const profiles = await this.prisma.portfolioAccountingProfile.findMany({
      where: { tenantId, scope: 'TRADER', scopeId: { in: profileScopeIds }, isActive: true },
      select: { id: true, baseCurrency: true, returnMethodology: true, calculationVersion: true },
    });
    if (profiles.length !== 1) {
      return this.unavailable(traderId, profiles.length === 0
        ? 'No active trader-scoped accounting profile is available.'
        : 'Multiple active trader-scoped accounting profiles are ambiguous.');
    }
    const profile = profiles[0];
    if (profile.returnMethodology !== 'TIME_WEIGHTED_RETURN') {
      return this.unavailable(traderId, 'The active trader accounting profile does not use time-weighted return.');
    }
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(profile.calculationVersion.trim())) {
      return this.unavailable(traderId, 'The active trader accounting profile has an invalid calculation version.');
    }
    const currentTime = new Date();
    const benchmarkRecordWhere: Prisma.PortfolioPerformanceRecordWhereInput = {
      tenantId,
      profileId: profile.id,
      periodId: { not: null },
      methodology: 'TIME_WEIGHTED_RETURN',
      benchmarkReturn: { not: null },
      periodEnd: { lte: currentTime },
      period: {
        is: {
          tenantId,
          profileId: profile.id,
          state: 'CLOSED',
          closes: { some: { tenantId, validationPassed: true, reconciliationStatus: 'OK' } },
        },
      },
    };
    const records = await this.prisma.portfolioPerformanceRecord.findMany({
      where: benchmarkRecordWhere,
      orderBy: [{ periodStart: 'asc' }, { periodEnd: 'asc' }, { id: 'asc' }],
      take: MAX_BENCHMARK_PERIODS + 1,
      select: BENCHMARK_PERIOD_SELECT,
    });

    if (records.length > MAX_BENCHMARK_PERIODS) {
      return this.unavailable(traderId, 'Persisted benchmark history exceeds the safe calculation limit.', profile.baseCurrency, profile.returnMethodology, profile.calculationVersion);
    }

    const validatedRecords = records.filter((record) => closedAndReconciled(record, tenantId, profile.id));
    if (validatedRecords.length !== records.length) {
      return this.unavailable(traderId, 'A benchmark record does not match its tenant-scoped closed accounting period.', profile.baseCurrency, profile.returnMethodology, profile.calculationVersion);
    }

    const identifiedRows = validatedRecords.map((record) => ({ record, metadata: benchmarkMetadata(record.evidence) }));
    if (identifiedRows.some((item) => item.metadata === null)) {
      return this.unavailable(traderId, 'A persisted benchmark period is missing a valid benchmark key or market/index source references.', profile.baseCurrency, profile.returnMethodology, profile.calculationVersion);
    }
    const availableKeys = Array.from(new Set(identifiedRows.map((item) => item.metadata!.benchmarkKey)));
    const requestedKey = requestedBenchmarkKey?.trim() || null;
    if (requestedKey && (requestedKey.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(requestedKey))) {
      return this.unavailable(traderId, 'The requested benchmark key is invalid.', profile.baseCurrency, profile.returnMethodology, profile.calculationVersion);
    }
    const benchmarkKey = requestedKey ?? (availableKeys.length === 1 ? availableKeys[0] : null);

    if (!benchmarkKey) {
      const reason = availableKeys.length > 1
        ? 'More than one verified benchmark is present; select a benchmark key to avoid mixing series.'
        : 'Persisted benchmark observations do not identify a key and market/index source references.';
      return this.unavailable(traderId, reason, profile.baseCurrency, profile.returnMethodology, profile.calculationVersion);
    }

    const selected = identifiedRows.filter((item) => item.metadata?.benchmarkKey === benchmarkKey);
    if (selected.length < MIN_BENCHMARK_PERIODS) {
      return this.unavailable(traderId, `At least ${MIN_BENCHMARK_PERIODS} complete, reconciled, closed benchmark periods with source references are required.`, profile.baseCurrency, profile.returnMethodology, profile.calculationVersion, benchmarkKey);
    }
    if (selected.some(({ record, metadata }) => record.dataCompleteness !== 'COMPLETE' || metadata === null)) {
      return this.unavailable(traderId, 'The selected benchmark window contains incomplete or unreferenced source evidence.', profile.baseCurrency, profile.returnMethodology, profile.calculationVersion, benchmarkKey);
    }

    const traderPeriodReturns: string[] = [];
    const benchmarkPeriodReturns: string[] = [];
    const validatedObservations: Array<Omit<PerformanceBenchmarkObservation, 'traderCumulativeReturnPercent' | 'benchmarkCumulativeReturnPercent'>> = [];
    const sourceReferences = new Set<string>();
    let previousPeriodEnd: number | null = null;

    for (const { record, metadata } of selected) {
      const periodStart = toIso(record.periodStart);
      const periodEnd = toIso(record.periodEnd);
      const recordReferences = safeReferences(record.sourceReferences);
      const traderReturnPercent = typeof record.returnPercent === 'string' ? record.returnPercent.trim() : null;
      const benchmarkReturnPercent = typeof record.benchmarkReturn === 'string' ? record.benchmarkReturn.trim() : null;
      if (!periodStart || !periodEnd || !isVerifiedReturn(traderReturnPercent) || !isVerifiedReturn(benchmarkReturnPercent)
        || !metadata || metadata.flowBoundary !== TWR_FLOW_BOUNDARY_RULE || !recordReferences
        || record.baseCurrency !== profile.baseCurrency
        || record.methodology !== profile.returnMethodology
        || record.methodology !== 'TIME_WEIGHTED_RETURN'
        || record.calculationVersion !== profile.calculationVersion) {
        return this.unavailable(traderId, 'A selected benchmark period failed currency, version, return, or source-reference validation.', profile.baseCurrency, profile.returnMethodology, profile.calculationVersion, benchmarkKey);
      }
      const periodStartMs = Date.parse(periodStart);
      const periodEndMs = Date.parse(periodEnd);
      if (periodStartMs >= periodEndMs || (previousPeriodEnd !== null && periodStartMs !== previousPeriodEnd)) {
        return this.unavailable(traderId, 'Selected benchmark periods contain a gap or overlap; incomplete coverage is not compounded.', profile.baseCurrency, profile.returnMethodology, profile.calculationVersion, benchmarkKey);
      }

      const traderPeriodReturn = parseDecimalString(traderReturnPercent);
      const benchmarkPeriodReturn = parseDecimalString(benchmarkReturnPercent);
      const negativeOneHundredPercent = parseDecimalString('-100');
      if (traderPeriodReturn <= negativeOneHundredPercent || benchmarkPeriodReturn <= negativeOneHundredPercent) {
        return this.unavailable(traderId, 'A selected benchmark period return is not mathematically valid for compounding.', profile.baseCurrency, profile.returnMethodology, profile.calculationVersion, benchmarkKey);
      }

      traderPeriodReturns.push(traderReturnPercent);
      benchmarkPeriodReturns.push(benchmarkReturnPercent);
      validatedObservations.push({
        periodStart,
        periodEnd,
        traderPeriodReturnPercent: traderReturnPercent,
        benchmarkPeriodReturnPercent: benchmarkReturnPercent,
      });
      for (const reference of [...recordReferences, ...metadata.sourceReferences]) sourceReferences.add(reference);
      previousPeriodEnd = periodEndMs;
    }

    if (sourceReferences.size === 0 || sourceReferences.size > 100) {
      return this.unavailable(traderId, 'The selected benchmark window exceeds or lacks source-reference evidence.', profile.baseCurrency, profile.returnMethodology, profile.calculationVersion, benchmarkKey);
    }
    const traderCumulativeReturns = this.performanceCalculation.compoundReturnSeries(traderPeriodReturns);
    const benchmarkCumulativeReturns = this.performanceCalculation.compoundReturnSeries(benchmarkPeriodReturns);
    if (!traderCumulativeReturns || !benchmarkCumulativeReturns
      || traderCumulativeReturns.length !== validatedObservations.length
      || benchmarkCumulativeReturns.length !== validatedObservations.length) {
      return this.unavailable(traderId, 'The selected benchmark series could not be compounded by the canonical performance calculation.', profile.baseCurrency, profile.returnMethodology, profile.calculationVersion, benchmarkKey);
    }

    const observations: PerformanceBenchmarkObservation[] = [];
    for (let index = 0; index < validatedObservations.length; index += 1) {
      const observation = validatedObservations[index];
      const traderCumulativeReturnPercent = traderCumulativeReturns[index];
      const benchmarkCumulativeReturnPercent = benchmarkCumulativeReturns[index];
      if (!observation || traderCumulativeReturnPercent === undefined || benchmarkCumulativeReturnPercent === undefined) {
        return this.unavailable(traderId, 'The selected benchmark series has an incomplete cumulative-return path.', profile.baseCurrency, profile.returnMethodology, profile.calculationVersion, benchmarkKey);
      }
      observations.push({
        ...observation,
        traderCumulativeReturnPercent,
        benchmarkCumulativeReturnPercent,
      });
    }

    return {
      status: 'AVAILABLE',
      traderId,
      benchmarkKey,
      baseCurrency: profile.baseCurrency,
      methodology: profile.returnMethodology,
      flowBoundary: TWR_FLOW_BOUNDARY_RULE,
      calculationVersion: profile.calculationVersion,
      dataCompleteness: 'COMPLETE',
      observations,
      sourceReferences: Array.from(sourceReferences),
      asOf: observations[observations.length - 1]?.periodEnd ?? null,
      currentnessRule: 'AS_OF_DISPLAYED_CURRENTNESS_NOT_ASSERTED',
    };
  }

  private unavailable(
    traderId: string,
    reason: string,
    baseCurrency: string | null = null,
    methodology: string | null = null,
    calculationVersion: string | null = null,
    benchmarkKey: string | null = null,
  ): PerformanceBenchmarkResult {
    return {
      status: 'UNAVAILABLE',
      traderId,
      benchmarkKey,
      baseCurrency,
      methodology,
      flowBoundary: null,
      calculationVersion,
      dataCompleteness: 'UNAVAILABLE',
      observations: [],
      sourceReferences: [],
      asOf: null,
      currentnessRule: 'AS_OF_DISPLAYED_CURRENTNESS_NOT_ASSERTED',
      reason,
    };
  }
}
