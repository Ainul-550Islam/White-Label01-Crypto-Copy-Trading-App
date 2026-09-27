import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
import { PositionRiskResult, RiskState, RiskSeverity } from './risk-management.types';

/**
 * Position-level risk: notional, leverage, entry/mark/unrealized,
 * margin pressure, liquidation distance.
 *
 * - Never invents liquidation price. Uses authoritative venue liquidation only
 *   when available; otherwise UNKNOWN.
 * - Decimal-safe, deterministic ruleId/policyVersion/reason.
 * - Source: canonical Position, TradingSymbol, AccountBalanceSnapshot.
 */

const SCALE = 1_000_000_000_000n;
function isValidDecimal(v: any): boolean {
  return typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v);
}
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
function mul(a: string, b: string): string {
  return formatScaled((parseScaled(a) * parseScaled(b)) / SCALE);
}
function absStr(a: string): string {
  return a.startsWith('-') ? a.slice(1) : a;
}
function cmp(a: string, b: string): number {
  const av = parseScaled(a);
  const bv = parseScaled(b);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

@Injectable()
export class PositionRiskService {
  private readonly logger = new Logger(PositionRiskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: InstitutionalRiskPolicyService,
  ) {}

  async evaluatePositionRisk(params: {
    tenantId: string;
    accountId?: string;
    symbol?: string;
    traderId?: string;
    strategyId?: string;
    followerId?: string;
  }): Promise<PositionRiskResult[]> {
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
      include: { account: true },
    });

    const balances = await this.prisma.accountBalanceSnapshot.findMany({
      where: { tenantId, ...(accountId ? { accountId } : {}) },
    });
    // Aggregate wallet balance per account (sum total)
    const walletByAccount = new Map<string, bigint>();
    for (const b of balances) {
      const totalStr = b.total.toString();
      if (!isValidDecimal(totalStr)) continue;
      const cur = walletByAccount.get(b.accountId) ?? 0n;
      walletByAccount.set(b.accountId, cur + parseScaled(totalStr));
    }

    const results: PositionRiskResult[] = [];
    const nowIso = new Date().toISOString();

    for (const pos of positions) {
      const qtyStr = pos.quantity.toString();
      if (!isValidDecimal(qtyStr)) continue;

      const entryPrice = pos.averageEntryPrice?.toString() ?? null;
      const markPrice = pos.markPrice?.toString() ?? null;
      const priceUsed = markPrice ?? entryPrice ?? null;

      let notional: string | null = null;
      if (isValidDecimal(qtyStr) && priceUsed && isValidDecimal(priceUsed)) {
        notional = mul(absStr(qtyStr), priceUsed);
      }

      const unrealizedPnl = pos.unrealisedPnl?.toString() ?? null;
      const realizedPnl = pos.realisedPnl?.toString() ?? '0';

      // Leverage = notional / equity
      let leverage: string | null = null;
      const walletScaled = walletByAccount.get(pos.accountId) ?? null;
      if (notional && walletScaled !== null && walletScaled > 0n) {
        // leverage = notional / wallet
        const notionalScaled = parseScaled(notional);
        leverage = formatScaled((notionalScaled * SCALE) / walletScaled);
      }

      // Margin pressure: if unrealized negative and leverage high
      let marginPressurePercent: string | null = null;
      if (unrealizedPnl && isValidDecimal(unrealizedPnl) && walletScaled && walletScaled > 0n) {
        const upnlScaled = parseScaled(unrealizedPnl);
        if (upnlScaled < 0n) {
          const pressure = (-upnlScaled * 100n * SCALE) / walletScaled;
          marginPressurePercent = formatScaled(pressure);
        }
      }

      // Liquidation: we DO NOT invent. Check if account has liquidation info? No canonical field.
      // For spot, liquidation not applicable. For futures, venue would provide liquidation price via external feed, not stored in Position.
      // So we return UNKNOWN unless we have authoritative data from TradingAccount metadata or external service.
      // Here we explicitly do NOT invent: set null, isAuthoritative false.
      const liquidationPrice: string | null = null;
      const isLiquidationAuthoritative = false;
      let liquidationDistancePercent: string | null = null;

      // If we had authoritative liquidation price, compute distance:
      // distance = (mark - liq)/mark *100 for long, (liq - mark)/mark for short? Simplified.
      // But we don't, so remains null.

      // Concentration: not computed here, will be filled by concentration service.

      // Determine state
      let state = RiskState.NORMAL;
      let reason = 'Position within limits';
      let ruleId = 'MAX_POSITION_NOTIONAL';
      let severity = RiskSeverity.INFO;

      if (!priceUsed) {
        state = RiskState.UNKNOWN;
        reason = `Missing mark and entry price for ${pos.symbol}, cannot compute notional`;
        ruleId = 'MARKET_DATA_STALE';
        severity = RiskSeverity.WARNING;
      } else if (notional && policy.thresholds.maxPositionNotional && isValidDecimal(policy.thresholds.maxPositionNotional)) {
        if (cmp(notional, policy.thresholds.maxPositionNotional) > 0) {
          state = RiskState.BLOCKED;
          reason = `Position notional ${notional} exceeds max ${policy.thresholds.maxPositionNotional} for ${pos.symbol}`;
          ruleId = 'MAX_POSITION_NOTIONAL';
          severity = RiskSeverity.CRITICAL;
        } else if (cmp(notional, mul(policy.thresholds.maxPositionNotional, '0.8')) > 0) {
          state = RiskState.HIGH;
          reason = `Position notional ${notional} approaching limit ${policy.thresholds.maxPositionNotional} (80%)`;
          severity = RiskSeverity.WARNING;
        }
      }

      if (leverage && policy.thresholds.maxLeverageGross && isValidDecimal(policy.thresholds.maxLeverageGross)) {
        if (cmp(leverage, policy.thresholds.maxLeverageGross) > 0) {
          state = RiskState.BLOCKED;
          reason = `Leverage ${leverage}x exceeds max ${policy.thresholds.maxLeverageGross}x for ${pos.symbol}`;
          ruleId = 'MAX_LEVERAGE_GROSS';
          severity = RiskSeverity.CRITICAL;
        }
      }

      const ageMs = Date.now() - new Date(pos.updatedAt).getTime();
      const isStale = ageMs > policy.thresholds.marketDataMaxAgeMs;
      if (isStale && state === RiskState.NORMAL) {
        state = RiskState.STALE;
        reason = `Position data stale for ${pos.symbol}, age ${ageMs}ms > ${policy.thresholds.marketDataMaxAgeMs}ms`;
        ruleId = 'MARKET_DATA_STALE';
        severity = RiskSeverity.WARNING;
      }

      results.push({
        tenantId,
        accountId: pos.accountId,
        symbol: pos.symbol,
        venue: pos.venue as string,
        quantity: qtyStr,
        side: pos.side as string,
        entryPrice,
        markPrice,
        notional,
        unrealizedPnl,
        realizedPnl,
        leverage,
        marginPressurePercent,
        liquidationDistancePercent,
        liquidationPrice,
        isLiquidationAuthoritative,
        concentrationPercent: null,
        state,
        ruleId,
        policyVersion: policy.effectiveVersion,
        reason,
        severity,
        sourceTimestamp: pos.updatedAt?.toISOString() ?? nowIso,
        isStale,
        isUnknown: state === RiskState.UNKNOWN,
      });
    }

    return results;
  }
}
