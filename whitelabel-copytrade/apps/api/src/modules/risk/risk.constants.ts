/**
 * Shared constants for the Part 8 risk control surface.
 *
 * Several of these mirror ``wlct_trading`` definitions (rule ids, scopes,
 * the switch transition table, the credential pattern). The mirroring is
 * tolerated ONLY because ``risk-safety.spec.ts`` parses the Python source
 * and fails when the two drift - the same cross-language parity discipline
 * Part 7 established for the dataset registry. A hand-copied list that can
 * rot is the one thing worse than no list.
 */

/** Stable rule ids - the wire values of ``wlct_trading.enums.RiskRuleId``. */
export const RISK_RULE_IDS = Object.freeze([
  'MAX_STALE_DATA_AGE',
  'MAX_ORDER_QUANTITY',
  'MAX_ORDER_NOTIONAL',
  'MAX_POSITION_QUANTITY',
  'MAX_POSITION_NOTIONAL',
  'MAX_SYMBOL_EXPOSURE',
  'MAX_STRATEGY_EXPOSURE',
  'MAX_CORRELATION_GROUP_EXPOSURE',
  'MAX_EXCHANGE_EXPOSURE',
  'MAX_ACCOUNT_EXPOSURE',
  'MAX_OPEN_ORDERS',
  'MAX_ORDER_RATE',
  'MAX_CANCEL_RATE',
  'MAX_DAILY_LOSS',
  'MAX_STRATEGY_DAILY_LOSS',
  'MAX_DRAWDOWN',
  'MAX_CONSECUTIVE_LOSSES',
  'MAX_ACTIVE_STRATEGIES',
  'MAX_TOTAL_VOLUME',
  'MAX_FEE_BUDGET',
  'MAX_PRICE_DEVIATION',
  'MAX_LEVERAGE',
] as const);
export type RiskRuleIdWire = (typeof RISK_RULE_IDS)[number];

/** Hierarchy scopes - ``RiskLimitScope`` in Python. */
export const RISK_LIMIT_SCOPES = Object.freeze([
  'GLOBAL',
  'EXCHANGE',
  'ACCOUNT',
  'STRATEGY',
  'SYMBOL',
] as const);
export type RiskLimitScopeWire = (typeof RISK_LIMIT_SCOPES)[number];

/** Units - ``RiskLimitUnit`` in Python. */
export const RISK_LIMIT_UNITS = Object.freeze([
  'BASE_QUANTITY',
  'QUOTE_NOTIONAL',
  'COUNT',
  'LOSS',
  'PERCENT',
  'BPS',
  'AGE_MICROS',
  'LEVERAGE_X',
] as const);
export type RiskLimitUnitWire = (typeof RISK_LIMIT_UNITS)[number];

/** Rule -> admissible units, mirroring ``RISK_RULE_UNITS``. */
export const RISK_RULE_UNITS: Readonly<Record<RiskRuleIdWire, readonly RiskLimitUnitWire[]>> =
  Object.freeze({
    MAX_ORDER_QUANTITY: Object.freeze(['BASE_QUANTITY'] as const),
    MAX_ORDER_NOTIONAL: Object.freeze(['QUOTE_NOTIONAL'] as const),
    MAX_POSITION_QUANTITY: Object.freeze(['BASE_QUANTITY'] as const),
    MAX_POSITION_NOTIONAL: Object.freeze(['QUOTE_NOTIONAL'] as const),
    MAX_ACCOUNT_EXPOSURE: Object.freeze(['QUOTE_NOTIONAL'] as const),
    MAX_SYMBOL_EXPOSURE: Object.freeze(['QUOTE_NOTIONAL'] as const),
    MAX_STRATEGY_EXPOSURE: Object.freeze(['QUOTE_NOTIONAL'] as const),
    MAX_OPEN_ORDERS: Object.freeze(['COUNT'] as const),
    MAX_DAILY_LOSS: Object.freeze(['LOSS'] as const),
    MAX_STRATEGY_DAILY_LOSS: Object.freeze(['LOSS'] as const),
    MAX_DRAWDOWN: Object.freeze(['PERCENT'] as const),
    MAX_LEVERAGE: Object.freeze(['LEVERAGE_X'] as const),
    MAX_ORDER_RATE: Object.freeze(['COUNT'] as const),
    MAX_CANCEL_RATE: Object.freeze(['COUNT'] as const),
    MAX_PRICE_DEVIATION: Object.freeze(['BPS'] as const),
    MAX_STALE_DATA_AGE: Object.freeze(['AGE_MICROS'] as const),
    MAX_CONSECUTIVE_LOSSES: Object.freeze(['COUNT'] as const),
    MAX_ACTIVE_STRATEGIES: Object.freeze(['COUNT'] as const),
    MAX_TOTAL_VOLUME: Object.freeze(['QUOTE_NOTIONAL'] as const),
    MAX_FEE_BUDGET: Object.freeze(['QUOTE_NOTIONAL'] as const),
    MAX_CORRELATION_GROUP_EXPOSURE: Object.freeze(['QUOTE_NOTIONAL'] as const),
    MAX_EXCHANGE_EXPOSURE: Object.freeze(['QUOTE_NOTIONAL'] as const),
  });

/** Rate rules admit exactly the 1s and 60s windows - Python's
 *  RATE_WINDOW_ONE_SECOND_MICROS / RATE_WINDOW_ONE_MINUTE_MICROS. */
export const RATE_WINDOW_ONE_SECOND_MICROS = 1_000_000;
export const RATE_WINDOW_ONE_MINUTE_MICROS = 60_000_000;
export const RATE_WINDOWS_MICROS: readonly number[] = Object.freeze([
  RATE_WINDOW_ONE_SECOND_MICROS,
  RATE_WINDOW_ONE_MINUTE_MICROS,
]);

/** Kill-switch lifecycle - ``RiskSwitchStatus``. */
export const RISK_SWITCH_STATUSES = Object.freeze([
  'INACTIVE',
  'ACTIVE',
  'TRIGGERED',
  'ACKNOWLEDGED',
  'CLEARED',
] as const);
export type RiskSwitchStatusWire = (typeof RISK_SWITCH_STATUSES)[number];

/**
 * The legal lifecycle transitions, mirroring ``RISK_SWITCH_TRANSITIONS`` in
 * ``wlct_trading/enums.py``. The spec test parses the Python table and
 * asserts equality; do not edit one side alone, ever.
 *
 * The engine REFUSES these transitions at decision time; the API refuses
 * them at write time. Same table, two enforcers, one truth.
 */
export const RISK_SWITCH_TRANSITIONS: Readonly<
  Record<RiskSwitchStatusWire, readonly RiskSwitchStatusWire[]>
> = Object.freeze({
  INACTIVE: Object.freeze(['ACTIVE', 'TRIGGERED'] as const),
  ACTIVE: Object.freeze(['INACTIVE'] as const),
  TRIGGERED: Object.freeze(['ACKNOWLEDGED', 'CLEARED'] as const),
  ACKNOWLEDGED: Object.freeze(['CLEARED'] as const),
  CLEARED: Object.freeze(['INACTIVE'] as const),
});

/** Protection actions - ``ProtectionAction``. No liquidation member exists,
 *  and that absence is the point; see the Python enum's docstring. */
export const PROTECTION_ACTIONS = Object.freeze([
  'BLOCK_NEW_RISK',
  'BLOCK_SYMBOL',
  'BLOCK_STRATEGY',
  'BLOCK_ACCOUNT',
  'BLOCK_EXCHANGE',
  'GLOBAL_TRADING_STOP',
] as const);
export type ProtectionActionWire = (typeof PROTECTION_ACTIONS)[number];

/** Event severities - ``RiskEventSeverity``. */
export const RISK_EVENT_SEVERITIES = Object.freeze([
  'INFO',
  'WARNING',
  'CRITICAL',
  'EMERGENCY',
] as const);
export type RiskEventSeverityWire = (typeof RISK_EVENT_SEVERITIES)[number];

/** Kill-switch scopes on the risk surface. The Part 5 execution surface
 *  keeps its own four-value union; the durable rows live in one table. */
export const RISK_KILL_SCOPES = Object.freeze([
  'GLOBAL',
  'EXCHANGE',
  'ACCOUNT',
  'STRATEGY',
  'SYMBOL',
  'RISK',
] as const);
export type RiskKillScopeWire = (typeof RISK_KILL_SCOPES)[number];

/** Which scopes the RISK console may engage. The GLOBAL and EXCHANGE scopes
 *  belong to the platform console by policy even though the rows share one
 *  table - a tenant engaging GLOBAL would be a cross-tenant veto, which the
 *  platform's own switch already provides honestly. */
export const RISK_CONSOLE_ENGAGE_SCOPES: readonly RiskKillScopeWire[] = Object.freeze([
  'ACCOUNT',
  'STRATEGY',
  'SYMBOL',
]);

/** Clearing a triggered protection is the one action in this module that
 *  makes the system MORE willing to trade. It gets the phrase, the reason
 *  floor and the explicit acknowledgement prerequisite. */
export const PROTECTION_CLEAR_CONFIRMATION = 'CLEAR RISK PROTECTION' as const;
/** Typed confirmation for a configuration revision that WIDENS an effective
 *  ceiling (and for republishing an old, wider revision via rollback). The
 *  two phrases are deliberately different strings: the ceremony for ending a
 *  halt and the ceremony for loosening a limit must never be satisfied by
 *  the same typed paste. */
export const WIDEN_CONFIRMATION = 'WIDEN RISK LIMITS' as const;
export const MIN_PROTECTION_CLEAR_REASON = 20;
export const MIN_ACKNOWLEDGEMENT_REASON = 10;

/** Credential-shape refusal, shared philosophy with the datasets module. */
export const CREDENTIAL_KEY_PATTERN =
  /(secret|password|passwd|api[_-]?key|private[_-]?key|token|credential|passphrase)/i;

/** Digest/canonicalisation limits. */
export const MAX_POLICY_ENTRIES = 200;
export const MAX_CORRELATION_GROUPS = 32;
export const MIN_REASON_LENGTH = 10;
export const EPOCH_MICROS_CEILING = 4_102_444_800_000_000; // year 2100
export const SHA256_HEX_PATTERN = '^[0-9a-f]{64}$' as const;

/** Decimal-string pattern for money-shaped limit values (no floats, ever -
 *  the same rule the Python configuration loader enforces at parse). */
export const DECIMAL_STRING_PATTERN = '^-?\\d+(\\.\\d+)?$' as const;

/** The published ceiling keys of the platform defaults, in the order the
 *  status view renders them (mirrors AppConfigService.riskPlatformCeilings). */
export const PLATFORM_CEILING_KEYS = Object.freeze([
  'maxOrderNotional',
  'maxPositionNotional',
  'maxAccountExposure',
  'maxStrategyExposure',
  'maxSymbolExposure',
  'maxOpenOrders',
  'maxDailyLoss',
  'maxStrategyDailyLoss',
  'maxDrawdownPercent',
  'maxOrdersPerSecond',
  'maxOrdersPerMinute',
  'maxCancelsPerSecond',
  'maxCancelsPerMinute',
  'maxPriceDeviationBps',
  'maxConsecutiveLosses',
] as const);

/** Mapping from platform ceiling key to (rule, unit) it caps. Used by the
 *  config service to refuse a GLOBAL-scope document that WIDENS beyond the
 *  platform default, and by the status view to show both numbers side by
 *  side. Absent rules (volume, fee budget, correlation...) simply have no
 *  platform default and no widening check - which is the honest statement,
 *  not a gap to invent one for. */
export const CEILING_TO_RULE: Readonly<Partial<Record<string, RiskRuleIdWire>>> = Object.freeze({
  maxOrderNotional: 'MAX_ORDER_NOTIONAL',
  maxPositionNotional: 'MAX_POSITION_NOTIONAL',
  maxAccountExposure: 'MAX_ACCOUNT_EXPOSURE',
  maxStrategyExposure: 'MAX_STRATEGY_EXPOSURE',
  maxSymbolExposure: 'MAX_SYMBOL_EXPOSURE',
  maxOpenOrders: 'MAX_OPEN_ORDERS',
  maxDailyLoss: 'MAX_DAILY_LOSS',
  maxStrategyDailyLoss: 'MAX_STRATEGY_DAILY_LOSS',
  maxDrawdownPercent: 'MAX_DRAWDOWN',
  maxOrdersPerSecond: 'MAX_ORDER_RATE',
  maxOrdersPerMinute: 'MAX_ORDER_RATE',
  maxCancelsPerSecond: 'MAX_CANCEL_RATE',
  maxCancelsPerMinute: 'MAX_CANCEL_RATE',
  maxPriceDeviationBps: 'MAX_PRICE_DEVIATION',
  maxConsecutiveLosses: 'MAX_CONSECUTIVE_LOSSES',
});
