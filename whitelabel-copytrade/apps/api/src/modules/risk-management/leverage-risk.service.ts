import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
import { LeverageRiskResult, RiskState, RiskSeverity } from './risk-management.types';

/**
 * Leverage validation against policy and exchange constraints.
 * Gross, net, symbol, account, projected leverage after order intent.
 * Decimal-safe, deterministic.
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
function mul(a: string, b: string): string {
  return formatScaled((parseScaled(a) * parseScaled(b)) / SCALE);
}
function cmp(a: string, b: string): number {
  const av = parseScaled(a);
  const bv = parseScaled(b);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

@Injectable()
export class LeverageRiskService {
  private readonly logger = new Logger(LeverageRiskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: InstitutionalRiskPolicyService,
  ) {}

  async evaluateLeverage(params: {
    tenantId: string;
    accountId: string;
    symbol?: string;
    traderId?: string;
    strategyId?: string;
    followerId?: string;
    orderIntent?: { quantity: string; price: string | null; side: 'BUY' | 'SELL' } | null;
  }): Promise<LeverageRiskResult[]> {
    const { tenantId, accountId, symbol, traderId, strategyId, followerId, orderIntent } = params;
    const policy = await this.policyService.resolveEffectivePolicy({
      tenantId,
      traderId: traderId ?? null,
      strategyId: strategyId ?? null,
      followerId: followerId ?? null,
    });

    const positions = await this.prisma.position.findMany({
      where: { tenantId, accountId, ...(symbol ? { symbol } : {}) },
    });

    const balances = await this.prisma.accountBalanceSnapshot.findMany({
      where: { tenantId, accountId },
    });

    let walletTotal = 0n;
    for (const b of balances) {
      const totalStr = b.total.toString();
      if (isValidDecimal(totalStr)) walletTotal += parseScaled(totalStr);
    }

    const results: LeverageRiskResult[] = [];

    // Account-level leverage
    let grossNotional = 0n;
    let netNotional = 0n;
    for (const pos of positions) {
      const qtyStr = pos.quantity.toString();
      const markPrice = pos.markPrice?.toString() ?? pos.averageEntryPrice?.toString() ?? null;
      if (!isValidDecimal(qtyStr) || !markPrice || !isValidDecimal(markPrice)) continue;
      const absQty = qtyStr.startsWith('-') ? qtyStr.slice(1) : qtyStr;
      const notional = parseScaled(mul(absQty, markPrice));
      grossNotional += notional;
      const signedQty = parseScaled(qtyStr);
      netNotional += signedQty >= 0n ? notional : -notional;
    }

    let grossLeverage: string | null = null;
    let netLeverage: string | null = null;
    if (walletTotal > 0n) {
      grossLeverage = formatScaled((grossNotional * SCALE) / walletTotal);
      const netAbs = netNotional < 0n ? -netNotional : netNotional;
      netLeverage = formatScaled((netAbs * SCALE) / walletTotal);
    }

    // Projected leverage after order intent
    let projectedGrossLeverage: string | null = null;
    let projectedNetLeverage: string | null = null;
    if (orderIntent && isValidDecimal(orderIntent.quantity) && orderIntent.price && isValidDecimal(orderIntent.price)) {
      const intentNotional = parseScaled(mul(orderIntent.quantity, orderIntent.price));
      const projectedGross = grossNotional + intentNotional;
      if (walletTotal > 0n) {
        projectedGrossLeverage = formatScaled((projectedGross * SCALE) / walletTotal);
        // For net, need side: BUY adds, SELL subtracts
        const sideMultiplier = orderIntent.side === 'BUY' ? 1n : -1n;
        const projectedNet = netNotional + sideMultiplier * intentNotional;
        const projNetAbs = projectedNet < 0n ? -projectedNet : projectedNet;
        projectedNetLeverage = formatScaled((projNetAbs * SCALE) / walletTotal);
      }
    }

    // Exchange max leverage
    const account = await this.prisma.tradingAccount.findFirst({
      where: { id: accountId, tenantId },
      include: { exchange: true },
    });
    const exchangeMaxLeverage = account?.exchange?.maxLeverage?.toString() ?? null;

    const policyMaxLeverage = policy.thresholds.maxLeverageGross ?? null;

    let isBreach = false;
    let state = RiskState.NORMAL;
    let reason = `Leverage gross ${grossLeverage ?? 'unknown'} within policy ${policyMaxLeverage ?? 'unlimited'} and exchange ${exchangeMaxLeverage ?? 'unlimited'}`;
    let severity = RiskSeverity.INFO;
    let ruleId = 'MAX_LEVERAGE_GROSS';

    const leverageToCheck = projectedGrossLeverage ?? grossLeverage;

    if (leverageToCheck && policyMaxLeverage && isValidDecimal(leverageToCheck) && isValidDecimal(policyMaxLeverage)) {
      if (cmp(leverageToCheck, policyMaxLeverage) > 0) {
        isBreach = true;
        state = RiskState.BLOCKED;
        reason = `Leverage ${leverageToCheck}x exceeds policy max ${policyMaxLeverage}x for account ${accountId}${orderIntent ? ' after projected order' : ''}`;
        severity = RiskSeverity.CRITICAL;
      }
    }

    if (leverageToCheck && exchangeMaxLeverage && isValidDecimal(exchangeMaxLeverage)) {
      if (cmp(leverageToCheck, exchangeMaxLeverage) > 0) {
        isBreach = true;
        state = RiskState.BLOCKED;
        reason = `Leverage ${leverageToCheck}x exceeds exchange max ${exchangeMaxLeverage}x for account ${accountId}`;
        severity = RiskSeverity.CRITICAL;
        ruleId = 'MAX_LEVERAGE_EXCHANGE';
      }
    }

    results.push({
      tenantId,
      accountId,
      venue: account?.exchange?.venue ?? 'UNKNOWN',
      symbol: symbol ?? null,
      grossLeverage,
      netLeverage,
      projectedGrossLeverage,
      projectedNetLeverage,
      exchangeMaxLeverage,
      policyMaxLeverage,
      isBreach,
      state,
      ruleId,
      policyVersion: policy.effectiveVersion,
      reason,
      severity,
    });

    // Per-symbol leverage if symbol specified or for each position
    if (!symbol) {
      for (const pos of positions) {
        const qtyStr = pos.quantity.toString();
        const markPrice = pos.markPrice?.toString() ?? pos.averageEntryPrice?.toString() ?? null;
        if (!isValidDecimal(qtyStr) || !markPrice || !isValidDecimal(markPrice)) continue;
        const absQty = qtyStr.startsWith('-') ? qtyStr.slice(1) : qtyStr;
        const notional = parseScaled(mul(absQty, markPrice));
        let symGrossLeverage: string | null = null;
        if (walletTotal > 0n) {
          symGrossLeverage = formatScaled((notional * SCALE) / walletTotal);
        }
        const symPolicyMax = policy.thresholds.maxLeverageSymbol ?? policyMaxLeverage;
        let symBreach = false;
        let symState = RiskState.NORMAL;
        let symReason = `Symbol leverage ${symGrossLeverage ?? 'unknown'} for ${pos.symbol} within limits`;
        if (symGrossLeverage && symPolicyMax && isValidDecimal(symGrossLeverage) && isValidDecimal(symPolicyMax)) {
          if (cmp(symGrossLeverage, symPolicyMax) > 0) {
            symBreach = true;
            symState = RiskState.BLOCKED;
            symReason = `Symbol leverage ${symGrossLeverage}x exceeds max ${symPolicyMax}x for ${pos.symbol}`;
          }
        }
        results.push({
          tenantId,
          accountId,
          venue: pos.venue as string,
          symbol: pos.symbol,
          grossLeverage: symGrossLeverage,
          netLeverage: symGrossLeverage,
          projectedGrossLeverage: null,
          projectedNetLeverage: null,
          exchangeMaxLeverage,
          policyMaxLeverage: symPolicyMax ?? null,
          isBreach: symBreach,
          state: symState,
          ruleId: 'MAX_LEVERAGE_SYMBOL',
          policyVersion: policy.effectiveVersion,
          reason: symReason,
          severity: symBreach ? RiskSeverity.CRITICAL : RiskSeverity.INFO,
        });
      }
    }

    return results;
  }
}
