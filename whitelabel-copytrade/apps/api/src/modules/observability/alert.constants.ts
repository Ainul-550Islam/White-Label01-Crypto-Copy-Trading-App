/**
 * Part 9 alert-catalog mirror.
 *
 * The authoritative catalog is the Python engine's
 * (`wlct_trading.observability.alerts.ALERT_RULES`); this file exists so the
 * API can render, validate and PRUNE what it persists without a live import
 * of the engine package. It is parity-tested against the engine's live source
 * (see observability-safety.spec.ts): a rule added on one side and not the
 * other fails CI with both files quoted in the error.
 */

export const ALERT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL', 'EMERGENCY'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;
export type AlertState = (typeof ALERT_STATES)[number];

export const INCIDENT_STATUSES = ['OPEN', 'REVIEWING', 'CLOSED'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_LINK_KINDS = [
  'ALERT',
  'RISK_EVENT',
  'AUDIT',
  'ORDER',
  'EXECUTION_INCIDENT',
  'STRATEGY_EVENT',
  'MARKET_DATA_FAULT',
  'QUEUE_JOB',
] as const;
export type IncidentLinkKind = (typeof INCIDENT_LINK_KINDS)[number];

export const COMPONENT_STATUSES = ['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'STOPPED', 'UNKNOWN'] as const;
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];

/** The nine declared trading gates, in engine order (mirror; parity-tested
 *  against TRADING_GATES in wlct_trading.observability.readiness). */
export const TRADING_GATES = [
  'market_data',
  'risk_engine',
  'risk_state_fresh',
  'exchange_connectivity',
  'execution_adapter',
  'reconciliation',
  'queues',
  'kill_switches',
  'configuration',
] as const;
export type TradingGateName = (typeof TRADING_GATES)[number];

/** Gates the trading engine reports evidence for; the API supplies the rest.
 *  Parity-tested against ENGINE_GATES in services/trading-engine. */
export const ENGINE_REPORTED_GATES: readonly TradingGateName[] = Object.freeze([
  'market_data',
  'risk_engine',
  'risk_state_fresh',
  'exchange_connectivity',
  'execution_adapter',
  'reconciliation',
  'kill_switches',
]);

/** The API supplies exactly these two (plus the merge). Queues because the
 *  queue backend is the API's; configuration because a booting API HAS a
 *  valid configuration or does not boot - the gate is honest bookkeeping of
 *  that fact, not a new authority. */
export const API_SUPPLIED_GATES: readonly TradingGateName[] = Object.freeze([
  'queues',
  'configuration',
]);

/** Mirrors the engine catalog entries the API must know: severity for the
 *  gauge/panel, blocksTrading for the readiness panel note. `requiresRecovery`
 *  is true for every rule in both languages - the parity test enforces that
 *  it never varies, which is the interesting property, not the data. */
export interface AlertRuleDescriptor {
  readonly ruleId: string;
  readonly severity: AlertSeverity;
  readonly title: string;
  readonly blocksTrading: boolean;
}

export const ALERT_RULE_CATALOG: readonly AlertRuleDescriptor[] = Object.freeze([
  { ruleId: 'MARKET_DATA_STALE', severity: 'CRITICAL', title: 'Market data stale', blocksTrading: true },
  { ruleId: 'ORDERBOOK_RESYNC_STORM', severity: 'WARNING', title: 'Order-book resync storm', blocksTrading: false },
  { ruleId: 'RISK_SNAPSHOT_STALE', severity: 'CRITICAL', title: 'Risk snapshots stale', blocksTrading: true },
  { ruleId: 'RISK_ENGINE_UNAVAILABLE', severity: 'EMERGENCY', title: 'Risk engine unavailable', blocksTrading: true },
  { ruleId: 'EXECUTION_UNAVAILABLE', severity: 'CRITICAL', title: 'Execution unavailable', blocksTrading: true },
  { ruleId: 'EXCHANGE_DISCONNECTED', severity: 'WARNING', title: 'Exchange connectivity lost', blocksTrading: false },
  { ruleId: 'RECONCILIATION_DISCREPANCY', severity: 'EMERGENCY', title: 'Reconciliation discrepancy', blocksTrading: true },
  { ruleId: 'REPEATED_ORDER_REJECTION', severity: 'WARNING', title: 'Repeated order rejections', blocksTrading: false },
  { ruleId: 'AMBIGUOUS_EXECUTION', severity: 'EMERGENCY', title: 'Ambiguous execution outcome', blocksTrading: true },
  { ruleId: 'RATE_LIMIT_EXHAUSTION', severity: 'WARNING', title: 'Rate-limit budget exhausted', blocksTrading: false },
  { ruleId: 'QUEUE_BACKLOG', severity: 'WARNING', title: 'Queue backlog', blocksTrading: false },
  { ruleId: 'EXECUTION_QUEUE_BACKLOG', severity: 'CRITICAL', title: 'Execution queue backlog', blocksTrading: false },
  { ruleId: 'WORKER_FAILURE', severity: 'CRITICAL', title: 'Worker failure', blocksTrading: false },
  { ruleId: 'POSTGRES_UNAVAILABLE', severity: 'CRITICAL', title: 'PostgreSQL unavailable', blocksTrading: false },
  { ruleId: 'REDIS_UNAVAILABLE', severity: 'EMERGENCY', title: 'Redis unavailable', blocksTrading: true },
  { ruleId: 'DATASET_VALIDATION_FAILURES', severity: 'WARNING', title: 'Dataset validation failures', blocksTrading: false },
  { ruleId: 'STRATEGY_ERROR_SPIKE', severity: 'WARNING', title: 'Strategy error spike', blocksTrading: false },
  { ruleId: 'KILL_SWITCH_ENGAGED', severity: 'EMERGENCY', title: 'Kill switch engaged', blocksTrading: true },
  { ruleId: 'PROTECTION_TRIGGERED', severity: 'CRITICAL', title: 'Account protection triggered', blocksTrading: true },
  { ruleId: 'SLO_BURN_FAST', severity: 'CRITICAL', title: 'Error budget burning fast', blocksTrading: false },
  { ruleId: 'SLO_BURN_SLOW', severity: 'WARNING', title: 'Error budget burning steadily', blocksTrading: false },
  { ruleId: 'SLO_BUDGET_EXHAUSTED', severity: 'CRITICAL', title: 'Error budget exhausted', blocksTrading: false },
  { ruleId: 'TELEMETRY_EXPORT_FAILING', severity: 'WARNING', title: 'Telemetry export failing', blocksTrading: false },
  { ruleId: 'SLO_TELEMETRY_GAP', severity: 'WARNING', title: 'SLO measurement gap', blocksTrading: false },
]);

/** The execution queue's separate alert policy, in code rather than vibes:
 *  the age that counts doubles DOWN for this queue (fires earlier) and the
 *  severity that results is CRITICAL with a backlog-specific rule id. A
 *  control-queue backlog is an annoyance; an execution-queue backlog while
 *  trading is enabled means orders are waiting on us. */
export const EXECUTION_QUEUE_ALERT_RATIO = 2;

/** Alert ids the queue-sync path (this service, not the engine) may write.
 *  Kept separate from the engine catalog because the QUEUE_BACKLOG rules are
 *  evaluated by the API's own maintenance job against BullMQ counters. */
export const QUEUE_ALERT_RULE_IDS = Object.freeze(['QUEUE_BACKLOG', 'EXECUTION_QUEUE_BACKLOG'] as const);
