import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
import { CorrelationResult, RiskState, RiskSeverity } from './risk-management.types';

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
        const corr = denom === 0 ? 0 : num / denom;
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
}
