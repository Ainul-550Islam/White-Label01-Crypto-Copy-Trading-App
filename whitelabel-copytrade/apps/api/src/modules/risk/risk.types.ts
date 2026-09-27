/**
 * View models for the Part 8 risk control surface.
 *
 * Same disciplines as the strategy and dataset mappers, restated because
 * this module borders money:
 *
 * 1. Decimal and BigInt values cross as STRINGS. An exposure notional or a
 *    snapshot version rendered through `Number` loses the digits that
 *    distinguish "at the limit" from "over the limit" - the exact interval
 *    a risk API must not blur.
 * 2. No view carries exchange credentials, balances with account numbers,
 *    or anything from which a venue request could be constructed. The
 *    most dangerous-looking thing exported here is which limit a breach
 *    tripped on.
 * 3. Every timestamp field is either an ISO string (wall-clock columns) or
 *    a decimal string (micros since epoch) - the pair is not interchangeable
 *    in the UI, and pretending otherwise produces a dashboard that reads a
 *    microsecond count as milliseconds and reports everything as "fresh".
 */

import type {
  ProtectionActionWire,
  RiskEventSeverityWire,
  RiskKillScopeWire,
  RiskLimitScopeWire,
  RiskRuleIdWire,
  RiskSwitchStatusWire,
} from './risk.constants';

/** One published revision of an account's risk configuration. */
export interface RiskConfigurationVersionView {
  id: string;
  accountId: string;
  version: number;
  digest: string;
  changeReason: string;
  changedByUserId: string;
  createdAt: string;
  loosenedCeilings: boolean;
}

/** The live (current) document view: metadata plus the parsed policy. */
export interface RiskConfigurationView {
  accountId: string;
  version: number;
  digest: string | null;
  dailyLossIncludesUnrealized: boolean;
  allowRiskReducingOrders: boolean;
  /** The verbatim policy JSON the service published; consumers recompute. */
  policyJson: unknown;
  protectionJson: unknown;
  history: RiskConfigurationVersionView[];
}

/** One entry of the policy document as the API renders it. */
export interface RiskLimitEntryView {
  ruleId: RiskRuleIdWire;
  scope: RiskLimitScopeWire;
  target: string | null;
  enabled: boolean;
  value: string;
  unit: string;
  priority: number;
  effectiveFromMicros: string;
  effectiveUntilMicros: string | null;
  entryVersion: number;
  windowMicros: number | null;
}

/** The effective (resolved) ceiling per rule for one evaluation context. */
export interface ResolvedLimitView {
  ruleId: RiskRuleIdWire;
  value: string;
  unit: string;
  windowMicros: number | null;
  governingScope: RiskLimitScopeWire;
  governingTarget: string | null;
  governingEntryVersion: number;
  applicableEntryCount: number;
}

export interface RiskEventView {
  id: string;
  tenantId: string;
  accountId: string | null;
  strategyId: string | null;
  orderId: string | null;
  eventType: string;
  severity: RiskEventSeverityWire;
  code: string;
  message: string;
  limitValue: string | null;
  observedValue: string | null;
  venue: string | null;
  symbol: string | null;
  ruleId: RiskRuleIdWire | null;
  scope: RiskLimitScopeWire | null;
  scopeTarget: string | null;
  action: ProtectionActionWire | null;
  source: string | null;
  snapshotVersion: string | null;
  isSimulated: boolean;
  riskDecisionId: string | null;
  correlationId: string | null;
  createdAt: string;
}

/** The durable mirror of one kill switch, with its Part 8 lifecycle. */
export interface RiskSwitchView {
  id: string;
  tenantId: string | null;
  scope: RiskKillScopeWire;
  target: string | null;
  isEngaged: boolean;
  status: RiskSwitchStatusWire;
  reason: string | null;
  triggeredByRule: RiskRuleIdWire | null;
  severity: RiskEventSeverityWire | null;
  requiresExplicitClear: boolean;
  engagedAt: string | null;
  acknowledgedAt: string | null;
  clearedAt: string | null;
  updatedAt: string;
}

/** One periodic snapshot-metadata row, as the operator reads it. */
export interface RiskSnapshotMetadataView {
  id: string;
  accountId: string;
  snapshotId: string;
  snapshotVersion: string;
  tradingDay: string;
  configDigest: string | null;
  stateDigest: string | null;
  equity: string | null;
  accountGrossNotional: string | null;
  netDailyPnl: string | null;
  openOrderCount: number;
  staleSources: string[];
  advisories: string[];
  isComplete: boolean;
  isSimulated: boolean;
  capturedAt: string;
}

export interface RiskProtectionView {
  id: string;
  accountId: string | null;
  scope: RiskLimitScopeWire;
  target: string | null;
  action: ProtectionActionWire;
  ruleId: RiskRuleIdWire | null;
  reason: string;
  status: string;
  triggeredAt: string;
  acknowledgedAt: string | null;
  clearedAt: string | null;
  isSimulated: boolean;
}

/** The dashboard headline. Every figure here is a MIRROR of engine state,
 *  timestamped as such, never a live read pretending to be one. */
export interface RiskStatusView {
  engineEnabled: boolean;
  failClosed: boolean;
  maxRiskStateAgeMs: number;
  snapshotRefreshMs: number;
  refreshOutpacesStaleness: boolean;
  platformCeilings: Record<string, string | number>;
  engagedSwitchCount: number;
  triggeredProtectionCount: number;
  latestSnapshotPerAccount: RiskSnapshotMetadataView[];
  staleAccounts: string[];
  eventsLast24hBySeverity: Partial<Record<RiskEventSeverityWire, number>>;
  note: string;
}

export interface RiskExposureView {
  accountId: string;
  asOf: string | null;
  snapshotVersion: string | null;
  configDigest: string | null;
  equity: string | null;
  accountGrossNotional: string | null;
  netDailyPnl: string | null;
  openOrderCount: number | null;
  blocking: RiskSwitchView | null;
  activeProtections: RiskProtectionView[];
  staleSources: string[];
  isComplete: boolean | null;
}

export interface DailyPnlPointView {
  tradingDay: string;
  capturedAt: string;
  snapshotVersion: string;
  netDailyPnl: string | null;
  equity: string | null;
}

export interface AccountRiskSummaryView {
  accountId: string;
  accountLabel: string;
  configVersion: number;
  configDigest: string | null;
  exposure: RiskExposureView;
  dailyPnl: DailyPnlPointView[];
  engagedSwitches: RiskSwitchView[];
  activeProtections: RiskProtectionView[];
  recentEvents: RiskEventView[];
  /** The resolved effective ceilings for THIS account (GLOBAL..SYMBOL chain
   *  over the published document) - what the engine's tightest-wins rule
   *  would report, computed here only for display, never for enforcement. */
  effectiveLimits: ResolvedLimitView[];
}

export interface StrategyRiskSummaryView {
  strategyId: string;
  scopeEntries: RiskLimitEntryView[];
  switch: RiskSwitchView | null;
  recentEvents: RiskEventView[];
  protectionAction: ProtectionActionWire | null;
}

/** Acceptance shape for a queued or deferred command (config publish). */
export interface RiskCommandAcceptedView {
  accepted: true;
  accountId: string;
  version: number;
  digest: string;
  jobEnqueued: boolean;
  message: string;
}
