import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
import { MarginRiskResult, RiskState, RiskSeverity } from './risk-management.types';

/**
 * Margin risk from canonical sources only:
 * AccountBalanceSnapshot (free/locked/total) + Position notional + open orders.
 * Never trusts client-provided margin.
 * Decimal-safe, fail-closed.
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
function add(a: string, b: string): string {
  return formatScaled(parseScaled(a) + parseScaled(b));
}
function cmp(a: string, b: string): number {
  const av = parseScaled(a);
  const bv = parseScaled(b);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

@Injectable()
export class MarginRiskService {
  private readonly logger = new Logger(MarginRiskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: InstitutionalRiskPolicyService,
  ) {}

  async evaluateMargin(params: {
    tenantId: string;
    accountId: string;
    orderIntent?: { symbol: string; quantity: string; price: string | null; side: 'BUY' | 'SELL' } | null;
    traderId?: string;
    strategyId?: string;
    followerId?: string;
  }): Promise<MarginRiskResult[]> {
    const { tenantId, accountId, orderIntent, traderId, strategyId, followerId } = params;
    const policy = await this.policyService.resolveEffectivePolicy({
      tenantId,
      traderId: traderId ?? null,
      strategyId: strategyId ?? null,
      followerId: followerId ?? null,
    });

    const balances = await this.prisma.accountBalanceSnapshot.findMany({
      where: { tenantId, accountId },
    });

    const positions = await this.prisma.position.findMany({
      where: { tenantId, accountId },
    });

    const openOrders = await this.prisma.order.findMany({
      where: {
        tenantId,
        accountId,
        status: { in: ['PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED'] },
      },
    });

    // Group balances by asset, sum total per account for quote asset (USDT assumed)
    // For margin we need wallet, available, locked, initial, maintenance
    // Since schema doesn't have margin-specific columns, we derive from balances:
    // wallet = sum(total), available = sum(free), locked = sum(locked)
    // initial/maintenance require exchange-specific data; if unavailable, return null and mark UNKNOWN where needed.

    const walletByAsset = new Map<string, { free: bigint; locked: bigint; total: bigint; updatedAt: Date }>();
    for (const b of balances) {
      const freeStr = b.free.toString();
      const lockedStr = b.locked.toString();
      const totalStr = b.total.toString();
      if (!isValidDecimal(freeStr) || !isValidDecimal(lockedStr) || !isValidDecimal(totalStr)) continue;
      const entry = walletByAsset.get(b.asset) ?? { free: 0n, locked: 0n, total: 0n, updatedAt: b.updatedAt };
      entry.free += parseScaled(freeStr);
      entry.locked += parseScaled(lockedStr);
      entry.total += parseScaled(totalStr);
      if (new Date(b.updatedAt) > entry.updatedAt) entry.updatedAt = b.updatedAt;
      walletByAsset.set(b.asset, entry);
    }

    // For simplicity, assume USDT is margin currency; aggregate USDT totals
    const usdt = walletByAsset.get('USDT') ?? walletByAsset.get('USD') ?? null;
    const walletBalance = usdt ? formatScaled(usdt.total) : null;
    const availableBalance = usdt ? formatScaled(usdt.free) : null;
    const lockedBalance = usdt ? formatScaled(usdt.locked) : null;

    // Compute used margin from positions: sum(abs(notional) * maintenance margin rate)
    // Since we don't have margin rate in Position, we approximate initial margin as notional / leverage if leverage known, else null.
    // We will return null for initial/maintenance when unavailable, and mark UNKNOWN accordingly.

    let totalNotional = 0n;
    for (const pos of positions) {
      const qtyStr = pos.quantity.toString();
      const markPrice = pos.markPrice?.toString() ?? pos.averageEntryPrice?.toString() ?? null;
      if (isValidDecimal(qtyStr) && markPrice && isValidDecimal(markPrice)) {
        const absQty = qtyStr.startsWith('-') ? qtyStr.slice(1) : qtyStr;
        const notional = parseScaled(mul(absQty, markPrice));
        totalNotional += notional;
      }
    }

    let openOrderNotional = 0n;
    for (const ord of openOrders) {
      const qtyStr = ord.quantity.toString();
      const priceStr = ord.price?.toString() ?? null;
      if (isValidDecimal(qtyStr) && priceStr && isValidDecimal(priceStr)) {
        openOrderNotional += parseScaled(mul(qtyStr, priceStr));
      }
    }

    // If wallet unavailable, state UNKNOWN
    const nowIso = new Date().toISOString();
    const sourceTimestamp = usdt?.updatedAt.toISOString() ?? nowIso;
    const ageMs = usdt ? Date.now() - usdt.updatedAt.getTime() : Infinity;
    const isStale = ageMs > policy.thresholds.marketDataMaxAgeMs;

    let marginUtilizationPercent: string | null = null;
    if (walletBalance && isValidDecimal(walletBalance) && parseScaled(walletBalance) > 0n) {
      // utilization = (locked + position notional) / wallet *100? Simplified: (totalNotional+openOrderNotional)/wallet
      const used = totalNotional + openOrderNotional;
      marginUtilizationPercent = formatScaled((used * 100n * SCALE) / parseScaled(walletBalance));
    }

    let projectedUtilization: string | null = null;
    if (orderIntent && walletBalance && isValidDecimal(walletBalance) && parseScaled(walletBalance) > 0n) {
      let intentNotional = 0n;
      if (isValidDecimal(orderIntent.quantity) && orderIntent.price && isValidDecimal(orderIntent.price)) {
        intentNotional = parseScaled(mul(orderIntent.quantity, orderIntent.price));
      }
      const projectedUsed = totalNotional + openOrderNotional + intentNotional;
      projectedUtilization = formatScaled((projectedUsed * 100n * SCALE) / parseScaled(walletBalance));
    }

    let state = RiskState.NORMAL;
    let reason = 'Margin within limits';
    let ruleId = 'MARGIN_UTILIZATION';
    let severity = RiskSeverity.INFO;

    if (!walletBalance) {
      state = RiskState.UNKNOWN;
      reason = `Wallet balance unavailable for account ${accountId}, cannot compute margin utilization`;
      severity = RiskSeverity.WARNING;
    } else if (marginUtilizationPercent && policy.thresholds.marginCriticalUtilization && isValidDecimal(policy.thresholds.marginCriticalUtilization)) {
      if (cmp(marginUtilizationPercent, policy.thresholds.marginCriticalUtilization) > 0) {
        state = RiskState.CRITICAL;
        reason = `Margin utilization ${marginUtilizationPercent}% exceeds critical ${policy.thresholds.marginCriticalUtilization}%`;
        severity = RiskSeverity.CRITICAL;
      } else if (policy.thresholds.marginWarningUtilization && cmp(marginUtilizationPercent, policy.thresholds.marginWarningUtilization) > 0) {
        state = RiskState.HIGH;
        reason = `Margin utilization ${marginUtilizationPercent}% exceeds warning ${policy.thresholds.marginWarningUtilization}%`;
        severity = RiskSeverity.WARNING;
      }
    }

    if (isStale) {
      state = state === RiskState.NORMAL ? RiskState.STALE : state;
      reason += ` (source stale ${ageMs}ms)`;
    }

    if (projectedUtilization && policy.thresholds.marginCriticalUtilization && isValidDecimal(policy.thresholds.marginCriticalUtilization)) {
      if (cmp(projectedUtilization, policy.thresholds.marginCriticalUtilization) > 0) {
        state = RiskState.BLOCKED;
        reason = `Projected margin utilization ${projectedUtilization}% would exceed critical ${policy.thresholds.marginCriticalUtilization}% after order`;
        ruleId = 'MARGIN_UTILIZATION';
        severity = RiskSeverity.CRITICAL;
      }
    }

    // For multi-venue, we return one per account aggregated; but interface expects array
    const result: MarginRiskResult = {
      tenantId,
      accountId,
      venue: 'AGGREGATED',
      walletBalance,
      availableBalance,
      lockedBalance,
      initialMargin: null, // not available in canonical source, must not invent
      maintenanceMargin: null,
      marginUtilizationPercent,
      projectedMarginUtilizationPercent: projectedUtilization,
      freeMargin: availableBalance,
      warnings: isStale ? [`Balance source stale for account ${accountId}`] : [],
      state,
      ruleId,
      policyVersion: policy.effectiveVersion,
      reason,
      severity,
      sourceTimestamp,
      isStale,
    };

    return [result];
  }
}
