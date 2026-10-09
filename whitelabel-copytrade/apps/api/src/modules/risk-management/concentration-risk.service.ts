import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
import { PortfolioExposureService } from './portfolio-exposure.service';
import { ConcentrationResult, RiskState, RiskSeverity } from './risk-management.types';
import { CustomerExposureService } from './customer-exposure.service';
import type { CustomerExposureLine, CustomerExposureView } from './customer-exposure.types';
import type {
  CustomerConcentrationAssessment,
  CustomerConcentrationMetric,
  CustomerRiskValueState,
} from './customer-risk-analysis.types';

/**
 * Concentration risk by asset/symbol/venue/account/strategy/trader/follower.
 * Thresholds as % of gross exposure.
 * Avoids double-counting correlated exposure where policy defines aggregation.
 * Decimal-safe.
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
function cmp(a: string, b: string): number {
  const av = parseScaled(a);
  const bv = parseScaled(b);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

@Injectable()
export class ConcentrationRiskService {
  private readonly logger = new Logger(ConcentrationRiskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: InstitutionalRiskPolicyService,
    private readonly exposureService: PortfolioExposureService,
    // The customer-facing exposure source. It is owner-scoped and excludes sandbox and simulated
    // records, which `PortfolioExposureService` above deliberately does not: that one answers for an
    // operator-selected account. The institutional method uses one, the self-scoped method the other,
    // and neither substitutes for the other.
    private readonly customerExposureService: CustomerExposureService,
  ) {}

  async evaluateConcentration(params: {
    tenantId: string;
    accountId?: string;
    traderId?: string;
    strategyId?: string;
    followerId?: string;
    symbol?: string;
    orderIntent?: { notional: string; symbol: string } | null;
  }): Promise<ConcentrationResult[]> {
    const { tenantId, accountId, traderId, strategyId, followerId, orderIntent } = params;
    const policy = await this.policyService.resolveEffectivePolicy({
      tenantId,
      traderId: traderId ?? null,
      strategyId: strategyId ?? null,
      followerId: followerId ?? null,
    });

    const exposure = await this.exposureService.calculateExposure({
      tenantId,
      accountId,
      traderId,
      strategyId,
      followerId,
    });

    const results: ConcentrationResult[] = [];
    const gross = exposure.grossExposure;
    if (!isValidDecimal(gross) || parseScaled(gross) === 0n) {
      return results; // No exposure, no concentration breach
    }

    const grossScaled = parseScaled(gross);

    // Symbol concentration
    for (const symExp of exposure.symbolExposures) {
      const currentNotional = symExp.grossNotional;
      if (!isValidDecimal(currentNotional)) continue;
      let current = currentNotional;
      // If order intent for same symbol, project
      if (orderIntent && orderIntent.symbol === symExp.symbol && isValidDecimal(orderIntent.notional)) {
        current = formatScaled(parseScaled(currentNotional) + parseScaled(orderIntent.notional));
      }
      const currentScaled = parseScaled(current);
      const percent = formatScaled((currentScaled * 100n * SCALE) / grossScaled);
      const threshold = policy.thresholds.maxConcentrationSymbolPercent;
      if (!threshold || !isValidDecimal(threshold)) continue;

      const isBreach = cmp(percent, threshold) > 0;
      results.push({
        tenantId,
        dimension: 'SYMBOL',
        key: symExp.symbol,
        currentPercent: percent,
        currentNotional: current,
        thresholdPercent: threshold,
        isBreach,
        state: isBreach ? RiskState.BLOCKED : cmp(percent, formatScaled((parseScaled(threshold) * 80n) / 100n)) > 0 ? RiskState.HIGH : RiskState.NORMAL,
        ruleId: 'MAX_CONCENTRATION_SYMBOL',
        policyVersion: policy.effectiveVersion,
        reason: isBreach
          ? `Symbol concentration ${percent}% for ${symExp.symbol} exceeds threshold ${threshold}%`
          : `Symbol concentration ${percent}% for ${symExp.symbol} within threshold ${threshold}%`,
        severity: isBreach ? RiskSeverity.CRITICAL : RiskSeverity.INFO,
      });
    }

    // Venue concentration
    for (const venueExp of exposure.venueExposures) {
      const currentNotional = venueExp.grossNotional;
      if (!isValidDecimal(currentNotional)) continue;
      const currentScaled = parseScaled(currentNotional);
      const percent = formatScaled((currentScaled * 100n * SCALE) / grossScaled);
      const threshold = policy.thresholds.maxConcentrationVenuePercent;
      if (!threshold || !isValidDecimal(threshold)) continue;
      const isBreach = cmp(percent, threshold) > 0;
      results.push({
        tenantId,
        dimension: 'VENUE',
        key: venueExp.venue,
        currentPercent: percent,
        currentNotional,
        thresholdPercent: threshold,
        isBreach,
        state: isBreach ? RiskState.BLOCKED : RiskState.NORMAL,
        ruleId: 'MAX_CONCENTRATION_VENUE',
        policyVersion: policy.effectiveVersion,
        reason: isBreach
          ? `Venue concentration ${percent}% for ${venueExp.venue} exceeds threshold ${threshold}%`
          : `Venue concentration ${percent}% for ${venueExp.venue} within threshold`,
        severity: isBreach ? RiskSeverity.CRITICAL : RiskSeverity.INFO,
      });
    }

    // Account concentration
    for (const accExp of exposure.accountExposures) {
      const currentNotional = accExp.grossNotional;
      if (!isValidDecimal(currentNotional)) continue;
      const currentScaled = parseScaled(currentNotional);
      const percent = formatScaled((currentScaled * 100n * SCALE) / grossScaled);
      const threshold = policy.thresholds.maxConcentrationAccountPercent;
      if (!threshold || !isValidDecimal(threshold)) continue;
      const isBreach = cmp(percent, threshold) > 0;
      results.push({
        tenantId,
        dimension: 'ACCOUNT',
        key: accExp.accountId,
        currentPercent: percent,
        currentNotional,
        thresholdPercent: threshold,
        isBreach,
        state: isBreach ? RiskState.BLOCKED : RiskState.NORMAL,
        ruleId: 'MAX_CONCENTRATION_ACCOUNT',
        policyVersion: policy.effectiveVersion,
        reason: isBreach
          ? `Account concentration ${percent}% for ${accExp.accountId} exceeds threshold ${threshold}%`
          : `Account concentration ${percent}% for ${accExp.accountId} within threshold`,
        severity: isBreach ? RiskSeverity.CRITICAL : RiskSeverity.INFO,
      });
    }

    // Asset concentration: aggregate by base asset
    const assetMap = new Map<string, bigint>();
    for (const symExp of exposure.symbolExposures) {
      const base = symExp.baseAsset ?? symExp.symbol.split('-')[0] ?? symExp.symbol;
      const cur = assetMap.get(base) ?? 0n;
      if (isValidDecimal(symExp.grossNotional)) {
        assetMap.set(base, cur + parseScaled(symExp.grossNotional));
      }
    }
    for (const [asset, notionalScaled] of assetMap.entries()) {
      const currentNotional = formatScaled(notionalScaled);
      const percent = formatScaled((notionalScaled * 100n * SCALE) / grossScaled);
      const threshold = policy.thresholds.maxConcentrationAssetPercent;
      if (!threshold || !isValidDecimal(threshold)) continue;
      const isBreach = cmp(percent, threshold) > 0;
      results.push({
        tenantId,
        dimension: 'ASSET',
        key: asset,
        currentPercent: percent,
        currentNotional,
        thresholdPercent: threshold,
        isBreach,
        state: isBreach ? RiskState.BLOCKED : RiskState.NORMAL,
        ruleId: 'MAX_CONCENTRATION_ASSET',
        policyVersion: policy.effectiveVersion,
        reason: isBreach
          ? `Asset concentration ${percent}% for ${asset} exceeds threshold ${threshold}%`
          : `Asset concentration ${percent}% for ${asset} within threshold`,
        severity: isBreach ? RiskSeverity.CRITICAL : RiskSeverity.INFO,
      });
    }

    // Strategy concentration
    for (const stratExp of exposure.strategyExposures) {
      const currentNotional = stratExp.grossNotional;
      if (!isValidDecimal(currentNotional)) continue;
      const currentScaled = parseScaled(currentNotional);
      const percent = formatScaled((currentScaled * 100n * SCALE) / grossScaled);
      const threshold = policy.thresholds.maxConcentrationStrategyPercent;
      if (!threshold || !isValidDecimal(threshold)) continue;
      const isBreach = cmp(percent, threshold) > 0;
      results.push({
        tenantId,
        dimension: 'STRATEGY',
        key: stratExp.strategyId,
        currentPercent: percent,
        currentNotional,
        thresholdPercent: threshold,
        isBreach,
        state: isBreach ? RiskState.BLOCKED : RiskState.NORMAL,
        ruleId: 'MAX_CONCENTRATION_STRATEGY',
        policyVersion: policy.effectiveVersion,
        reason: isBreach
          ? `Strategy concentration ${percent}% for ${stratExp.strategyId} exceeds threshold ${threshold}%`
          : `Strategy concentration ${percent}% for ${stratExp.strategyId} within threshold`,
        severity: isBreach ? RiskSeverity.CRITICAL : RiskSeverity.INFO,
      });
    }

    return results;
  }

  /**
   * The authenticated caller's concentration, measured only from their own non-sandbox accounts.
   *
   * The published ratio for a position is its gross notional divided by the gross notional of the
   * whole quote-asset group it belongs to. The denominator is per quote asset because sums across
   * quote assets are not meaningful without an FX rate, and inventing one would manufacture a
   * percentage that no market supports.
   *
   * One rule produces all four published states, and it is deliberately blunt: a ratio is published
   * only when the entire assessment is CURRENT. If any position in the universe is stale or unknown,
   * every ratio in the assessment is withheld, including the ones whose own inputs looked fine.
   * The reason is that each ratio is a share of a denominator that contains the unpriceable position.
   * Publishing the healthy-looking siblings would show percentages that do not add up to the whole
   * and that move when the missing price finally arrives, while the assessment is already labelled
   * STALE or UNKNOWN - the label and the numbers would disagree.
   */
  async evaluateMyConcentration(params: {
    tenantId: string;
    userId: string;
  }): Promise<CustomerConcentrationAssessment> {
    const { tenantId, userId } = params;
    const [view, policy] = await Promise.all([
      this.customerExposureService.calculateMyExposure({ tenantId, userId }),
      this.policyService.resolveEffectivePolicy({ tenantId }),
    ]);

    const lines = Array.isArray(view.lines) ? view.lines : [];
    const evidence = lines.map((line) => ({ line, valueState: this.lineValueState(line) }));

    // The unclassifiable positions are reported separately rather than folded into a named group,
    // because a quote-asset group is the unit that a percentage means something in, and a position
    // outside every group cannot be given one.
    const unassigned = evidence.filter((entry) => entry.valueState === 'UNKNOWN' && entry.line.quoteAsset === null);
    const hasUnknownEvidence = evidence.some((entry) => entry.valueState === 'UNKNOWN');
    const hasStaleEvidence = evidence.some((entry) => entry.valueState === 'STALE');

    let state: CustomerConcentrationAssessment['state'];
    if (lines.length === 0) state = 'EMPTY';
    else if (hasUnknownEvidence) state = 'UNKNOWN';
    else if (hasStaleEvidence) state = 'STALE';
    else state = 'CURRENT';

    // Only a fully CURRENT assessment publishes a ratio. See the method comment.
    const measurable = state === 'CURRENT';

    const metrics: CustomerConcentrationMetric[] = [];
    if (unassigned.length > 0) {
      metrics.push({
        dimension: 'UNCLASSIFIED',
        key: 'QUOTE_ASSET_UNAVAILABLE',
        quoteAsset: null,
        currentNotional: null,
        currentPercent: null,
        thresholdPercent: null,
        isBreach: null,
        state: 'UNKNOWN',
        source: 'UNAVAILABLE',
        observedAt: null,
        evidenceSymbols: uniqueStrings(unassigned.map((entry) => entry.line.symbol)),
        reason:
          'The position could not be assigned to a quote-asset group, so it contributes to no ratio and no ratio includes it.',
      });
    }

    const quoteAssets = uniqueStrings(
      evidence
        .map((entry) => entry.line.quoteAsset)
        .filter((quoteAsset): quoteAsset is string => quoteAsset !== null),
    );

    for (const quoteAsset of quoteAssets) {
      const group = evidence.filter((entry) => entry.line.quoteAsset === quoteAsset);
      // While the assessment is CURRENT a group is measured, so its state is CURRENT by definition.
      // Otherwise the ratio is withheld for the whole assessment and every metric carries that
      // assessment state: a group whose own lines happened to be fine still contributes to a
      // denominator that contains a position nobody could price, so calling it CURRENT would label
      // the withheld figure as healthy.
      const groupState: CustomerRiskValueState = measurable
        ? 'CURRENT'
        : (state === 'EMPTY' ? 'UNKNOWN' : state);

      // The denominator: the sum of every measurable gross notional in this quote-asset group.
      // Addition is scaled-integer addition, so the denominator is the exact sum of its parts.
      let denominator: bigint | null = null;
      if (measurable) {
        denominator = 0n;
        for (const entry of group) {
          const scaled = scaledOrNull(entry.line.grossPositionNotional);
          if (scaled === null) {
            denominator = null;
            break;
          }
          denominator += scaled;
        }
        if (denominator !== null && denominator <= 0n) denominator = null;
      }

      const dimensions: Array<{
        dimension: 'ASSET' | 'SYMBOL' | 'VENUE';
        threshold: string | null;
        keyOf: (line: CustomerExposureLine) => string | null;
      }> = [
        { dimension: 'ASSET', threshold: policy.thresholds.maxConcentrationAssetPercent, keyOf: (line) => line.baseAsset },
        { dimension: 'SYMBOL', threshold: policy.thresholds.maxConcentrationSymbolPercent, keyOf: (line) => line.symbol },
        { dimension: 'VENUE', threshold: policy.thresholds.maxConcentrationVenuePercent, keyOf: (line) => line.venue },
      ];

      for (const { dimension, threshold, keyOf } of dimensions) {
        const groupsByKey = new Map<string, typeof group>();
        for (const entry of group) {
          const key = keyOf(entry.line);
          if (!key) continue;
          const bucket = groupsByKey.get(key);
          if (bucket) bucket.push(entry);
          else groupsByKey.set(key, [entry]);
        }

        for (const [key, entries] of groupsByKey) {
          const notional = measurable && denominator !== null
            ? entries.reduce((sum, entry) => sum + (scaledOrNull(entry.line.grossPositionNotional) ?? 0n), 0n)
            : null;
          const percent = notional !== null && denominator !== null
            ? truncatePercent(notional, denominator)
            : null;
          const isBreach = percent !== null && threshold !== null
            ? comparePercentToThreshold(percent, threshold)
            : null;

          const timestamps = entries
            .map((entry) => entry.line.priceTimestamp)
            .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)));
          // The binding freshness evidence is the OLDEST price in the group: a notional is only as
          // fresh as its oldest component.
          const observedAt = timestamps.length > 0
            ? new Date(Math.min(...timestamps.map((value) => Date.parse(value)))).toISOString()
            : null;

          metrics.push({
            dimension,
            key,
            quoteAsset,
            currentNotional: notional === null ? null : formatScaled(notional),
            currentPercent: percent === null ? null : formatScaled(percent),
            thresholdPercent: threshold,
            isBreach,
            state: groupState,
            source: entries.some((entry) => entry.line.priceSource === 'MARKET_DATA_1M_CANDLE_CLOSE')
              ? 'MARKET_DATA_1M_CANDLE_CLOSE'
              : 'UNAVAILABLE',
            observedAt,
            evidenceSymbols: uniqueStrings(entries.map((entry) => entry.line.symbol)),
            reason: this.metricReason(key, quoteAsset, entries, denominator, percent, threshold, isBreach),
          });
        }
      }
    }

    return {
      tenantId,
      asOf: view.asOf,
      state,
      eligibleAccountCount: view.eligibleAccountCount,
      dataScope: 'SIGNED_IN_USER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS',
      methodology: 'GROSS_POSITION_NOTIONAL_WITHIN_QUOTE_ASSET_NO_FX',
      marketDataMaxAgeMs: policy.thresholds.marketDataMaxAgeMs,
      metrics,
      staleSymbols: view.staleSymbols,
      unknownSymbols: view.unknownSymbols,
      notice:
        'Each percentage is a share of its own quote-asset group. Positions in different quote assets are never summed, and no FX rate is applied. A figure is published only when every position that shares its denominator is currently priced.',
    };
  }

  /**
   * The evidence state of a single position line.
   *
   * A line is measured only when it says it is current AND carries the explicit price source and
   * timestamp that make that claim checkable. A row that is nominally CURRENT but has no price
   * evidence is UNKNOWN, not current: the absence of a timestamp is not a fresh timestamp.
   */
  private lineValueState(line: CustomerExposureLine): CustomerRiskValueState {
    if (line.state === 'STALE') return 'STALE';
    if (line.state === 'UNKNOWN') return 'UNKNOWN';
    if (line.quoteAsset === null || line.baseAsset === null) return 'UNKNOWN';
    if (scaledOrNull(line.grossPositionNotional) === null) return 'UNKNOWN';
    if (line.priceSource !== 'MARKET_DATA_1M_CANDLE_CLOSE') return 'UNKNOWN';
    if (typeof line.priceTimestamp !== 'string' || !Number.isFinite(Date.parse(line.priceTimestamp))) return 'UNKNOWN';
    return 'CURRENT';
  }

  private metricReason(
    key: string,
    quoteAsset: string,
    entries: Array<{ line: CustomerExposureLine; valueState: CustomerRiskValueState }>,
    denominator: bigint | null,
    percent: bigint | null,
    threshold: string | null,
    isBreach: boolean | null,
  ): string {
    if (percent === null || denominator === null) {
      const blocking = entries.filter((entry) => entry.valueState !== 'CURRENT');
      if (blocking.length > 0) {
        const worst = blocking.some((entry) => entry.valueState === 'UNKNOWN') ? 'UNKNOWN' : 'STALE';
        const symbols = uniqueStrings(blocking.map((entry) => entry.line.symbol)).join(', ');
        return `Withheld: the ${quoteAsset} denominator contains ${symbols}, whose evidence is ${worst}. A share of a denominator that includes an unpriced position is not published.`;
      }
      return `Withheld: the ${quoteAsset} denominator is not a positive measurable total.`;
    }
    if (threshold === null) {
      return `${key} is ${percent === null ? 'unavailable' : 'measured'} within the ${quoteAsset} group; no ${key.toLowerCase()} threshold is configured, so no breach is claimed.`;
    }
    if (isBreach) {
      return `${key} is ${(Number(percent) / 1e12).toFixed(4)}% of the ${quoteAsset} group, above the ${threshold}% limit.`;
    }
    return `${key} is ${(Number(percent) / 1e12).toFixed(4)}% of the ${quoteAsset} group, within the ${threshold}% limit.`;
  }
}

/**
 * A decimal string as a scaled integer, or null when it is not an exact decimal. Null is the
 * fail-closed answer: a value that cannot be read exactly is not added to a denominator.
 */
function scaledOrNull(value: string | null): bigint | null {
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value)) return null;
  try {
    return parseScaled(value);
  } catch {
    return null;
  }
}

/**
 * The share of `part` in `whole`, as a scaled percentage, truncated toward zero.
 *
 * Truncation is the fail-closed rounding direction here: a share can never be published larger than
 * it is. Rounding half-up would let a position just under its limit display exactly at the limit.
 */
function truncatePercent(part: bigint, whole: bigint): bigint {
  if (whole <= 0n) return 0n;
  return (part * 100n * SCALE) / whole;
}

/**
 * True when the percentage strictly exceeds the threshold. A value exactly at the limit is not a
 * breach. Both sides are already scaled by the same factor, so they are compared directly.
 */
function comparePercentToThreshold(percent: bigint, threshold: string): boolean {
  const parsed = scaledOrNull(threshold);
  if (parsed === null) return false;
  return percent > parsed;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
