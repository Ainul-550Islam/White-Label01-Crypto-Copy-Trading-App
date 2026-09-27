import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
import { RiskManagementSnapshotRepository } from './risk-snapshot.repository';
import { DrawdownResult, RiskState, RiskSeverity, RiskPolicyScope } from './risk-management.types';

/**
 * Drawdown tracking against immutable high-water mark (HWM).
 * HWM persisted, never reset on service restart.
 * Uses canonical equity/PnL from AccountBalanceSnapshot and Position.
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
function sub(a: string, b: string): string {
  return formatScaled(parseScaled(a) - parseScaled(b));
}

@Injectable()
export class DrawdownRiskService {
  private readonly logger = new Logger(DrawdownRiskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: InstitutionalRiskPolicyService,
    private readonly snapshotRepo: RiskManagementSnapshotRepository,
  ) {}

  async evaluateDrawdown(params: {
    tenantId: string;
    accountId?: string;
    traderId?: string;
    strategyId?: string;
    followerId?: string;
  }): Promise<DrawdownResult[]> {
    const { tenantId, accountId, traderId, strategyId, followerId } = params;
    const policy = await this.policyService.resolveEffectivePolicy({
      tenantId,
      traderId: traderId ?? null,
      strategyId: strategyId ?? null,
      followerId: followerId ?? null,
    });

    // Resolve scope
    let scope = RiskPolicyScope.TENANT;
    let scopeId = tenantId;
    if (followerId) {
      scope = RiskPolicyScope.FOLLOWER;
      scopeId = followerId;
    } else if (strategyId) {
      scope = RiskPolicyScope.STRATEGY;
      scopeId = strategyId;
    } else if (traderId) {
      scope = RiskPolicyScope.TRADER;
      scopeId = traderId;
    } else if (accountId) {
      scope = RiskPolicyScope.TENANT; // account level maps to tenant scope for drawdown? Use accountId as scopeId but keep type ACCOUNT via TENANT
      // We'll use TENANT scope with accountId as id for simplicity, but store accountId separately
      scopeId = accountId;
    }

    // Get current equity from canonical balances + positions unrealized
    const balances = await this.prisma.accountBalanceSnapshot.findMany({
      where: { tenantId, ...(accountId ? { accountId } : {}) },
    });
    const positions = await this.prisma.position.findMany({
      where: { tenantId, ...(accountId ? { accountId } : {}) },
    });

    let walletTotal = 0n;
    let latestTs: Date | null = null;
    for (const b of balances) {
      const totalStr = b.total.toString();
      if (!isValidDecimal(totalStr)) continue;
      walletTotal += parseScaled(totalStr);
      if (!latestTs || new Date(b.updatedAt) > latestTs) latestTs = b.updatedAt;
    }

    let unrealizedTotal = 0n;
    for (const p of positions) {
      const upnlStr = p.unrealisedPnl?.toString();
      if (upnlStr && isValidDecimal(upnlStr)) {
        unrealizedTotal += parseScaled(upnlStr);
      }
      if (!latestTs || new Date(p.updatedAt) > latestTs) latestTs = p.updatedAt;
    }

    const currentEquity = walletTotal + unrealizedTotal;
    const currentEquityStr = formatScaled(currentEquity);
    const sourceTimestamp = latestTs?.toISOString() ?? new Date().toISOString();

    // Retrieve persisted HWM
    const persisted = await this.snapshotRepo.getHighWaterMark({ tenantId, scope, scopeId });
    let highWaterMark = persisted?.highWaterMark ?? null;
    let lastHwmAt = persisted?.timestamp ?? null;

    if (!highWaterMark) {
      // First time: HWM = current equity
      highWaterMark = currentEquityStr;
      lastHwmAt = sourceTimestamp;
      await this.snapshotRepo.persistHighWaterMark({
        tenantId,
        scope,
        scopeId,
        highWaterMark,
        timestamp: sourceTimestamp,
        policyVersion: policy.effectiveVersion,
      });
    } else {
      // If current equity > HWM, update HWM (ratchet only upwards)
      if (cmp(currentEquityStr, highWaterMark) > 0) {
        highWaterMark = currentEquityStr;
        lastHwmAt = sourceTimestamp;
        await this.snapshotRepo.persistHighWaterMark({
          tenantId,
          scope,
          scopeId,
          highWaterMark,
          timestamp: sourceTimestamp,
          policyVersion: policy.effectiveVersion,
        });
      }
    }

    // Compute drawdown
    let drawdownAbs: string | null = null;
    let drawdownPercent: string | null = null;
    if (isValidDecimal(highWaterMark) && parseScaled(highWaterMark) > 0n) {
      const hwmScaled = parseScaled(highWaterMark);
      if (currentEquity < hwmScaled) {
        const abs = hwmScaled - currentEquity;
        drawdownAbs = formatScaled(abs);
        // percent = abs / hwm *100
        drawdownPercent = formatScaled((abs * 100n * SCALE) / hwmScaled);
      } else {
        drawdownAbs = '0';
        drawdownPercent = '0';
      }
    }

    const threshold = policy.thresholds.maxDrawdownPercent;
    let isBreach = false;
    let state = RiskState.NORMAL;
    let reason = `Drawdown ${drawdownPercent ?? '0'}% within limit ${threshold ?? 'unlimited'}`;
    let severity = RiskSeverity.INFO;
    let ruleId = 'MAX_DRAWDOWN';

    if (drawdownPercent && threshold && isValidDecimal(threshold) && isValidDecimal(drawdownPercent)) {
      if (cmp(drawdownPercent, threshold) > 0) {
        isBreach = true;
        state = RiskState.BLOCKED;
        reason = `Drawdown ${drawdownPercent}% exceeds max ${threshold}% for scope ${scope} ${scopeId}`;
        severity = RiskSeverity.CRITICAL;
      } else if (cmp(drawdownPercent, formatScaled((parseScaled(threshold) * 80n) / 100n)) > 0) {
        state = RiskState.HIGH;
        reason = `Drawdown ${drawdownPercent}% approaching limit ${threshold}% (80%)`;
        severity = RiskSeverity.WARNING;
      }
    }

    // Intraday drawdown: compare against today's start equity (from daily snapshot)
    // Simplified: use same as rolling for now, but track separately
    const intradayDrawdownPercent = drawdownPercent; // placeholder, proper intraday requires daily starting equity

    const result: DrawdownResult = {
      tenantId,
      scope,
      scopeId,
      highWaterMark,
      currentEquity: currentEquityStr,
      drawdownAbs,
      drawdownPercent,
      intradayDrawdownPercent,
      rollingDrawdownPercent: drawdownPercent,
      thresholdPercent: threshold ?? null,
      isBreach,
      isRecovery: drawdownPercent === '0' || drawdownPercent === null,
      state,
      ruleId,
      policyVersion: policy.effectiveVersion,
      reason,
      severity,
      lastHighWaterMarkAt: lastHwmAt,
      sourceTimestamp,
    };

    return [result];
  }
}
