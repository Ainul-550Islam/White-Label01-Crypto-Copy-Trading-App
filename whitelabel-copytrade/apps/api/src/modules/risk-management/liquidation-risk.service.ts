import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
import { LiquidationRiskResult, RiskState, RiskSeverity } from './risk-management.types';

/**
 * Liquidation risk detection without inventing prices.
 * - Uses authoritative venue liquidation only when venue provides it.
 * - If venue does not provide authoritative liquidation price, returns UNKNOWN.
 * - Never invents liquidation price via formula unless explicit validated venue-specific calculation exists and is marked authoritative.
 * - Account-level aggregation for cross-margin.
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
export class LiquidationRiskService {
  private readonly logger = new Logger(LiquidationRiskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: InstitutionalRiskPolicyService,
  ) {}

  async evaluateLiquidationRisk(params: {
    tenantId: string;
    accountId?: string;
    symbol?: string;
    traderId?: string;
    strategyId?: string;
    followerId?: string;
  }): Promise<LiquidationRiskResult[]> {
    const { tenantId, accountId, symbol, traderId, strategyId, followerId } = params;
    const policy = await this.policyService.resolveEffectivePolicy({
      tenantId,
      traderId: traderId ?? null,
      strategyId: strategyId ?? null,
      followerId: followerId ?? null,
    });

    const positions = await this.prisma.position.findMany({
      where: {
        tenantId,
        ...(accountId ? { accountId } : {}),
        ...(symbol ? { symbol } : {}),
      },
    });

    const nowIso = new Date().toISOString();
    const results: LiquidationRiskResult[] = [];

    for (const pos of positions) {
      const markPrice = pos.markPrice?.toString() ?? null;
      // No liquidation price in canonical Position table. We must NOT invent.
      // Check if there's an authoritative liquidation price in external feed? Not stored, so we return UNKNOWN.
      // If in future TradingAccount metadata holds liquidation price per symbol, we could read it, but currently not.
      const liquidationPrice: string | null = null;
      const isAuthoritative = false;

      let distancePercent: string | null = null;
      let distanceAbs: string | null = null;
      let pressure = RiskState.UNKNOWN;
      let isWarning = false;
      let isCritical = false;
      let state = RiskState.UNKNOWN;
      let reason = `Liquidation price unavailable for ${pos.symbol} — venue does not provide authoritative liquidation in canonical source, must not invent`;
      let ruleId = 'LIQUIDATION_DISTANCE';
      let severity = RiskSeverity.INFO;

      // If we had authoritative liquidation price, compute distance
      if (liquidationPrice && markPrice && isValidDecimal(liquidationPrice) && isValidDecimal(markPrice) && parseScaled(markPrice) !== 0n) {
        const markScaled = parseScaled(markPrice);
        const liqScaled = parseScaled(liquidationPrice);
        // distance % = |mark - liq| / mark *100
        const diff = markScaled > liqScaled ? markScaled - liqScaled : liqScaled - markScaled;
        const distPct = (diff * 100n * SCALE) / (markScaled < 0n ? -markScaled : markScaled);
        distancePercent = formatScaled(distPct);
        distanceAbs = formatScaled(diff);

        // Evaluate against thresholds
        if (policy.thresholds.liquidationCriticalDistance && isValidDecimal(policy.thresholds.liquidationCriticalDistance)) {
          if (cmp(distancePercent, policy.thresholds.liquidationCriticalDistance) < 0) {
            pressure = RiskState.CRITICAL;
            isCritical = true;
            state = RiskState.CRITICAL;
            reason = `Liquidation distance ${distancePercent}% below critical ${policy.thresholds.liquidationCriticalDistance}% for ${pos.symbol}`;
            severity = RiskSeverity.CRITICAL;
          } else if (policy.thresholds.liquidationWarningDistance && cmp(distancePercent, policy.thresholds.liquidationWarningDistance) < 0) {
            pressure = RiskState.HIGH;
            isWarning = true;
            state = RiskState.HIGH;
            reason = `Liquidation distance ${distancePercent}% below warning ${policy.thresholds.liquidationWarningDistance}% for ${pos.symbol}`;
            severity = RiskSeverity.WARNING;
          } else {
            pressure = RiskState.NORMAL;
            state = RiskState.NORMAL;
            reason = `Liquidation distance ${distancePercent}% within limits for ${pos.symbol}`;
          }
        }
      } else {
        // For spot positions, liquidation not applicable — but we still return UNKNOWN with explanation, not fake.
        // Determine if this is spot or futures via venue/marketType? Position doesn't store marketType, but we can check TradingSymbol.
        const symbolMeta = await this.prisma.tradingSymbol.findFirst({
          where: { tenantId, symbol: pos.symbol },
        });
        if (symbolMeta?.marketType === 'SPOT') {
          state = RiskState.NORMAL;
          pressure = RiskState.NORMAL;
          reason = `Spot position ${pos.symbol} — liquidation not applicable`;
          severity = RiskSeverity.INFO;
        } else {
          // Futures/Margin without authoritative liquidation — must stay UNKNOWN, not invent.
          state = RiskState.UNKNOWN;
          pressure = RiskState.UNKNOWN;
          reason = `Liquidation price not available for ${pos.symbol} (${pos.venue}) — authoritative venue liquidation not in canonical source, returning UNKNOWN per policy`;
          severity = RiskSeverity.WARNING;
        }
      }

      const ageMs = Date.now() - new Date(pos.updatedAt).getTime();
      const isStale = ageMs > policy.thresholds.marketDataMaxAgeMs;
      if (isStale && state === RiskState.NORMAL) {
        state = RiskState.STALE;
        reason += ` (source stale ${ageMs}ms)`;
      }

      results.push({
        tenantId,
        accountId: pos.accountId,
        symbol: pos.symbol,
        venue: pos.venue as string,
        markPrice,
        liquidationPrice,
        distancePercent,
        distanceAbs,
        pressure,
        isWarning,
        isCritical,
        isAuthoritative,
        state,
        ruleId,
        policyVersion: policy.effectiveVersion,
        reason,
        severity,
        sourceTimestamp: pos.updatedAt?.toISOString() ?? nowIso,
      });
    }

    // Account-level liquidation risk: if any position critical, account critical
    if (results.length > 1 && accountId) {
      const hasCritical = results.some((r) => r.isCritical);
      const hasWarning = results.some((r) => r.isWarning);
      if (hasCritical || hasWarning) {
        results.push({
          tenantId,
          accountId,
          symbol: null,
          venue: results[0]?.venue ?? 'UNKNOWN',
          markPrice: null,
          liquidationPrice: null,
          distancePercent: null,
          distanceAbs: null,
          pressure: hasCritical ? RiskState.CRITICAL : RiskState.HIGH,
          isWarning: hasWarning,
          isCritical: hasCritical,
          isAuthoritative: false,
          state: hasCritical ? RiskState.CRITICAL : RiskState.HIGH,
          ruleId: 'LIQUIDATION_DISTANCE',
          policyVersion: policy.effectiveVersion,
          reason: hasCritical
            ? `Account ${accountId} has at least one position within critical liquidation distance`
            : `Account ${accountId} has at least one position within warning liquidation distance`,
          severity: hasCritical ? RiskSeverity.CRITICAL : RiskSeverity.WARNING,
          sourceTimestamp: nowIso,
        });
      }
    }

    return results;
  }
}
