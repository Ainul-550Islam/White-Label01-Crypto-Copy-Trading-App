// # Responsibility: reads the authenticated customer's own concentration and measured correlation evidence without computing financial values in the browser.

import { apiClient } from './api-client';

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

export interface CustomerCorrelationPair {
  tenantId: string;
  method: string;
  methodVersion: string;
  lookbackDays: number;
  minObservations: number;
  observations: number;
  pairKey: string;
  correlation: string | null;
  threshold: string | null;
  isBreach: boolean;
  state: string;
  ruleId: string;
  policyVersion: string;
  reason: string;
  severity: string;
  isUnknown: boolean;
  sourceInterval?: string | null;
  sourceTimestamp?: string | null;
  sourceMaxAgeMs?: number | null;
  sourceSymbols?: string[];
  sourceMethodology?: string | null;
  isStale?: boolean;
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
  pairs: CustomerCorrelationPair[];
  notice: string;
}

export interface CustomerRiskAnalysisView {
  tenantId: string;
  requestedAt: string;
  dataScope: 'SIGNED_IN_USER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS';
  concentration: CustomerConcentrationAssessment;
  correlation: CustomerCorrelationAssessment;
}

export const riskAnalysisApi = {
  getMyRiskAnalysis(): Promise<CustomerRiskAnalysisView> {
    return apiClient.get<CustomerRiskAnalysisView>('/v1/risk-management/my-risk-analysis');
  },
};
