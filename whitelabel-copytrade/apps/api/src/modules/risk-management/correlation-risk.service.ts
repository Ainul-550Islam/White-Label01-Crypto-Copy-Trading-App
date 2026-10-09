import { Injectable, Logger } from '@nestjs/common';
import { TradingVenue } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Decimal, isDecimalString } from '../../common/decimal-string';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
import { CorrelationResult, RiskState, RiskSeverity } from './risk-management.types';
import type { CustomerCorrelationAssessment } from './customer-risk-analysis.types';

/**
 * Correlation risk: asset/strategy/portfolio correlation.
 * Uses canonical market data returns where sufficient observations exist.
 * Returns UNKNOWN when insufficient, never invents correlation.
 * Method versioned, lookback/min obs configurable.
 */

function isValidDecimal(v: any): boolean {
  return typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v);
}
const SCALE = 1_000_000_000_000n;
function parseScaled(s: string): bigint {
  const neg = s.startsWith('-');
  const clean = neg ? s.slice(1) : s;
  const [intP = '0', fracP = ''] = clean.split('.');
  const frac = (fracP + '0'.repeat(12)).slice(0, 12);
  const val = BigInt(intP) * SCALE + BigInt(frac || '0');
  return neg ? -val : val;
}
function formatScaled(b: bigint): string {
  const neg = b < 0n;
  const abs = neg ? -b : b;
  const intP = abs / SCALE;
  const frac = abs % SCALE;
  const fracStr = frac.toString().padStart(12, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + (fracStr ? `${intP}.${fracStr}` : `${intP}`);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How old the newest aligned daily candle may be before a coefficient computed from it is withheld.
 *
 * This is 36 hours rather than a policy threshold because it is a property of the observation
 * interval, not of a tenant's risk appetite: a daily series whose newest close is more than a day
 * and a half old has missed the most recent session, so the number would describe a market that no
 * longer exists. The institutional `marketDataMaxAgeMs` threshold answers a different question -
 * how fresh a tick may be to price an order - and is far too strict for a daily close.
 */
const ALIGNED_DAILY_MAX_SOURCE_AGE_MS = 129_600_000;

/** Upper bound on pairs evaluated per request, so one request cannot fan out without limit. */
const MAX_CANDIDATE_PAIRS = 20;

@Injectable()
export class CorrelationRiskService {
  private readonly logger = new Logger(CorrelationRiskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: InstitutionalRiskPolicyService,
  ) {}

  async evaluateCorrelation(params: {
    tenantId: string;
    traderId?: string;
    strategyId?: string;
    followerId?: string;
    pairs?: Array<{ assetA: string; assetB: string }>;
  }): Promise<CorrelationResult[]> {
    const { tenantId, traderId, strategyId, followerId, pairs } = params;
    const policy = await this.policyService.resolveEffectivePolicy({
      tenantId,
      traderId: traderId ?? null,
      strategyId: strategyId ?? null,
      followerId: followerId ?? null,
    });

    const lookbackDays = policy.thresholds.correlationLookbackDays;
    const minObs = policy.thresholds.correlationMinObservations;
    const threshold = policy.thresholds.maxCorrelation;
    const method = `PEARSON_${lookbackDays}D`;
    const methodVersion = 'v1.0.0';

    // Determine pairs: if not provided, derive from positions
    let effectivePairs = pairs;
    if (!effectivePairs || effectivePairs.length === 0) {
      const positions = await this.prisma.position.findMany({
        where: { tenantId },
        distinct: ['symbol'],
        select: { symbol: true },
      });
      const symbols = positions.map((p) => p.symbol);
      effectivePairs = [];
      for (let i = 0; i < symbols.length; i++) {
        for (let j = i + 1; j < symbols.length; j++) {
          effectivePairs.push({ assetA: symbols[i], assetB: symbols[j] });
        }
      }
      // Limit to first 20 pairs to avoid explosion
      effectivePairs = effectivePairs.slice(0, 20);
    }

    const results: CorrelationResult[] = [];
    const nowIso = new Date().toISOString();

    for (const pair of effectivePairs) {
      const pairKey = `${pair.assetA}:${pair.assetB}`;

      // Fetch historical market data for both assets
      const startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

      const dataA = await this.prisma.marketDataRecord.findMany({
        where: { symbol: pair.assetA, openTime: { gte: startDate } },
        orderBy: { openTime: 'asc' },
        take: lookbackDays * 2,
      });
      const dataB = await this.prisma.marketDataRecord.findMany({
        where: { symbol: pair.assetB, openTime: { gte: startDate } },
        orderBy: { openTime: 'asc' },
        take: lookbackDays * 2,
      });

      const observations = Math.min(dataA.length, dataB.length);

      if (observations < minObs) {
        results.push({
          tenantId,
          method,
          methodVersion,
          lookbackDays,
          minObservations: minObs,
          observations,
          pairKey,
          correlation: null,
          threshold: threshold ?? null,
          isBreach: false,
          state: RiskState.UNKNOWN,
          ruleId: 'MAX_CORRELATION',
          policyVersion: policy.effectiveVersion,
          reason: `Insufficient observations for ${pairKey}: ${observations} < ${minObs} required (lookback ${lookbackDays}d), returning UNKNOWN per policy — must not invent correlation`,
          severity: RiskSeverity.INFO,
          isUnknown: true,
        });
        continue;
      }

      // Compute Pearson correlation on close returns
      // Returns = (close_t / close_{t-1} -1)
      // We need decimal-safe but correlation calculation involves floating math; we will use number for correlation but keep decimal string output.
      // This is acceptable for correlation analytics (not financial ledger) but we still avoid inventing.
      try {
        const returnsA: number[] = [];
        const returnsB: number[] = [];
        for (let i = 1; i < Math.min(dataA.length, dataB.length); i++) {
          const closeA = Number(dataA[i].close);
          const prevCloseA = Number(dataA[i - 1].close);
          const closeB = Number(dataB[i].close);
          const prevCloseB = Number(dataB[i - 1].close);
          if (prevCloseA === 0 || prevCloseB === 0) continue;
          returnsA.push(closeA / prevCloseA - 1);
          returnsB.push(closeB / prevCloseB - 1);
        }

        if (returnsA.length < minObs) {
          results.push({
            tenantId,
            method,
            methodVersion,
            lookbackDays,
            minObservations: minObs,
            observations: returnsA.length,
            pairKey,
            correlation: null,
            threshold: threshold ?? null,
            isBreach: false,
            state: RiskState.UNKNOWN,
            ruleId: 'MAX_CORRELATION',
            policyVersion: policy.effectiveVersion,
            reason: `Insufficient return observations for ${pairKey}: ${returnsA.length} < ${minObs}, UNKNOWN`,
            severity: RiskSeverity.INFO,
            isUnknown: true,
          });
          continue;
        }

        const meanA = returnsA.reduce((s, v) => s + v, 0) / returnsA.length;
        const meanB = returnsB.reduce((s, v) => s + v, 0) / returnsB.length;

        let num = 0;
        let denA = 0;
        let denB = 0;
        for (let i = 0; i < returnsA.length; i++) {
          const da = returnsA[i] - meanA;
          const db = returnsB[i] - meanB;
          num += da * db;
          denA += da * da;
          denB += db * db;
        }
        const denom = Math.sqrt(denA * denB);
        // A flat series has no correlation to report. Returning 0 here would publish the number
        // that means "no relationship", which is a measurement this data cannot support.
        if (denom === 0 || !Number.isFinite(denom)) {
          results.push({
            tenantId,
            method,
            methodVersion,
            lookbackDays,
            minObservations: minObs,
            observations: returnsA.length,
            pairKey,
            correlation: null,
            threshold: threshold ?? null,
            isBreach: false,
            state: RiskState.UNKNOWN,
            ruleId: 'MAX_CORRELATION',
            policyVersion: policy.effectiveVersion,
            reason: `Zero or invalid variance for ${pairKey}: at least one return series is constant, so no correlation exists to measure`,
            severity: RiskSeverity.INFO,
            isUnknown: true,
          });
          continue;
        }
        const corr = num / denom;
        const corrStr = corr.toFixed(6); // decimal string

        let isBreach = false;
        let state = RiskState.NORMAL;
        let reason = `Correlation ${corrStr} for ${pairKey} within threshold ${threshold ?? 'unlimited'}`;
        let severity = RiskSeverity.INFO;

        if (threshold && isValidDecimal(threshold)) {
          // If absolute correlation exceeds threshold, breach
          const absCorr = Math.abs(corr);
          const threshNum = Number(threshold);
          if (absCorr > threshNum) {
            isBreach = true;
            state = RiskState.HIGH;
            reason = `Correlation ${corrStr} for ${pairKey} exceeds threshold ${threshold} (absolute ${absCorr.toFixed(4)} > ${threshNum})`;
            severity = RiskSeverity.WARNING;
          }
        }

        results.push({
          tenantId,
          method,
          methodVersion,
          lookbackDays,
          minObservations: minObs,
          observations: returnsA.length,
          pairKey,
          correlation: corrStr,
          threshold: threshold ?? null,
          isBreach,
          state,
          ruleId: 'MAX_CORRELATION',
          policyVersion: policy.effectiveVersion,
          reason,
          severity,
          isUnknown: false,
        });
      } catch (e) {
        results.push({
          tenantId,
          method,
          methodVersion,
          lookbackDays,
          minObservations: minObs,
          observations,
          pairKey,
          correlation: null,
          threshold: threshold ?? null,
          isBreach: false,
          state: RiskState.UNKNOWN,
          ruleId: 'MAX_CORRELATION',
          policyVersion: policy.effectiveVersion,
          reason: `Correlation calculation failed for ${pairKey}: ${(e as Error).message}, returning UNKNOWN`,
          severity: RiskSeverity.WARNING,
          isUnknown: true,
        });
      }
    }

    return results;
  }

  /**
   * Correlation between the instruments the authenticated caller actually holds.
   *
   * Every input is owner-scoped: the accounts are the caller's own non-sandbox accounts, the
   * positions are open and not simulated, and the instrument identity comes from the tenant's
   * `tradingSymbol` rows rather than from the stored symbol string. The institutional method above
   * is left as it is because it answers for an operator-selected scope; this one answers only for
   * the caller, and takes no scope selector at all.
   *
   * Observations are paired by candle timestamp, never by array index. Two series that start on
   * different days are not the same 30 days of market, and pairing them positionally would compute a
   * coefficient from returns that never happened on the same day.
   */
  async evaluateMyCorrelation(params: {
    tenantId: string;
    userId: string;
    asOf?: Date | string;
  }): Promise<CustomerCorrelationAssessment> {
    const { tenantId, userId } = params;
    const asOfDate = params.asOf === undefined ? new Date() : new Date(params.asOf);
    const asOfTime = asOfDate.getTime();

    const policy = await this.policyService.resolveEffectivePolicy({ tenantId });
    const lookbackDays = policy.thresholds.correlationLookbackDays;
    const minObs = policy.thresholds.correlationMinObservations;
    const threshold = policy.thresholds.maxCorrelation;
    const method = `PEARSON_${lookbackDays}D_ALIGNED_DAILY`;
    const methodVersion = 'v1.0.0';

    const base = {
      tenantId,
      asOf: asOfDate.toISOString(),
      dataScope: 'SIGNED_IN_USER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS' as const,
      method,
      methodVersion,
      interval: '1d' as const,
      lookbackDays,
      minObservations: minObs,
      maxSourceAgeMs: ALIGNED_DAILY_MAX_SOURCE_AGE_MS,
      notice:
        'A pair is evaluated only when both instruments share a quote asset and a market type and their daily candles align by timestamp. A coefficient is withheld, never estimated, when the aligned window is short, stale, or has no variance.',
    };

    if (!Number.isFinite(asOfTime)) {
      return {
        ...base,
        state: 'UNKNOWN',
        activePositionCount: null,
        instrumentCount: null,
        omittedPositionCount: null,
        candidatePairCount: null,
        evaluatedPairCount: 0,
        truncatedPairCount: null,
        pairs: [],
      };
    }

    const accounts = await this.prisma.tradingAccount.findMany({
      where: { tenantId, deletedAt: null, isSandbox: false, userId },
      select: { id: true },
    });
    const accountIds = accounts.map((account) => account.id);
    if (accountIds.length === 0) {
      return {
        ...base,
        state: 'EMPTY',
        activePositionCount: 0,
        instrumentCount: 0,
        omittedPositionCount: 0,
        candidatePairCount: 0,
        evaluatedPairCount: 0,
        truncatedPairCount: 0,
        pairs: [],
      };
    }

    const positions = await this.prisma.position.findMany({
      where: {
        tenantId,
        accountId: { in: accountIds },
        containsSimulatedFills: false,
        closedAt: null,
      },
      select: { symbolId: true, symbol: true, venue: true, quantity: true },
    });
    if (positions.length === 0) {
      return {
        ...base,
        state: 'EMPTY',
        activePositionCount: 0,
        instrumentCount: 0,
        omittedPositionCount: 0,
        candidatePairCount: 0,
        evaluatedPairCount: 0,
        truncatedPairCount: 0,
        pairs: [],
      };
    }

    // Insertion order is preserved deliberately: the instrument id list is part of the query that
    // resolves tenant instrument identity, and a stable order keeps that query reproducible.
    const symbolIds: string[] = [];
    for (const position of positions) {
      if (!symbolIds.includes(position.symbolId)) symbolIds.push(position.symbolId);
    }

    const tradingSymbols = await this.prisma.tradingSymbol.findMany({
      where: { tenantId, id: { in: symbolIds } },
      select: {
        id: true,
        symbol: true,
        marketType: true,
        baseAsset: true,
        quoteAsset: true,
        exchange: { select: { venue: true } },
      },
    });
    const symbolById = new Map(tradingSymbols.map((symbol) => [symbol.id, symbol]));

    interface Instrument {
      symbolId: string;
      symbol: string;
      venue: TradingVenue;
      marketType: string | null;
      baseAsset: string | null;
      quoteAsset: string | null;
    }

    const instruments = new Map<string, Instrument>();
    let omittedPositionCount = 0;
    for (const position of positions) {
      const resolved = symbolById.get(position.symbolId);
      if (!resolved) {
        omittedPositionCount += 1;
        continue;
      }
      if (instruments.has(resolved.id)) continue;
      instruments.set(resolved.id, {
        symbolId: resolved.id,
        symbol: resolved.symbol,
        venue: resolved.exchange?.venue ?? position.venue,
        marketType: resolved.marketType ?? null,
        baseAsset: resolved.baseAsset ?? null,
        quoteAsset: resolved.quoteAsset ?? null,
      });
    }

    const instrumentList = Array.from(instruments.values());
    const candidates: Array<{ left: Instrument; right: Instrument }> = [];
    for (let i = 0; i < instrumentList.length; i += 1) {
      for (let j = i + 1; j < instrumentList.length; j += 1) {
        const left = instrumentList[i];
        const right = instrumentList[j];
        // Two instruments can only be correlated through a common unit of value. Different quote
        // assets, or different market types, means the pair has no shared denominator.
        if (!left.quoteAsset || !right.quoteAsset) continue;
        if (left.quoteAsset !== right.quoteAsset) continue;
        if (!left.marketType || !right.marketType) continue;
        if (left.marketType !== right.marketType) continue;
        candidates.push({ left, right });
      }
    }

    const evaluated = candidates.slice(0, MAX_CANDIDATE_PAIRS);
    const truncatedPairCount = candidates.length - evaluated.length;

    const candleCache = new Map<string, AlignedCandle[]>();
    const loadCandles = async (instrument: Instrument): Promise<AlignedCandle[]> => {
      const cached = candleCache.get(instrument.symbolId);
      if (cached) return cached;
      const rows = await this.prisma.marketDataRecord.findMany({
        where: {
          symbolId: instrument.symbolId,
          venue: instrument.venue,
          interval: '1d',
          openTime: { gte: new Date(asOfTime - (lookbackDays + 2) * DAY_MS) },
        },
        orderBy: { openTime: 'asc' },
        select: { openTime: true, closeTime: true, close: true },
      });
      const candles = normalizeCandles(rows);
      candleCache.set(instrument.symbolId, candles);
      return candles;
    };

    const pairs: CorrelationResult[] = [];
    for (const { left, right } of evaluated) {
      const leftCandles = await loadCandles(left);
      const rightCandles = await loadCandles(right);

      const pairKey = `${left.symbol}:${right.symbol}`;
      const aligned = alignByTimestamp(leftCandles, rightCandles);
      const returns = alignedReturns(aligned);
      const observations = returns.length;
      const newestCloseTime = aligned.length > 0
        ? Math.max(...aligned.map((observation) => observation.closeTimeMs))
        : null;
      const sourceTimestamp = newestCloseTime === null ? null : new Date(newestCloseTime).toISOString();
      const isStale = newestCloseTime !== null && asOfTime - newestCloseTime > ALIGNED_DAILY_MAX_SOURCE_AGE_MS;

      const common = {
        tenantId,
        method,
        methodVersion,
        lookbackDays,
        minObservations: minObs,
        observations,
        pairKey,
        threshold: threshold ?? null,
        ruleId: 'MAX_CORRELATION',
        policyVersion: policy.effectiveVersion,
        sourceInterval: '1d',
        sourceMethodology: 'ALIGNED_DAILY_CLOSE_RETURNS',
        sourceTimestamp,
        sourceMaxAgeMs: ALIGNED_DAILY_MAX_SOURCE_AGE_MS,
      };

      // Freshness is decided before sufficiency. A window that is both short and stale is reported
      // as stale, because "your market data stopped" is the actionable fact and "you have 28 of 30
      // observations" would read as a passing hiccup.
      if (isStale) {
        pairs.push({
          ...common,
          correlation: null,
          isBreach: false,
          state: RiskState.STALE,
          reason: `The newest aligned daily close for ${pairKey} is ${sourceTimestamp}, older than the 36-hour freshness limit. No coefficient is published from a market that has moved on.`,
          severity: RiskSeverity.WARNING,
          isUnknown: true,
          isStale: true,
        });
        continue;
      }

      if (observations < minObs) {
        pairs.push({
          ...common,
          correlation: null,
          isBreach: false,
          state: RiskState.UNKNOWN,
          reason: `Only ${observations} timestamp-aligned daily return pairs for ${pairKey}; ${minObs} are required. Positions with no shared trading day are not paired.`,
          severity: RiskSeverity.INFO,
          isUnknown: true,
          isStale: false,
        });
        continue;
      }

      const statistics = pearson(returns);
      if (statistics === null) {
        pairs.push({
          ...common,
          correlation: null,
          isBreach: false,
          state: RiskState.UNKNOWN,
          reason: `The aligned return series for ${pairKey} has zero or invalid variance, so no correlation exists to measure.`,
          severity: RiskSeverity.INFO,
          isUnknown: true,
          isStale: false,
        });
        continue;
      }

      const correlation = formatCorrelation(statistics.correlation);
      const thresholdValue = threshold !== null && isDecimalString(threshold) ? Number(threshold) : null;
      // Absolute value: a strongly negative correlation concentrates risk in the same pair too, and
      // the configured limit is a bound on the strength of the relationship, not its sign.
      const isBreach = thresholdValue !== null && Math.abs(statistics.correlation) > thresholdValue;

      pairs.push({
        ...common,
        correlation,
        isBreach,
        state: isBreach ? RiskState.HIGH : RiskState.NORMAL,
        reason: thresholdValue === null
          ? `Correlation ${correlation} for ${pairKey} over ${observations} aligned daily returns; no correlation limit is configured.`
          : `Correlation ${correlation} for ${pairKey} over ${observations} aligned daily returns, ${isBreach ? 'above' : 'within'} the limit of ${threshold}.`,
        severity: isBreach ? RiskSeverity.WARNING : RiskSeverity.INFO,
        isUnknown: false,
        isStale: false,
      });
    }

    let state: CustomerCorrelationAssessment['state'];
    if (pairs.some((pair) => pair.state === RiskState.STALE)) state = 'STALE';
    else if (pairs.some((pair) => pair.isUnknown)) state = 'UNKNOWN';
    else if (pairs.length === 0) state = 'UNKNOWN';
    else state = 'CURRENT';

    return {
      ...base,
      state,
      activePositionCount: positions.length,
      instrumentCount: instruments.size,
      omittedPositionCount,
      candidatePairCount: candidates.length,
      evaluatedPairCount: evaluated.length,
      truncatedPairCount,
      pairs,
    };
  }
}

interface AlignedCandle {
  openTimeMs: number;
  closeTimeMs: number;
  close: Decimal;
}

interface AlignedObservation {
  openTimeMs: number;
  closeTimeMs: number;
  leftReturn: number;
  rightReturn: number;
}

/**
 * Reads candle rows into exact closes. A row whose close is not an exact decimal is dropped rather
 * than coerced, because coercing it would put an unverified number into a statistic.
 *
 * The column is a Prisma `Decimal` on the way out of the database and a plain string in fixtures and
 * tests, so the value is passed through the canonical parser rather than through `Number`. The
 * parser understands scientific notation exactly, which matters because a Decimal's own `toString`
 * may use it for small magnitudes.
 */
function normalizeCandles(rows: Array<{ openTime: Date; closeTime: Date; close: unknown }>): AlignedCandle[] {
  const candles: AlignedCandle[] = [];
  for (const row of rows) {
    if (!row) continue;
    const openTimeMs = new Date(row.openTime).getTime();
    const closeTimeMs = new Date(row.closeTime).getTime();
    if (!Number.isFinite(openTimeMs) || !Number.isFinite(closeTimeMs)) continue;
    let close: Decimal;
    try {
      close = Decimal.parse(String(row.close));
    } catch {
      continue;
    }
    if (!close.isPositive()) continue;
    candles.push({ openTimeMs, closeTimeMs, close });
  }
  candles.sort((a, b) => a.openTimeMs - b.openTimeMs);
  return candles;
}

/**
 * Pairs candles that opened at the same instant. Index pairing is deliberately not used: two series
 * that begin on different days would otherwise be compared day 1 to day 1 across different markets.
 */
function alignByTimestamp(left: AlignedCandle[], right: AlignedCandle[]) {
  const rightByOpen = new Map(right.map((candle) => [candle.openTimeMs, candle]));
  const aligned: Array<{ openTimeMs: number; closeTimeMs: number; left: AlignedCandle; right: AlignedCandle }> = [];
  for (const leftCandle of left) {
    const rightCandle = rightByOpen.get(leftCandle.openTimeMs);
    if (!rightCandle) continue;
    aligned.push({
      openTimeMs: leftCandle.openTimeMs,
      closeTimeMs: Math.max(leftCandle.closeTimeMs, rightCandle.closeTimeMs),
      left: leftCandle,
      right: rightCandle,
    });
  }
  return aligned;
}

/**
 * Daily returns over consecutive aligned candles. A gap in the aligned series is skipped rather than
 * bridged, so a return never spans an interval the data does not cover.
 *
 * The division is exact scaled-integer arithmetic; only the resulting dimensionless ratio becomes a
 * float, and no price ever does.
 */
function alignedReturns(aligned: Array<{ openTimeMs: number; closeTimeMs: number; left: AlignedCandle; right: AlignedCandle }>): AlignedObservation[] {
  const observations: AlignedObservation[] = [];
  for (let i = 1; i < aligned.length; i += 1) {
    const previous = aligned[i - 1];
    const current = aligned[i];
    if (current.openTimeMs - previous.openTimeMs !== DAY_MS) continue;
    const leftReturn = ratioMinusOne(current.left.close, previous.left.close);
    const rightReturn = ratioMinusOne(current.right.close, previous.right.close);
    if (leftReturn === null || rightReturn === null) continue;
    observations.push({
      openTimeMs: current.openTimeMs,
      closeTimeMs: current.closeTimeMs,
      leftReturn,
      rightReturn,
    });
  }
  return observations;
}

/**
 * `current / previous - 1`, as a float ratio.
 *
 * The division is exact big-integer arithmetic produced by the canonical decimal module; only the
 * resulting dimensionless ratio becomes a float, and it is read back at the scale the module
 * actually returned rather than assuming one, because a result such as exactly 1 normalises to scale
 * zero.
 */
function ratioMinusOne(current: Decimal, previous: Decimal): number | null {
  if (!previous.isPositive()) return null;
  try {
    const ratio = current.div(previous, 12);
    return Number(ratio.unscaled) / Math.pow(10, ratio.scale) - 1;
  } catch {
    return null;
  }
}

/**
 * Pearson's r, or null when the coefficient does not exist.
 *
 * Null covers both a zero-variance series and any non-finite intermediate. The caller turns null into
 * UNKNOWN; it never becomes a number, because 0 is the value that means "uncorrelated" and that is a
 * measurement this input cannot support.
 */
function pearson(observations: AlignedObservation[]): { correlation: number } | null {
  const count = observations.length;
  if (count < 2) return null;

  let sumLeft = 0;
  let sumRight = 0;
  for (const observation of observations) {
    sumLeft += observation.leftReturn;
    sumRight += observation.rightReturn;
  }
  const meanLeft = sumLeft / count;
  const meanRight = sumRight / count;

  let covariance = 0;
  let varianceLeft = 0;
  let varianceRight = 0;
  for (const observation of observations) {
    const leftDelta = observation.leftReturn - meanLeft;
    const rightDelta = observation.rightReturn - meanRight;
    covariance += leftDelta * rightDelta;
    varianceLeft += leftDelta * leftDelta;
    varianceRight += rightDelta * rightDelta;
  }

  const denominator = Math.sqrt(varianceLeft * varianceRight);
  if (!Number.isFinite(denominator) || denominator === 0) return null;
  const correlation = covariance / denominator;
  if (!Number.isFinite(correlation)) return null;
  return { correlation: Math.max(-1, Math.min(1, correlation)) };
}

function formatCorrelation(value: number): string {
  const plain = (Math.trunc(value * 1e12) / 1e12).toFixed(12);
  return plain.replace(/\.?0+$/, '') || '0';
}
