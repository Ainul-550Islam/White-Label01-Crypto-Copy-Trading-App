import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
import { PortfolioExposureService } from './portfolio-exposure.service';
import { ConcentrationResult, RiskState, RiskSeverity } from './risk-management.types';

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
}
