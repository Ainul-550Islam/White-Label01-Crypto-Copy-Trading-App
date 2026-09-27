import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
import { VarResult, RiskState, RiskSeverity } from './risk-management.types';

/**
 * VaR risk: historical simulation, confidence/horizon/window, Decimal-safe output.
 * Labeled RISK_ESTIMATE not guaranteed loss.
 * Returns UNKNOWN/INSUFFICIENT_DATA when insufficient observations.
 * Never guarantees future loss.
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
export class VarRiskService {
  private readonly logger = new Logger(VarRiskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: InstitutionalRiskPolicyService,
  ) {}

  async evaluateVar(params: {
    tenantId: string;
    accountId?: string;
    traderId?: string;
    strategyId?: string;
    followerId?: string;
  }): Promise<VarResult[]> {
    const { tenantId, accountId, traderId, strategyId, followerId } = params;
    const policy = await this.policyService.resolveEffectivePolicy({
      tenantId,
      traderId: traderId ?? null,
      strategyId: strategyId ?? null,
      followerId: followerId ?? null,
    });

    const confidence = policy.thresholds.varConfidence ?? '95';
    const horizonDays = policy.thresholds.varHorizonDays;
    const windowDays = policy.thresholds.varWindowDays;
    const minObs = policy.thresholds.varMinObservations;
    const methodology = 'HISTORICAL_SIMULATION';
    const methodVersion = 'v1.0.0-historical';

    // Get portfolio exposure for current gross
    const positions = await this.prisma.position.findMany({
      where: { tenantId, ...(accountId ? { accountId } : {}) },
    });

    let grossNotional = 0n;
    for (const pos of positions) {
      const qtyStr = pos.quantity.toString();
      const markPrice = pos.markPrice?.toString() ?? pos.averageEntryPrice?.toString() ?? null;
      if (!qtyStr || !markPrice) continue;
      if (!isValidDecimal(qtyStr) || !isValidDecimal(markPrice)) continue;
      const absQty = qtyStr.startsWith('-') ? qtyStr.slice(1) : qtyStr;
      // Simple notional: qty * price
      const notionalStr = formatScaled((parseScaled(absQty) * parseScaled(markPrice)) / SCALE);
      if (isValidDecimal(notionalStr)) grossNotional += parseScaled(notionalStr);
    }

    // Fetch historical PnL / returns: use MarketDataRecord for portfolio? For simplicity use daily PnL from RiskSnapshotMetadata
    const startDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const snapshots = await this.prisma.riskSnapshotMetadata.findMany({
      where: { tenantId, ...(accountId ? { accountId } : {}), capturedAt: { gte: startDate } },
      orderBy: { capturedAt: 'asc' },
      take: windowDays * 2,
    });

    const observations = snapshots.length;

    if (observations < minObs) {
      return [
        {
          tenantId,
          methodology,
          confidence,
          horizonDays,
          windowDays,
          observations,
          minObservations: minObs,
          varValue: null,
          varPercent: null,
          varAmount: null,
          methodVersion,
          label: 'RISK_ESTIMATE',
          isBreach: false,
          threshold: policy.thresholds.varThreshold ?? null,
          state: RiskState.UNKNOWN,
          ruleId: 'VAR_LIMIT',
          policyVersion: policy.effectiveVersion,
          reason: `Insufficient observations for VaR: ${observations} < ${minObs} required (window ${windowDays}d), returning UNKNOWN/INSUFFICIENT_DATA per policy — must not invent VaR`,
          severity: RiskSeverity.INFO,
          isUnknown: true,
          note: 'VaR is an estimate, not a guaranteed maximum loss. Past performance is not indicative of future results.',
        },
      ];
    }

    // Compute daily PnL returns from snapshots
    const returns: number[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1].netDailyPnl;
      const curr = snapshots[i].netDailyPnl;
      if (prev === null || curr === null) continue;
      const prevNum = Number(prev);
      const currNum = Number(curr);
      // Daily PnL already is P&L, not equity. Use PnL as return for VaR?
      // For historical VaR we sort PnL losses.
      returns.push(currNum);
    }

    if (returns.length < minObs) {
      return [
        {
          tenantId,
          methodology,
          confidence,
          horizonDays,
          windowDays,
          observations: returns.length,
          minObservations: minObs,
          varValue: null,
          varPercent: null,
          varAmount: null,
          methodVersion,
          label: 'RISK_ESTIMATE',
          isBreach: false,
          threshold: policy.thresholds.varThreshold ?? null,
          state: RiskState.UNKNOWN,
          ruleId: 'VAR_LIMIT',
          policyVersion: policy.effectiveVersion,
          reason: `Insufficient return observations for VaR: ${returns.length} < ${minObs}, UNKNOWN`,
          severity: RiskSeverity.INFO,
          isUnknown: true,
          note: 'VaR is an estimate, not a guaranteed maximum loss.',
        },
      ];
    }

    // Historical VaR: sort PnL ascending (worst losses first), percentile at confidence
    const sorted = [...returns].sort((a, b) => a - b); // ascending: most negative first
    const confidenceNum = Number(confidence);
    const tailPercent = 100 - confidenceNum; // e.g. 95 -> 5% tail
    const index = Math.floor((tailPercent / 100) * sorted.length);
    const varPnl = sorted[index] ?? sorted[0]; // negative number expected for loss

    // VaR as positive loss amount: -varPnl if negative
    const varLoss = varPnl < 0 ? -varPnl : 0;
    const varValueStr = varLoss.toFixed(6); // decimal string
    const varAmountStr = varValueStr;

    let varPercent: string | null = null;
    if (grossNotional > 0n) {
      // varPercent = varLoss / grossNotional *100
      const varScaled = parseScaled(varValueStr);
      varPercent = formatScaled((varScaled * 100n * SCALE) / grossNotional);
    }

    let isBreach = false;
    let state = RiskState.NORMAL;
    let reason = `VaR ${varValueStr} (${varPercent ?? 'unknown'}%) at ${confidence}% confidence, ${horizonDays}d horizon — RISK_ESTIMATE, not guaranteed loss`;
    let severity = RiskSeverity.INFO;

    if (policy.thresholds.varThreshold && isValidDecimal(policy.thresholds.varThreshold)) {
      if (cmp(varValueStr, policy.thresholds.varThreshold) > 0) {
        isBreach = true;
        state = RiskState.HIGH;
        reason = `VaR ${varValueStr} exceeds threshold ${policy.thresholds.varThreshold} at ${confidence}% confidence — RISK_ESTIMATE breach, not guaranteed future loss`;
        severity = RiskSeverity.WARNING;
      }
    }

    return [
      {
        tenantId,
        methodology,
        confidence,
        horizonDays,
        windowDays,
        observations: returns.length,
        minObservations: minObs,
        varValue: varValueStr,
        varPercent,
        varAmount: varAmountStr,
        methodVersion,
        label: 'RISK_ESTIMATE',
        isBreach,
        threshold: policy.thresholds.varThreshold ?? null,
        state,
        ruleId: 'VAR_LIMIT',
        policyVersion: policy.effectiveVersion,
        reason,
        severity,
        isUnknown: false,
        note: 'VaR is an estimate, not a guaranteed maximum loss. Past performance is not indicative of future results. This metric is a control signal, not a promise.',
      },
    ];
  }
}
