// # Responsibility: computes an explainable trader risk score only from fresh, observed factor values.

import { Injectable } from '@nestjs/common';

export type TraderRiskFactorKey = 'maxDrawdownPercent' | 'leverage' | 'concentrationPercent' | 'lossStreak';
export interface TraderRiskFactorInput {
  key: TraderRiskFactorKey;
  value: string | null;
  observedAt: string | null;
  source: string | null;
}
export interface TraderRiskFactorResult {
  key: TraderRiskFactorKey;
  value: string | null;
  score: number | null;
  weightBps: number;
  status: 'MEASURED' | 'MISSING' | 'STALE' | 'INVALID';
  source: string | null;
}
export interface TraderRiskScoreResult {
  score: number | null;
  band: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | 'UNAVAILABLE';
  confidence: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
  factors: TraderRiskFactorResult[];
  methodology: 'risk-score-v1';
  asOf: string;
}

const FACTOR_WEIGHTS: Record<TraderRiskFactorKey, number> = {
  maxDrawdownPercent: 3500,
  leverage: 2500,
  concentrationPercent: 2500,
  lossStreak: 1500,
};
const DECIMAL_FACTOR_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const MAX_FACTOR_VALUE_LENGTH = 64;
const MAX_SOURCE_LENGTH = 512;

/**
 * Risk scoring is a disclosure/read model, never a trading approval. Each factor maps
 * to 0–100 risk points; absent or stale data remains null and lowers confidence.
 */
@Injectable()
export class TraderRiskScoreService {
  calculate(factors: readonly TraderRiskFactorInput[], asOf = new Date().toISOString(), maxAgeMs = 86_400_000): TraderRiskScoreResult {
    const now = Date.parse(asOf);
    if (!Number.isFinite(now) || new Date(now).toISOString() !== asOf) {
      throw new TypeError('asOf must be a canonical ISO date-time');
    }
    if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) {
      throw new RangeError('maxAgeMs must be a non-negative safe integer');
    }

    const byKey = new Map<TraderRiskFactorKey, TraderRiskFactorInput>();
    const duplicateKeys = new Set<TraderRiskFactorKey>();
    for (const factor of factors) {
      if (!factor || !Object.prototype.hasOwnProperty.call(FACTOR_WEIGHTS, factor.key)) continue;
      if (byKey.has(factor.key)) duplicateKeys.add(factor.key);
      else byKey.set(factor.key, factor);
    }

    const results = (Object.keys(FACTOR_WEIGHTS) as TraderRiskFactorKey[]).map((key) => {
      const factor = byKey.get(key);
      const weightBps = FACTOR_WEIGHTS[key];
      if (duplicateKeys.has(key)) {
        return { key, value: null, score: null, weightBps, status: 'INVALID' as const, source: null };
      }
      if (!factor || factor.value === null || !factor.observedAt || !factor.source) {
        return { key, value: null, score: null, weightBps, status: 'MISSING' as const, source: factor?.source ?? null };
      }
      const observed = Date.parse(factor.observedAt);
      if (!Number.isFinite(observed) || observed > now || now - observed > maxAgeMs) {
        return { key, value: factor.value, score: null, weightBps, status: 'STALE' as const, source: factor.source };
      }
      const source = factor.source.trim();
      if (source.length === 0 || source.length > MAX_SOURCE_LENGTH || /[\u0000-\u001f\u007f]/.test(source)
        || factor.value.length > MAX_FACTOR_VALUE_LENGTH || !DECIMAL_FACTOR_PATTERN.test(factor.value)) {
        return { key, value: factor.value, score: null, weightBps, status: 'INVALID' as const, source: source || null };
      }
      const value = Number(factor.value);
      if (!Number.isFinite(value) || value < 0 || (key === 'lossStreak' && !Number.isSafeInteger(value))) {
        return { key, value: factor.value, score: null, weightBps, status: 'INVALID' as const, source };
      }
      const score = this.factorScore(key, value);
      return { key, value: factor.value, score, weightBps, status: 'MEASURED' as const, source };
    });

    const measured = results.filter((factor) => factor.status === 'MEASURED');
    if (measured.length === 0) {
      return { score: null, band: 'UNAVAILABLE', confidence: 'UNAVAILABLE', factors: results, methodology: 'risk-score-v1', asOf };
    }
    const usedWeight = measured.reduce((total, factor) => total + factor.weightBps, 0);
    const weighted = measured.reduce((total, factor) => total + (factor.score ?? 0) * factor.weightBps, 0);
    const score = Math.round(weighted / usedWeight);
    const band = score < 25 ? 'LOW' : score < 50 ? 'MODERATE' : score < 75 ? 'HIGH' : 'CRITICAL';
    return {
      score,
      band,
      confidence: measured.length === results.length ? 'COMPLETE' : 'PARTIAL',
      factors: results,
      methodology: 'risk-score-v1',
      asOf,
    };
  }

  private factorScore(key: TraderRiskFactorKey, value: number): number {
    const thresholds: Record<TraderRiskFactorKey, number> = {
      maxDrawdownPercent: 100,
      leverage: 20,
      concentrationPercent: 100,
      lossStreak: 20,
    };
    return Math.min(100, Math.round((value / thresholds[key]) * 100));
  }
}
