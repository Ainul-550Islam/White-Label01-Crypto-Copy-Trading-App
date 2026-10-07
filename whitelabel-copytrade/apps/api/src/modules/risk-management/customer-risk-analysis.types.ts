// # Responsibility: defines authenticated-customer concentration and correlation evidence views without implying unavailable risk measurements.

import type { CorrelationResult } from './risk-management.types';

export type CustomerRiskEvidenceState = 'CURRENT' | 'STALE' | 'UNKNOWN' | 'EMPTY';
export type CustomerRiskValueState = Exclude<CustomerRiskEvidenceState, 'EMPTY'>;

export interface CustomerConcentrationMetric {
  dimension: 'ASSET' | 'SYMBOL' | 'VENUE' | 'UNCLASSIFIED';
  key: string;
  quoteAsset: string | null;
  currentNotional: string | null;
  currentPercent: string | null;
  thresholdPercent: string | null;
  isBreach: boolean | null;
  state: CustomerRiskValueState;
  source: 'MARKET_DATA_1M_CANDLE_CLOSE' | 'UNAVAILABLE';
  observedAt: string | null;
  evidenceSymbols: string[];
  reason: string;
}

export interface CustomerConcentrationAssessment {
  tenantId: string;
  asOf: string;
  state: CustomerRiskEvidenceState;
  eligibleAccountCount: number;
  dataScope: 'SIGNED_IN_USER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS';
  methodology: 'GROSS_POSITION_NOTIONAL_WITHIN_QUOTE_ASSET_NO_FX';
  marketDataMaxAgeMs: number;
  metrics: CustomerConcentrationMetric[];
  staleSymbols: string[];
  unknownSymbols: string[];
  notice: string;
}

export interface CustomerCorrelationAssessment {
  tenantId: string;
  asOf: string;
  state: CustomerRiskEvidenceState;
  dataScope: 'SIGNED_IN_USER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS';
  method: string;
  methodVersion: string;
  interval: '1d';
  lookbackDays: number;
  minObservations: number;
  maxSourceAgeMs: number;
  activePositionCount: number | null;
  instrumentCount: number | null;
  omittedPositionCount: number | null;
  candidatePairCount: number | null;
  evaluatedPairCount: number;
  truncatedPairCount: number | null;
  pairs: CorrelationResult[];
  notice: string;
}

export interface CustomerRiskAnalysisView {
  tenantId: string;
  requestedAt: string;
  dataScope: 'SIGNED_IN_USER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS';
  concentration: CustomerConcentrationAssessment;
  correlation: CustomerCorrelationAssessment;
}
