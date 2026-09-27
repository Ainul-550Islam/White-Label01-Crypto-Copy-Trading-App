/**
 * Canonical signal domain types: signal key, side, strength, timestamp, symbol, strategy version, confidence metadata, and signal lifecycle.
 */

export enum ResearchSignalState {
  DRAFT = 'DRAFT',
  VALID = 'VALID',
  PUBLISHED = 'PUBLISHED',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
  REJECTED = 'REJECTED',
  FILTERED = 'FILTERED',
}

export enum ResearchSignalSide {
  BUY = 'BUY',
  SELL = 'SELL',
  HOLD = 'HOLD',
  CLOSE_LONG = 'CLOSE_LONG',
  CLOSE_SHORT = 'CLOSE_SHORT',
}

export interface ResearchSignal {
  signalId: string;
  tenantId: string;
  strategyVersionId: string;
  signalKey: string;
  symbol: string;
  side: ResearchSignalSide;
  strength: string | null;
  confidence: string | null;
  price: string | null;
  quantity: string | null;
  timestamp: string;
  expiresAt: string | null;
  state: ResearchSignalState;
  sourceEvent: Record<string, any> | null;
  metadata: Record<string, any>;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface SignalFilterResult {
  allowed: boolean;
  reason: string | null;
  ruleId: string | null;
  filteredState: ResearchSignalState;
}

export interface SignalPublishResult {
  signalId: string;
  published: boolean;
  reason: string | null;
  downstream: string | null;
}
