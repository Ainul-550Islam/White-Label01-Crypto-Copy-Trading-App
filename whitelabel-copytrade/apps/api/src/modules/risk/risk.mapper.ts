import type { Prisma } from '@prisma/client';

import type {
  AccountRiskSummaryView,
  DailyPnlPointView,
  ResolvedLimitView,
  RiskConfigurationVersionView,
  RiskConfigurationView,
  RiskEventView,
  RiskExposureView,
  RiskLimitEntryView,
  RiskProtectionView,
  RiskSnapshotMetadataView,
  RiskSwitchView,
  StrategyRiskSummaryView,
} from './risk.types';
import type {
  ProtectionActionWire,
  RiskEventSeverityWire,
  RiskKillScopeWire,
  RiskLimitScopeWire,
  RiskRuleIdWire,
  RiskSwitchStatusWire,
} from './risk.constants';

/**
 * Row-to-view mapping for the Part 8 risk control surface.
 *
 * The datasets/strategy mapper discipline applies unchanged: BigInt becomes
 * a decimal string, Json columns pass through only after an explicit shape
 * check, and nulls stay null - a risk dashboard that renders "0" for
 * "unknown" is how operators learn to distrust dashboards.
 */

const text = (value: bigint | null | undefined): string | null =>
  value === null || value === undefined ? null : value.toString();

const iso = (value: Date | null | undefined): string | null =>
  value === null || value === undefined ? null : value.toISOString();

const requiredIso = (value: Date): string => value.toISOString();

const asRecord = (value: Prisma.JsonValue): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asStringArray = (value: Prisma.JsonValue): string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? (value as string[])
    : [];

const decimalText = (value: Prisma.Decimal | null | undefined): string | null =>
  value === null || value === undefined ? null : value.toString();

export type RiskConfigurationRow = {
  id: string;
  tenantId: string;
  accountId: string;
  maxOrderQuantity: Prisma.Decimal;
  maxOrderNotional: Prisma.Decimal;
  maxPositionQuantity: Prisma.Decimal;
  maxSymbolExposureNotional: Prisma.Decimal;
  maxAccountExposureNotional: Prisma.Decimal;
  maxOpenOrders: number;
  maxOrdersPerMinute: number;
  maxDailyLoss: Prisma.Decimal;
  maxStrategyLoss: Prisma.Decimal;
  maxPriceDeviationPercent: Prisma.Decimal;
  maxMarketDataAgeMicros: number;
  tradingHalted: boolean;
  haltedReason: string | null;
  haltedAt: Date | null;
  version: number;
  digest: string | null;
  policyJson: Prisma.JsonValue;
  protectionJson: Prisma.JsonValue;
  dailyLossIncludesUnrealized: boolean;
  allowRiskReducingOrders: boolean;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RiskConfigurationVersionRow = {
  id: string;
  accountId: string;
  version: number;
  digest: string;
  changeReason: string;
  changedByUserId: string;
  loosenedCeilings: boolean;
  createdAt: Date;
};

export type RiskEventRow = {
  id: string;
  tenantId: string;
  accountId: string | null;
  strategyId: string | null;
  orderId: string | null;
  eventType: string;
  severity: string;
  code: string;
  message: string;
  limitValue: string | null;
  observedValue: string | null;
  venue: string | null;
  symbol: string | null;
  ruleId: string | null;
  scope: string | null;
  scopeTarget: string | null;
  action: string | null;
  source: string | null;
  snapshotVersion: bigint | null;
  isSimulated: boolean;
  riskDecisionId: string | null;
  correlationId: string | null;
  createdAt: Date;
};

export type KillSwitchLifecycleRow = {
  id: string;
  tenantId: string | null;
  scope: string;
  target: string | null;
  isEngaged: boolean;
  reason: string | null;
  status: string;
  triggeredByRule: string | null;
  severity: string | null;
  requiresExplicitClear: boolean;
  engagedAt: Date | null;
  acknowledgedAt: Date | null;
  clearedAt: Date | null;
  updatedAt: Date;
};

export type RiskSnapshotMetadataRow = {
  id: string;
  accountId: string;
  snapshotId: string;
  snapshotVersion: bigint;
  tradingDay: string;
  configDigest: string | null;
  stateDigest: string | null;
  equity: Prisma.Decimal | null;
  accountGrossNotional: Prisma.Decimal | null;
  netDailyPnl: Prisma.Decimal | null;
  openOrderCount: number;
  staleSources: Prisma.JsonValue;
  advisories: Prisma.JsonValue;
  isComplete: boolean;
  isSimulated: boolean;
  capturedAt: Date;
};

export type RiskProtectionRow = {
  id: string;
  accountId: string | null;
  scope: string;
  target: string | null;
  action: string;
  ruleId: string | null;
  reason: string;
  status: string;
  acknowledgedAt: Date | null;
  clearedAt: Date | null;
  triggeredAtDateTime: Date;
  isSimulated: boolean;
};

export function toRiskEventView(row: RiskEventRow): RiskEventView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    accountId: row.accountId,
    strategyId: row.strategyId,
    orderId: row.orderId,
    eventType: row.eventType,
    severity: row.severity as RiskEventSeverityWire,
    code: row.code,
    message: row.message,
    limitValue: row.limitValue,
    observedValue: row.observedValue,
    venue: row.venue,
    symbol: row.symbol,
    ruleId: row.ruleId as RiskRuleIdWire | null,
    scope: row.scope as RiskLimitScopeWire | null,
    scopeTarget: row.scopeTarget,
    action: row.action as ProtectionActionWire | null,
    source: row.source,
    snapshotVersion: text(row.snapshotVersion),
    isSimulated: row.isSimulated,
    riskDecisionId: row.riskDecisionId,
    correlationId: row.correlationId,
    createdAt: requiredIso(row.createdAt),
  };
}

export function toRiskSwitchView(row: KillSwitchLifecycleRow): RiskSwitchView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    scope: row.scope as RiskKillScopeWire,
    target: row.target,
    isEngaged: row.isEngaged,
    status: row.status as RiskSwitchStatusWire,
    reason: row.reason,
    triggeredByRule: row.triggeredByRule as RiskRuleIdWire | null,
    severity: row.severity as RiskEventSeverityWire | null,
    requiresExplicitClear: row.requiresExplicitClear,
    engagedAt: iso(row.engagedAt),
    acknowledgedAt: iso(row.acknowledgedAt),
    clearedAt: iso(row.clearedAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

export function toSnapshotMetadataView(
  row: RiskSnapshotMetadataRow,
): RiskSnapshotMetadataView {
  return {
    id: row.id,
    accountId: row.accountId,
    snapshotId: row.snapshotId,
    snapshotVersion: row.snapshotVersion.toString(),
    tradingDay: row.tradingDay,
    configDigest: row.configDigest,
    stateDigest: row.stateDigest,
    equity: decimalText(row.equity),
    accountGrossNotional: decimalText(row.accountGrossNotional),
    netDailyPnl: decimalText(row.netDailyPnl),
    openOrderCount: row.openOrderCount,
    staleSources: asStringArray(row.staleSources),
    advisories: asStringArray(row.advisories),
    isComplete: row.isComplete,
    isSimulated: row.isSimulated,
    capturedAt: requiredIso(row.capturedAt),
  };
}

export function toProtectionView(row: RiskProtectionRow): RiskProtectionView {
  return {
    id: row.id,
    accountId: row.accountId,
    scope: row.scope as RiskLimitScopeWire,
    target: row.target,
    action: row.action as ProtectionActionWire,
    ruleId: row.ruleId as RiskRuleIdWire | null,
    reason: row.reason,
    status: row.status,
    triggeredAt: requiredIso(row.triggeredAtDateTime),
    acknowledgedAt: iso(row.acknowledgedAt),
    clearedAt: iso(row.clearedAt),
    isSimulated: row.isSimulated,
  };
}

export function toConfigurationVersionView(
  row: RiskConfigurationVersionRow,
): RiskConfigurationVersionView {
  return {
    id: row.id,
    accountId: row.accountId,
    version: row.version,
    digest: row.digest,
    changeReason: row.changeReason,
    changedByUserId: row.changedByUserId,
    createdAt: requiredIso(row.createdAt),
    loosenedCeilings: row.loosenedCeilings,
  };
}

/** Renders the stored policy JSON's entry list, defensively: an entry the
 *  API cannot parse is REPORTED (via a thrown ValidationException upstream)
 *  rather than skipped - the config view that quietly drops a limit entry is
 *  a config view that lies about what is enforced. */
export function parsePolicyEntries(policyJson: Prisma.JsonValue): RiskLimitEntryView[] {
  const document = asRecord(policyJson);
  const raw = document['entries'];
  if (!Array.isArray(raw)) {
    throw new Error('policy_json.entries is missing or not an array');
  }
  return raw.map((item) => {
    const entry = asRecord(item as Prisma.JsonValue);
    const value = entry['value'];
    const target = entry['target'];
    const fromMicros = entry['effectiveFromMicros'];
    const untilMicros = entry['effectiveUntilMicros'];
    const entryVersion = entry['entryVersion'];
    const windowMicros = entry['windowMicros'];
    const priority = entry['priority'];
    if (
      typeof entry['ruleId'] !== 'string' ||
      typeof entry['scope'] !== 'string' ||
      typeof entry['unit'] !== 'string' ||
      typeof entry['enabled'] !== 'boolean' ||
      (typeof value !== 'string' && typeof value !== 'number') ||
      !(target === null || typeof target === 'string') ||
      typeof fromMicros !== 'number' ||
      !(untilMicros === null || typeof untilMicros === 'number') ||
      typeof entryVersion !== 'number' ||
      !(windowMicros === null || typeof windowMicros === 'number') ||
      typeof priority !== 'number'
    ) {
      throw new Error('policy_json.entries contains an entry of unexpected shape');
    }
    return {
      ruleId: entry['ruleId'] as RiskRuleIdWire,
      scope: entry['scope'] as RiskLimitScopeWire,
      target,
      enabled: entry['enabled'],
      value: String(value),
      unit: entry['unit'],
      priority,
      effectiveFromMicros: String(fromMicros),
      effectiveUntilMicros: untilMicros === null ? null : String(untilMicros),
      entryVersion,
      windowMicros: windowMicros === null ? null : windowMicros,
    } satisfies RiskLimitEntryView;
  });
}

export function toConfigurationView(
  row: RiskConfigurationRow,
  history: RiskConfigurationVersionRow[],
  policyJson: Prisma.JsonValue,
): RiskConfigurationView {
  return {
    accountId: row.accountId,
    version: row.version,
    digest: row.digest,
    dailyLossIncludesUnrealized: row.dailyLossIncludesUnrealized,
    allowRiskReducingOrders: row.allowRiskReducingOrders,
    policyJson,
    protectionJson: row.protectionJson,
    history: history.map(toConfigurationVersionView),
  };
}

/**
 * Tightest-wins resolution over the entry list, for DISPLAY.
 *
 * This is a reimplementation of one sentence of the Python resolver
 * ("minimum value among applicable entries wins"), not of the enforcement:
 * the engine resolves on its side at decision time and the API view exists
 * solely so the dashboard can show what the operator's document MEANS. The
 * spec test asserts the two agree on a corpus of fixtures generated by the
 * Python side; if they ever diverge, the fixture test fails at review time,
 * not in production.
 */
export function resolveEffectiveLimits(
  entries: RiskLimitEntryView[],
  context: {
    exchange: string | null;
    accountId: string;
    strategyId: string | null;
    symbol: string | null;
    nowMicros: number;
  },
): ResolvedLimitView[] {
  const applicable = (entry: RiskLimitEntryView): boolean => {
    if (!entry.enabled) return false;
    const from = Number(entry.effectiveFromMicros);
    if (context.nowMicros < from) return false;
    if (
      entry.effectiveUntilMicros !== null &&
      context.nowMicros >= Number(entry.effectiveUntilMicros)
    ) {
      return false;
    }
    switch (entry.scope) {
      case 'GLOBAL':
        return true;
      case 'EXCHANGE':
        return context.exchange !== null && entry.target === context.exchange;
      case 'ACCOUNT':
        return entry.target === context.accountId;
      case 'STRATEGY':
        return context.strategyId !== null && entry.target === context.strategyId;
      case 'SYMBOL':
        return context.symbol !== null && entry.target === context.symbol;
      default:
        return false;
    }
  };
  const byRule = new Map<RiskRuleIdWire, RiskLimitEntryView[]>();
  for (const entry of entries) {
    if (!applicable(entry)) continue;
    const bucket = byRule.get(entry.ruleId) ?? [];
    bucket.push(entry);
    byRule.set(entry.ruleId, bucket);
  }
  const depth: Record<RiskLimitScopeWire, number> = {
    GLOBAL: 0,
    EXCHANGE: 1,
    ACCOUNT: 2,
    STRATEGY: 3,
    SYMBOL: 4,
  };
  const out: ResolvedLimitView[] = [];
  for (const [ruleId, bucket] of byRule) {
    const sorted = [...bucket].sort(
      (a, b) =>
        compareDecimalStrings(a.value, b.value) ||
        a.priority - b.priority ||
        depth[a.scope] - depth[b.scope] ||
        b.entryVersion - a.entryVersion,
    );
    const winner = sorted[0];
    if (!winner) continue;
    out.push({
      ruleId,
      value: winner.value,
      unit: winner.unit,
      windowMicros: winner.windowMicros,
      governingScope: winner.scope,
      governingTarget: winner.target,
      governingEntryVersion: winner.entryVersion,
      applicableEntryCount: sorted.length,
    });
  }
  out.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  return out;
}

function compareDecimalStrings(a: string, b: string): number {
  // Compare without float conversion: strip the fraction, compare the
  // scaled integer. Values are finite by validation at write time.
  const scale = 12;
  const scaled = (value: string): bigint => {
    const negative = value.startsWith('-');
    const body = negative ? value.slice(1) : value;
    const [whole, fraction = ''] = body.split('.');
    const padded = (fraction + '0'.repeat(scale)).slice(0, scale);
    const result = BigInt(whole + padded);
    return negative ? -result : result;
  };
  const left = scaled(a);
  const right = scaled(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function toDailyPnlPoint(row: RiskSnapshotMetadataRow): DailyPnlPointView {
  return {
    tradingDay: row.tradingDay,
    capturedAt: requiredIso(row.capturedAt),
    snapshotVersion: row.snapshotVersion.toString(),
    netDailyPnl: decimalText(row.netDailyPnl),
    equity: decimalText(row.equity),
  };
}

export function toAccountSummary(args: {
  accountId: string;
  accountLabel: string;
  configRow: RiskConfigurationRow;
  exposure: RiskExposureView;
  dailyPnl: DailyPnlPointView[];
  engagedSwitches: RiskSwitchView[];
  activeProtections: RiskProtectionView[];
  recentEvents: RiskEventView[];
  effectiveLimits: ResolvedLimitView[];
}): AccountRiskSummaryView {
  return {
    accountId: args.accountId,
    accountLabel: args.accountLabel,
    configVersion: args.configRow.version,
    configDigest: args.configRow.digest,
    exposure: args.exposure,
    dailyPnl: args.dailyPnl,
    engagedSwitches: args.engagedSwitches,
    activeProtections: args.activeProtections,
    recentEvents: args.recentEvents,
    effectiveLimits: args.effectiveLimits,
  };
}

export function toStrategySummary(args: {
  strategyId: string;
  scopeEntries: RiskLimitEntryView[];
  switch: RiskSwitchView | null;
  recentEvents: RiskEventView[];
}): StrategyRiskSummaryView {
  // "What did the engine last DO to this strategy" = the most recent event
  // that carries a protection action (events arrive newest-first from the
  // query). No action ever seen -> null, not an assumption of either state.
  const lastActioned = args.recentEvents.find((event) => event.action !== null);
  return {
    strategyId: args.strategyId,
    scopeEntries: args.scopeEntries,
    switch: args.switch,
    recentEvents: args.recentEvents,
    protectionAction: lastActioned?.action ?? null,
  };
}

export const mapperInternals = { compareDecimalStrings, asRecord };
